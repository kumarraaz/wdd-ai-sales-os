import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { discoveryPipelineSchema } from "@/lib/validators";
import { getDiscoveryProvider } from "@/lib/discovery/registry";
import { DiscoveryError, type DiscoveryQuery } from "@/lib/discovery/types";
import {
  runDiscoveryPipeline,
  type PipelineDeps,
  type PipelineEvent,
  type PipelineSummary,
} from "@/lib/discovery/pipeline";
import { findMatchForCompany } from "@/lib/discovery/import";
import { runWebsiteInspection } from "@/lib/intelligence/inspect";
import { generateLeadIntelligence } from "@/lib/intelligence/generate";
import { calculateScore } from "@/lib/intelligence/scoring";
import {
  checkDiscoveryQuota,
  recordDiscoveryUsage,
} from "@/lib/quotas";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * POST /api/discovery/pipeline — guided discovery pipeline as SSE stream.
 *
 * Body: { providerId, industry, location, websiteFilter?, opportunity?,
 *         limit?, category? }
 *
 * Streams Server-Sent Events:
 *   event: stage    — { stage, message }
 *   event: progress — { stage, completed, total }
 *   event: company  — { result } (per-company research + score)
 *   event: complete — { summary }
 *   event: error    — { message }
 *
 * The pipeline chains: provider search → duplicate detection → website
 * research (SSRF-safe) → Gemini AI research → transparent qualification.
 * One company's failure never aborts the batch. Quota is enforced before
 * the provider is called; every run is audited.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`discovery:${ctx.user.id}`, LIMITS.discovery);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = discoveryPipelineSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const provider = getDiscoveryProvider(input.providerId);
    if (!provider || !provider.searchable) {
      return NextResponse.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 });
    }
    if (!provider.isConfigured()) {
      return NextResponse.json(
        {
          error: "PROVIDER_NOT_CONFIGURED",
          providerId: provider.id,
          setupInstructions: provider.setupInstructions(),
        },
        { status: 409 },
      );
    }

    const quota = await checkDiscoveryQuota(ctx.organization.id, input.limit);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: "DISCOVERY_QUOTA_EXCEEDED",
          reason: quota.reason,
          quota: { searches: quota.searches, records: quota.records },
        },
        { status: 403 },
      );
    }

    const run = await db.discoveryRun.create({
      data: {
        organizationId: ctx.organization.id,
        providerId: provider.id,
        params: { ...input, mode: "pipeline" },
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const deps: PipelineDeps = {
      search: (query: DiscoveryQuery) => provider.search(query),
      checkDuplicate: (company) =>
        findMatchForCompany(ctx.organization.id, provider, company),
      researchWebsite: (url) => runWebsiteInspection(url),
      generateAI: (lead, company, inspection) =>
        generateLeadIntelligence(lead, company, inspection),
      score: (lead, inspection) =>
        calculateScore(
          {
            id: lead.id,
            website: lead.website,
            phone: lead.phone,
            industry: lead.industry,
            city: lead.city,
            country: lead.country,
            location: lead.location,
            rating: lead.rating,
            reviewCount: lead.reviewCount,
            externalId: lead.externalId,
            sourceUrl: lead.sourceUrl,
          },
          inspection
            ? { id: inspection.id, findings: inspection.findings }
            : null,
          null,
        ),
    };

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: PipelineEvent) => {
          controller.enqueue(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
        };
        let summary: PipelineSummary | null = null;
        try {
          const { summary: s } = await runDiscoveryPipeline(
            {
              industry: input.industry,
              location: input.location,
              websiteFilter: input.websiteFilter,
              opportunity: input.opportunity,
              limit: input.limit,
              category: input.category,
            },
            deps,
            send,
          );
          summary = s;
          await db.discoveryRun.update({
            where: { id: run.id },
            data: {
              status: "COMPLETED",
              finishedAt: new Date(),
              stats: {
                searched: s.searched,
                researched: s.researched,
                analyzed: s.analyzed,
                qualified: s.qualified,
                duplicates: s.duplicates,
              },
            },
          });
        } catch (err) {
          const message =
            err instanceof DiscoveryError ? err.message : "Discovery pipeline failed.";
          await db.discoveryRun.update({
            where: { id: run.id },
            data: { status: "FAILED", finishedAt: new Date(), error: message },
          });
          send({ type: "error", message });
        } finally {
          if (summary) {
            await recordDiscoveryUsage(ctx.organization.id, {
              searches: 1,
              records: summary.searched,
            });
            await audit({
              organizationId: ctx.organization.id,
              actorId: ctx.user.id,
              action: "discovery.pipeline",
              resource: "DiscoveryRun",
              resourceId: run.id,
              metadata: {
                provider: provider.id,
                industry: input.industry,
                location: input.location,
                ...summary,
              },
              req,
            });
          }
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
  { minRole: "SALES_EXECUTIVE" },
);
