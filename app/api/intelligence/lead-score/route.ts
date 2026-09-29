import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { leadScoreSchema } from "@/lib/validators";
import {
  calculateScore,
  SCORING_VERSION,
  type ScoringIntelligenceInput,
} from "@/lib/intelligence/scoring";
import { enrichScoreWithAI } from "@/lib/intelligence/scoring-ai";
import { isAIConfigured } from "@/lib/intelligence/ai-provider";
import {
  checkLeadScoringQuota,
  recordLeadScoringUsage,
  checkAiIntelligenceQuota,
  recordAiIntelligenceUsage,
} from "@/lib/quotas";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * POST /api/intelligence/lead-score
 * Body: { leadId }
 *
 * Computes the deterministic WDD Sales Opportunity Score (0–100) from
 * verified data. Gemini enrichment is OPTIONAL: when configured (and AI
 * quota allows), it adds a qualitative interpretation that never changes
 * the score. Without a key, deterministic scoring still works fully.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(
      `lead-score:${ctx.user.id}`,
      LIMITS.leadScore,
    );
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = leadScoreSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Tenant-scoped lead resolution — the client never supplies an org id.
    const lead = await db.lead.findFirst({
      where: { id: parsed.data.leadId, organizationId: ctx.organization.id },
      include: {
        company: true,
        websiteInspections: {
          where: { status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        intelligenceReports: {
          where: { status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!lead) {
      return NextResponse.json({ error: "LEAD_NOT_FOUND" }, { status: 404 });
    }

    const quota = await checkLeadScoringQuota(ctx.organization.id);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: "SCORING_QUOTA_EXCEEDED",
          reason: quota.reason,
          quota: { used: quota.used, limit: quota.limit },
        },
        { status: 403 },
      );
    }

    const inspection = lead.websiteInspections[0] ?? null;
    const intelReport = lead.intelligenceReports[0] ?? null;

    let intelligenceInput: ScoringIntelligenceInput | null = null;
    if (intelReport) {
      const intel = (intelReport.intelligence ?? {}) as {
        recommendedServices?: { statement?: string }[];
      };
      intelligenceInput = {
        id: intelReport.id,
        confidence: intelReport.confidence,
        intelligence: {
          recommendedServices: Array.isArray(intel.recommendedServices)
            ? intel.recommendedServices
            : [],
        },
      };
    }

    // Deterministic score — always computed, never needs Gemini.
    const result = calculateScore(
      {
        id: lead.id,
        fullName: lead.fullName,
        website: lead.website,
        phone: lead.phone,
        email: lead.email,
        industry: lead.industry,
        city: lead.city,
        country: lead.country,
        location: lead.location,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
        externalId: lead.externalId,
        sourceUrl: lead.sourceUrl,
        company: lead.company
          ? {
              id: lead.company.id,
              name: lead.company.name,
              website: lead.company.website,
              industry: lead.company.industry,
              city: lead.company.city,
              country: lead.company.country,
            }
          : null,
      },
      inspection
        ? {
            id: inspection.id,
            findings: (inspection.findings ?? {}) as Record<string, unknown>,
          }
        : null,
      intelligenceInput,
    );

    // Optional AI enrichment — only when configured, quota checked FIRST.
    let aiEnriched = false;
    let aiAssessment: {
      interpretation: string;
      keyStrengths: string[];
      keyGaps: string[];
      suggestedNextStep: string;
      provenance: string;
    } | null = null;
    let aiModel: string | null = null;
    const warnings = [...result.warnings];
    if (isAIConfigured()) {
      const aiQuota = await checkAiIntelligenceQuota(ctx.organization.id);
      if (!aiQuota.allowed) {
        warnings.push(
          "AI enrichment skipped: daily AI quota reached. Deterministic score unaffected.",
        );
      } else {
        try {
          const enriched = await enrichScoreWithAI(
            result,
            lead.fullName ?? lead.company?.name ?? null,
          );
          if (enriched) {
            aiEnriched = true;
            aiModel = enriched.model;
            aiAssessment = {
              ...enriched.assessment,
              provenance: enriched.provenance,
            };
            await recordAiIntelligenceUsage(ctx.organization.id);
            await db.aIUsage.create({
              data: {
                organizationId: ctx.organization.id,
                userId: ctx.user.id,
                provider: "gemini",
                model: enriched.model,
                operation: "lead-scoring-enrichment",
                tokensIn: enriched.usage.inputTokens,
                tokensOut: enriched.usage.outputTokens,
              },
            });
          }
        } catch (err) {
          // Enrichment failure never blocks the deterministic score.
          warnings.push(
            `AI enrichment failed (${err instanceof Error ? err.message : "unknown error"}). Deterministic score unaffected.`,
          );
        }
      }
    }

    // Every scoring run creates a new traceable record — history preserved.
    const record = await db.leadScore.create({
      data: {
        organizationId: ctx.organization.id,
        leadId: lead.id,
        score: result.score,
        scoreBand: result.scoreBand,
        scoringVersion: SCORING_VERSION,
        factors: result.factors as object,
        evidence: result.evidence as object,
        confidence: intelligenceInput?.confidence ?? null,
        provider: aiEnriched ? "gemini" : "deterministic",
        aiEnriched,
        aiAssessment: aiAssessment ?? undefined,
        warnings: warnings as object,
        breakdown: {},
        model: aiEnriched && aiModel ? `wdd-scoring-v1+${aiModel}` : "wdd-scoring-v1",
      },
    });

    await recordLeadScoringUsage(ctx.organization.id);
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "intelligence.lead_score",
      resource: "LeadScore",
      resourceId: record.id,
      metadata: {
        leadId: lead.id,
        score: result.score,
        scoreBand: result.scoreBand,
        aiEnriched,
      },
      req,
    });

    return NextResponse.json({
      score: {
        id: record.id,
        score: result.score,
        scoreBand: result.scoreBand,
        factors: result.factors,
        evidence: result.evidence,
        warnings,
        scoringVersion: SCORING_VERSION,
        aiEnriched,
        aiAssessment,
        confidence: record.confidence,
        createdAt: record.createdAt,
      },
    });
  },
  { minRole: "SALES_EXECUTIVE" },
);

const latestQuerySchema = z.object({
  leadId: z.string().cuid(),
});

/**
 * GET /api/intelligence/lead-score?leadId=
 * Latest WDD Sales Opportunity Score for a lead in this workspace.
 */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const parsed = latestQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_QUERY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const lead = await db.lead.findFirst({
    where: { id: parsed.data.leadId, organizationId: ctx.organization.id },
    select: { id: true },
  });
  if (!lead) {
    return NextResponse.json({ error: "LEAD_NOT_FOUND" }, { status: 404 });
  }

  const latest = await db.leadScore.findFirst({
    where: { organizationId: ctx.organization.id, leadId: lead.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ score: latest });
});
