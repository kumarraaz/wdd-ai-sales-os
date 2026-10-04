import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { z } from "zod";
import { discoveredCompanySchema } from "@/lib/validators";
import { getDiscoveryProvider } from "@/lib/discovery/registry";
import {
  importDiscoveredCompanies,
  type ImportItemResult,
  type ImportSummary,
} from "@/lib/discovery/import";
import { updateHistoryImportCounts } from "@/lib/discovery/history";
import { checkLeadQuota, recordDiscoveryUsage } from "@/lib/quotas";
import { audit } from "@/lib/audit";

const importBatchSchema = z.object({
  /** Candidates from a discovery run (possibly multi-source). */
  candidates: z.array(discoveredCompanySchema).min(1).max(200),
  searchQuery: z.string().trim().max(300).optional(),
  /** History row to update with import counts. */
  historyId: z.string().cuid().optional(),
});

/**
 * POST /api/discovery/import-batch
 * Body: { candidates, searchQuery?, historyId? }
 *
 * Imports selected run results into the workspace CRM. Candidates are
 * grouped by their provider so dedup and sourceType stay correct.
 *
 * QUALIFICATION NEVER BLOCKS IMPORT — a selected lead imports regardless
 * of its qualification/score. Outcomes per lead: imported | already_exists |
 * possible_duplicate | skipped | failed — every result is explicit, nothing
 * is silently discarded.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`discovery:${ctx.user.id}`, LIMITS.discovery);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = importBatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const quota = await checkLeadQuota(ctx.organization.id);
    const room = quota.limit - quota.used;
    if (room <= 0) {
      return NextResponse.json(
        { error: "LEAD_QUOTA_EXCEEDED", used: quota.used, limit: quota.limit },
        { status: 403 },
      );
    }

    const importable = input.candidates.slice(0, room);
    const overQuota: ImportItemResult[] = input.candidates.slice(room).map((c) => ({
      providerId: c.providerId,
      name: c.name,
      status: "skipped" as const,
      reason: `Lead quota exceeded (${quota.used}/${quota.limit}) — upgrade the plan to import more.`,
    }));

    // Group by provider — dedup rules and sourceType are provider-scoped.
    const byProvider = new Map<string, typeof importable>();
    for (const c of importable) {
      const list = byProvider.get(c.provider) ?? [];
      list.push(c);
      byProvider.set(c.provider, list);
    }

    const combined: ImportSummary = {
      imported: [],
      alreadyExists: [],
      possibleDuplicates: [],
      skipped: [...overQuota],
      failed: [],
    };
    for (const [providerId, companies] of byProvider) {
      const provider = getDiscoveryProvider(providerId);
      if (!provider) {
        for (const c of companies) {
          combined.failed.push({
            providerId: c.providerId,
            name: c.name,
            status: "failed",
            reason: `Unknown provider "${providerId}".`,
          });
        }
        continue;
      }
      const summary = await importDiscoveredCompanies(
        ctx.organization.id,
        ctx.user.id,
        provider,
        companies,
        { searchQuery: input.searchQuery },
      );
      combined.imported.push(...summary.imported);
      combined.alreadyExists.push(...summary.alreadyExists);
      combined.possibleDuplicates.push(...summary.possibleDuplicates);
      combined.skipped.push(...summary.skipped);
      combined.failed.push(...summary.failed);
    }

    const importedCount = combined.imported.length + combined.possibleDuplicates.length;
    const duplicateCount = combined.alreadyExists.length;
    try {
      await recordDiscoveryUsage(ctx.organization.id, { imports: importedCount });
    } catch {
      /* non-fatal */
    }
    if (input.historyId) {
      try {
        await updateHistoryImportCounts(ctx.organization.id, input.historyId, {
          imported: importedCount,
          duplicate: duplicateCount,
        });
      } catch {
        /* non-fatal */
      }
    }

    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "discovery.import_batch",
      resource: "lead",
      metadata: {
        imported: combined.imported.length,
        alreadyExists: combined.alreadyExists.length,
        possibleDuplicates: combined.possibleDuplicates.length,
        skipped: combined.skipped.length,
        failed: combined.failed.length,
      },
      req,
    });

    return NextResponse.json({
      summary: {
        imported: combined.imported.length,
        alreadyExists: combined.alreadyExists.length,
        possibleDuplicates: combined.possibleDuplicates.length,
        skipped: combined.skipped.length,
        failed: combined.failed.length,
      },
      results: [
        ...combined.imported,
        ...combined.alreadyExists,
        ...combined.possibleDuplicates,
        ...combined.skipped,
        ...combined.failed,
      ],
    });
  },
  { minRole: "SALES_EXECUTIVE" },
);
