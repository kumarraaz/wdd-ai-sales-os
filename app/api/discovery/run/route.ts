import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { discoveryRunSchema } from "@/lib/validators";
import { getDiscoveryProvider, listSearchableProviders } from "@/lib/discovery/registry";
import { runDiscovery, type DiscoveryRunInput, type RunDeps, type RunEvent } from "@/lib/discovery/run";
import { findMatchForCompany } from "@/lib/discovery/import";
import {
  checkProviderBudget,
  recordProviderUsage,
  recordBlockedAttempt,
} from "@/lib/discovery/cost";
import { checkDiscoveryQuota, recordDiscoveryUsage } from "@/lib/quotas";
import { recordHistory } from "@/lib/discovery/history";
import { seedExampleProfiles } from "@/lib/discovery/profiles";
import { audit } from "@/lib/audit";

/**
 * POST /api/discovery/run — multi-source lead discovery (SSE stream).
 *
 * Body: { sources?, industry, location, websiteFilter?, contactRequired?,
 *         opportunity?, recentEvidence?, limit?, category?, profileId? }
 *
 * Streams Server-Sent Events:
 *   event: source-start — { providerId, label }
 *   event: source-done  — { outcome } (per-source status + counts)
 *   event: complete     — { output } (candidates, truthful summary, sources)
 *   event: error        — { message }
 *
 * Guarantees:
 * - Budget is checked per source BEFORE any provider call (zero-spend).
 * - One source failing never discards another's results (PARTIAL).
 * - Counts are truthful: requested vs discovered vs contactable.
 * - NO website inspection runs — websiteStatus comes from provider fields.
 * - Every run is persisted to DiscoveryHistory and audited.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`discovery:${ctx.user.id}`, LIMITS.discovery);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = discoveryRunSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    // Unknown provider ids fail closed with a clear error.
    for (const s of input.sources) {
      if (s.providerId !== "all" && !getDiscoveryProvider(s.providerId)) {
        return NextResponse.json(
          { error: "UNKNOWN_PROVIDER", providerId: s.providerId },
          { status: 400 },
        );
      }
    }

    // Workspace-level discovery quota (existing plan limits).
    const quota = await checkDiscoveryQuota(ctx.organization.id, input.limit);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: "DISCOVERY_QUOTA_EXCEEDED",
          reason: quota.reason,
          quota: { searches: quota.searches, records: quota.records },
        },
        { status: 429 },
      );
    }

    // Seed example profiles on first run so "Saved Searches" is useful immediately.
    seedExampleProfiles(ctx.organization.id).catch(() => {});

    const orgId = ctx.organization.id;
    const deps: RunDeps = {
      getProvider: getDiscoveryProvider,
      listSearchable: listSearchableProviders,
      checkBudget: (providerId) => checkProviderBudget(orgId, providerId),
      recordUsage: (providerId, usage) => recordProviderUsage(orgId, providerId, usage),
      recordBlocked: (providerId) => recordBlockedAttempt(orgId, providerId),
    };

    const runInput: DiscoveryRunInput = {
      sources: input.sources,
      industry: input.industry,
      location: input.location,
      websiteFilter: input.websiteFilter,
      contactRequired: input.contactRequired,
      opportunity: input.opportunity,
      recentEvidence: input.recentEvidence,
      limit: input.limit,
      ...(input.category ? { category: input.category } : {}),
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };
        try {
          const output = await runDiscovery(runInput, deps, (e: RunEvent) => {
            if (e.type === "source-start") send("source-start", e);
            else if (e.type === "source-done") send("source-done", { outcome: e.outcome });
          });

          // Mark candidates already in the CRM (informational — import
          // still works and reports ALREADY_EXISTS per §18/§44).
          for (const c of output.candidates) {
            try {
              const provider = getDiscoveryProvider(c.provider);
              if (!provider) continue;
              const { match, matchedLeadId } = await findMatchForCompany(orgId, provider, c);
              if (match?.definitive && matchedLeadId) {
                c.inCrm = true;
                c.matchedLeadId = matchedLeadId;
              }
            } catch {
              /* per-candidate failure never breaks the run */
            }
          }
          // Persist history + quota + audit (failure-isolated).
          let historyId: string | undefined;
          try {
            const label = `${input.industry} · ${input.location}`;
            const row = await recordHistory({
              organizationId: orgId,
              profileId: input.profileId,
              label,
              input: runInput,
              output,
              createdById: ctx.user.id,
            });
            historyId = row.id;
          } catch {
            /* history failure never breaks the response */
          }
          try {
            await recordDiscoveryUsage(orgId, { searches: 1, records: output.candidates.length });
          } catch {
            /* non-fatal */
          }
          audit({
            organizationId: orgId,
            actorId: ctx.user.id,
            action: "discovery.run",
            resource: "DiscoveryHistory",
            resourceId: historyId,
            metadata: {
              industry: input.industry,
              location: input.location,
              requested: output.summary.requested,
              discovered: output.summary.discovered,
              contactable: output.summary.contactable,
              status: output.status,
              sources: output.sources.map((s) => `${s.providerId}:${s.status}`),
            },
            req,
          }).catch(() => {});

          send("complete", { output, historyId: historyId ?? null });
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : "Discovery run failed.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  },
  { minRole: "SALES_EXECUTIVE" },
);
