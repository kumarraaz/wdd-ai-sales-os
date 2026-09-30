import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_COOKIE_NAME,
  isDemoModeEnabled,
  validateDemoSession,
} from "@/lib/demo";
import {
  getDemoDiscoveryResults,
  getDemoWebsiteInspection,
  getDemoLeadIntelligence,
} from "@/lib/demo-data";
import {
  runDiscoveryPipeline,
  type PipelineDeps,
  type PipelineEvent,
  type PipelineCompanyResult,
} from "@/lib/discovery/pipeline";
import { calculateScore } from "@/lib/intelligence/scoring";
import type { LeadIntelligenceOutput } from "@/lib/intelligence/intelligence-schema";
import type { WebsiteFindings } from "@/lib/intelligence/inspect";

/**
 * Demo discovery pipeline — SSE stream of DEMO_DATA fixtures.
 *
 * - NEVER calls Google, Gemini, or any external API. No network requests.
 * - NEVER uses withWorkspace: demo tokens must not satisfy production auth.
 * - Website "research" and "AI research" are fictional fixtures, always
 *   labeled DEMO_DATA — never presented as real findings.
 * - Import stays disabled in demo mode (see /api/demo/discovery/import).
 * - Returns 404 when demo mode is off or the token is invalid.
 */
async function demoToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(DEMO_COOKIE_NAME)?.value;
}

export async function POST(req: NextRequest) {
  if (!isDemoModeEnabled() || !validateDemoSession(await demoToken())) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const industry = typeof body?.industry === "string" ? body.industry.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const limit = Math.min(20, Math.max(1, parseInt(String(body?.limit ?? "10"), 10) || 10));
  const websiteFilter =
    body?.websiteFilter === "has_website" || body?.websiteFilter === "no_website"
      ? body.websiteFilter
      : "any";
  const opportunity =
    ["website_improvement", "new_website", "seo"].includes(body?.opportunity)
      ? body.opportunity
      : "any";

  if (!industry || !location) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const deps: PipelineDeps = {
    search: async (query) => ({
      provider: "demo",
      searchedAt: new Date().toISOString(),
      companies: getDemoDiscoveryResults({
        keyword: query.keyword,
        city: query.city,
        country: query.country,
        maxResults: query.maxResults,
      }),
    }),
    // Demo mode has no real CRM database — nothing can be a duplicate.
    checkDuplicate: async () => ({ match: null, matchedLeadId: undefined, existingStatus: null, possible: null }),
    // Fictional inspection — zero network requests.
    researchWebsite: async (url) =>
      getDemoWebsiteInspection(url).findings as unknown as WebsiteFindings,
    // Fictional AI research — clearly labeled DEMO_DATA.
    generateAI: async () => {
      const demo = getDemoLeadIntelligence("demo-lead");
      return {
        output: {
          ...demo.intelligence,
          dataLabel: "DEMO_DATA",
        } as unknown as LeadIntelligenceOutput,
        warnings: ["Demo data — not real research."],
        model: "demo",
        promptVersion: "v1",
        schemaVersion: "v1",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
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
        inspection ? { id: inspection.id, findings: inspection.findings } : null,
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
      try {
        await runDiscoveryPipeline(
          { industry, location, websiteFilter, opportunity, limit },
          deps,
          (event) => {
            // Tag every company result as demo at the transport layer too.
            if (event.type === "company") {
              const r = event.result as PipelineCompanyResult;
              r.company = { ...r.company, provenance: "DEMO_DATA" };
            }
            send(event);
          },
        );
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Demo pipeline failed.",
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
      "X-Accel-Buffering": "no",
    },
  });
}
