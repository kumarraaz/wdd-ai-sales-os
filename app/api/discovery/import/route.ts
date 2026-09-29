import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { discoveryImportSchema } from "@/lib/validators";
import { getDiscoveryProvider } from "@/lib/discovery/registry";
import {
  importDiscoveredCompanies,
  type ImportItemResult,
} from "@/lib/discovery/import";
import { checkLeadQuota, recordDiscoveryUsage } from "@/lib/quotas";
import { audit } from "@/lib/audit";

/**
 * POST /api/discovery/import
 * Body: { providerId, searchQuery?, companies: DiscoveredCompany[] }
 *
 * Imports selected discovery results into the workspace's lead database —
 * the SAME Lead/Company tables as manual and CSV creation (no second lead
 * database). Duplicates are skipped with a human-readable reason. Every
 * imported lead keeps its source URL and provenance; field-level provenance
 * rows record where website/phone came from.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`discovery:${ctx.user.id}`, LIMITS.discovery);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = discoveryImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const provider = getDiscoveryProvider(input.providerId);
    if (!provider) {
      return NextResponse.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 });
    }
    // Never trust the client to mix companies across providers.
    if (input.companies.some((c) => c.provider !== provider.id)) {
      return NextResponse.json({ error: "PROVIDER_MISMATCH" }, { status: 400 });
    }

    const quota = await checkLeadQuota(ctx.organization.id);
    const room = quota.limit - quota.used;
    if (room <= 0) {
      return NextResponse.json(
        { error: "LEAD_QUOTA_EXCEEDED", used: quota.used, limit: quota.limit },
        { status: 403 },
      );
    }

    // Import up to the available lead quota; the rest are reported as
    // skipped with an explicit reason — never silently dropped.
    const importable = input.companies.slice(0, room);
    const overQuota: ImportItemResult[] = input.companies.slice(room).map((c) => ({
      providerId: c.providerId,
      name: c.name,
      status: "skipped",
      reason: `Lead quota exceeded (${quota.used}/${quota.limit}) — upgrade the plan to import more.`,
    }));

    const summary = await importDiscoveredCompanies(
      ctx.organization.id,
      ctx.user.id,
      provider,
      importable,
      { searchQuery: input.searchQuery },
    );
    const skipped = [...summary.skipped, ...overQuota];

    await recordDiscoveryUsage(ctx.organization.id, { imports: summary.imported.length + summary.possibleDuplicates.length });
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "discovery.import",
      resource: "lead",
      metadata: {
        provider: provider.id,
        imported: summary.imported.length,
        alreadyExists: summary.alreadyExists.length,
        possibleDuplicates: summary.possibleDuplicates.length,
        skipped: skipped.length,
        failed: summary.failed.length,
        leadIds: [...summary.imported, ...summary.possibleDuplicates].map((i) => i.leadId),
      },
      req,
    });

    return NextResponse.json(
      {
        imported: summary.imported,
        alreadyExists: summary.alreadyExists,
        possibleDuplicates: summary.possibleDuplicates,
        skipped,
        failed: summary.failed,
        counts: {
          imported: summary.imported.length,
          alreadyExists: summary.alreadyExists.length,
          possibleDuplicates: summary.possibleDuplicates.length,
          skipped: skipped.length,
          failed: summary.failed.length,
        },
      },
      { status: 201 },
    );
  },
  { minRole: "SALES_EXECUTIVE" },
);
