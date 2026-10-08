import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { getTodayDay } from "@/lib/prospecting/instagram-plan";
import {
  acquireCandidates,
  mergeCandidates,
  type AgentCandidate,
} from "@/lib/prospecting/acquire";
import {
  findExistingBusinessProspect,
  findExistingInstagramProspect,
} from "@/lib/prospecting/instagram-pipeline";
import {
  classifyIndustry,
  deterministicRelevance,
  type IndustryEvidence,
} from "@/lib/prospecting/industry-classify";
import { verifyCandidate } from "@/lib/prospecting/verification";
import { getDiscoveryProvider } from "@/lib/discovery/registry";
import { getWebSearchProvider } from "@/lib/research/search-provider";
import { getAIProvider } from "@/lib/ai/registry";
import type { ProspectingDayTarget } from "@/lib/prospecting/instagram-discovery";

/**
 * POST /api/prospecting/diagnose — safe production diagnostic (SALES_MANAGER+).
 *
 * Runs the acquisition + verification phases against REAL configured
 * providers and returns truthful diagnostics. It NEVER inserts leads,
 * never researches websites, never generates messages, and never exposes
 * secrets (only CONFIGURED / NOT_CONFIGURED statuses).
 *
 * Response: providers configured, queries attempted, raw candidates,
 * merged candidates, duplicates, verification counts, rejection reasons,
 * sample verified candidates, CRM readiness.
 */
export const POST = withWorkspace(
  async (_req: NextRequest, ctx) => {
    const organizationId = ctx.organization.id;
    const today = await getTodayDay(organizationId);
    if (!today) {
      return NextResponse.json(
        { error: "NO_ACTIVE_PLAN_DAY", message: "No active prospecting plan for today." },
        { status: 422 },
      );
    }
    const { day } = today;

    // Provider configuration (statuses only — never secret values).
    let googlePlaces = "NOT_CONFIGURED";
    try {
      const gp = getDiscoveryProvider("google-places");
      if (gp?.isConfigured()) googlePlaces = "CONFIGURED";
    } catch {
      /* treat as not configured */
    }
    let tavily = "NOT_CONFIGURED";
    try {
      if (getWebSearchProvider().isConfigured()) tavily = "CONFIGURED";
    } catch {
      /* treat as not configured */
    }
    let aiProvider = "NOT_CONFIGURED";
    try {
      if (getAIProvider().isConfigured()) aiProvider = "CONFIGURED";
    } catch {
      /* treat as not configured */
    }

    const target: ProspectingDayTarget = {
      industry: day.industry,
      location: day.location,
      country: day.country,
      businessType: day.businessType,
      targetAudience: day.targetAudience,
      websitePreference: day.websitePreference,
      targetCount: day.targetCount,
    };

    // 1. Acquisition (real providers, bounded pool).
    const acquired = await acquireCandidates(target, { poolSize: 60 });
    const rawCandidates = acquired.candidates.length;

    // 2. Entity merge.
    const merged = mergeCandidates(acquired.candidates);

    // 3. Dedup against CRM (+ outreach items) — counted, not imported.
    let duplicates = 0;
    const deduped: AgentCandidate[] = [];
    const seen = new Set<string>();
    for (const c of merged) {
      const key =
        c.instagramUsername ??
        c.googlePlaceId ??
        c.website ??
        `${c.businessName}|${c.city}`;
      if (!key || seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      const existing = c.instagramUsername
        ? await findExistingInstagramProspect(organizationId, c.instagramUsername)
        : await findExistingBusinessProspect(organizationId, c);
      if (existing) {
        duplicates++;
        continue;
      }
      deduped.push(c);
    }

    // 4. Classify + verify (deterministic screen first; AI only for survivors).
    const verificationCounts: Record<string, number> = {
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      REJECTED: 0,
    };
    const rejectionReasons: Record<string, number> = {};
    const verifiedSamples: {
      businessName: string | null;
      city: string | null;
      confidence: string;
      industryRelevance: number;
      sources: string[];
    }[] = [];
    let aiClassified = 0;

    for (const c of deduped) {
      const evidence: IndustryEvidence = {
        businessName: c.businessName,
        category: c.category,
        location: [c.city, c.country].filter(Boolean).join(", ") || null,
        website: c.website,
        observations: c.address,
        sourceLabels: c.sources.map((s) => s.label),
      };
      const skipAi =
        aiClassified >= 10 || deterministicRelevance(evidence, day.industry) < 40;
      const classification = await classifyIndustry(evidence, day.industry, { skipAi });
      if (classification.classifiedBy === "ai") aiClassified++;

      const verification = verifyCandidate({
        businessName: c.businessName,
        category: c.category,
        city: c.city,
        country: c.country,
        website: c.website,
        phone: c.phone,
        instagramUsername: c.instagramUsername,
        providerId: c.googlePlaceId,
        targetIndustry: day.industry,
        targetLocation: day.location,
        targetCountry: day.country,
        sources: c.sources,
        industryRelevance: classification.relevanceScore,
      });
      verificationCounts[verification.confidence] =
        (verificationCounts[verification.confidence] ?? 0) + 1;

      const importable =
        verification.confidence === "HIGH" ||
        (verification.confidence === "MEDIUM" && classification.relevanceScore >= 60);
      if (!importable) {
        const key =
          verification.confidence === "REJECTED"
            ? "verification_rejected"
            : "low_confidence";
        rejectionReasons[key] = (rejectionReasons[key] ?? 0) + 1;
        continue;
      }
      if (verifiedSamples.length < 5) {
        verifiedSamples.push({
          businessName: c.businessName,
          city: c.city,
          confidence: verification.confidence,
          industryRelevance: classification.relevanceScore,
          sources: c.sources.map((s) => s.label),
        });
      }
    }

    const importableCount = verificationCounts.HIGH + verificationCounts.MEDIUM;
    const crmReady =
      googlePlaces === "CONFIGURED" || tavily === "CONFIGURED"
        ? importableCount > 0
          ? "READY"
          : "NO_IMPORTABLE_CANDIDATES"
        : "NO_SOURCE_CONFIGURED";

    return NextResponse.json({
      industry: day.industry,
      location: day.location,
      country: day.country,
      targetCount: day.targetCount,
      providers: { googlePlaces, tavily, aiProvider },
      acquisition: acquired.sourceNotes.map((n) => ({
        provider: n.provider,
        status: n.status,
        queriesAttempted: n.queriesAttempted ?? 0,
        resultsReturned: n.resultsReturned ?? 0,
        usableCandidates: n.usableCandidates ?? n.count,
        note: n.note,
        ...(n.error ? { error: n.error } : {}),
      })),
      rawCandidates,
      mergedCandidates: merged.length,
      duplicates,
      verificationCounts,
      rejectionReasons,
      verifiedSamples,
      crmReady,
      note: "Diagnostic only — no leads were inserted, no websites researched, no messages generated.",
    });
  },
  { minRole: "SALES_MANAGER" },
);
