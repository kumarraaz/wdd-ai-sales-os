import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { leadIntelligenceSchema } from "@/lib/validators";
import {
  generateLeadIntelligence,
  IntelligenceError,
} from "@/lib/intelligence/generate";
import { isAIConfigured } from "@/lib/intelligence/ai-provider";
import {
  checkAiIntelligenceQuota,
  recordAiIntelligenceUsage,
} from "@/lib/quotas";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * POST /api/intelligence/lead
 * Body: { leadId }
 *
 * Generates structured AI lead intelligence from existing verified data
 * (lead, company, Google Places discovery fields, latest website
 * inspection). The AI layer never crawls, never searches the web, and
 * never invents facts — every inference must cite supplied evidence.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(
      `ai-intelligence:${ctx.user.id}`,
      LIMITS.aiIntelligence,
    );
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = leadIntelligenceSchema.safeParse(body);
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
      },
    });
    if (!lead) {
      return NextResponse.json({ error: "LEAD_NOT_FOUND" }, { status: 404 });
    }

    const inspection = lead.websiteInspections[0] ?? null;

    const record = await db.leadIntelligence.create({
      data: {
        organizationId: ctx.organization.id,
        leadId: lead.id,
        companyId: lead.companyId,
        status: "RUNNING",
        provider: "gemini",
      },
    });

    const fail = async (code: string, message: string, status: number) => {
      const failed = await db.leadIntelligence.update({
        where: { id: record.id },
        data: { status: "FAILED", error: `${code}: ${message}` },
      });
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "intelligence.lead_generate",
        resource: "LeadIntelligence",
        resourceId: record.id,
        result: "FAILED",
        // Never store prompt content or keys in audit logs.
        metadata: { leadId: lead.id, code },
        req,
      });
      return NextResponse.json(
        { error: code, message, intelligence: failed },
        { status },
      );
    };

    // Order of checks: configured → quota → generate. Quota is enforced
    // BEFORE any external AI call.
    if (!isAIConfigured()) {
      return fail("AI_NOT_CONFIGURED", "AI Intelligence is not configured.", 503);
    }

    const quota = await checkAiIntelligenceQuota(ctx.organization.id);
    if (!quota.allowed) {
      return fail(
        "AI_QUOTA_EXCEEDED",
        quota.reason ?? "Daily AI intelligence limit reached.",
        403,
      );
    }

    try {
      const result = await generateLeadIntelligence(
        {
          id: lead.id,
          fullName: lead.fullName,
          jobTitle: lead.jobTitle,
          email: lead.email,
          phone: lead.phone,
          website: lead.website,
          industry: lead.industry,
          location: lead.location,
          city: lead.city,
          country: lead.country,
          sourceType: lead.sourceType,
          status: lead.status,
          externalId: lead.externalId,
          sourceUrl: lead.sourceUrl,
          rating: lead.rating,
          reviewCount: lead.reviewCount,
        },
        lead.company
          ? {
              id: lead.company.id,
              name: lead.company.name,
              website: lead.company.website,
              industry: lead.company.industry,
              location: lead.company.location,
              city: lead.company.city,
              country: lead.company.country,
            }
          : null,
        inspection
          ? {
              id: inspection.id,
              requestedUrl: inspection.requestedUrl,
              findings: (inspection.findings ?? {}) as Record<string, unknown>,
            }
          : null,
      );

      const done = await db.leadIntelligence.update({
        where: { id: record.id },
        data: {
          status: "COMPLETED",
          model: result.model,
          promptVersion: result.promptVersion,
          schemaVersion: result.schemaVersion,
          intelligence: result.output as object,
          confidence: result.output.confidence,
          warnings: result.warnings as object,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
        },
      });

      await recordAiIntelligenceUsage(ctx.organization.id);
      await db.aIUsage.create({
        data: {
          organizationId: ctx.organization.id,
          userId: ctx.user.id,
          provider: "gemini",
          model: result.model,
          operation: "lead-intelligence",
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
        },
      });
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "intelligence.lead_generate",
        resource: "LeadIntelligence",
        resourceId: done.id,
        metadata: {
          leadId: lead.id,
          model: result.model,
          confidence: result.output.confidence,
        },
        req,
      });

      return NextResponse.json({ intelligence: done });
    } catch (err) {
      const code =
        err instanceof IntelligenceError ? err.code : "PROVIDER_ERROR";
      const message =
        err instanceof Error ? err.message : "AI intelligence generation failed.";
      // Map generation errors to HTTP status codes without crashing.
      const status =
        code === "INSUFFICIENT_DATA"
          ? 422
          : code === "NOT_CONFIGURED"
            ? 503
            : code === "TIMEOUT" || code === "PROVIDER_ERROR"
              ? 502
              : 500;
      return fail(code, message, status);
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);

const latestQuerySchema = z.object({
  leadId: z.string().cuid(),
});

/**
 * GET /api/intelligence/lead?leadId=
 * Latest AI lead-intelligence report for a lead in this workspace.
 * Each generation creates a new record; history is preserved, never
 * silently overwritten.
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

  // Verify the lead belongs to this workspace before revealing anything.
  const lead = await db.lead.findFirst({
    where: { id: parsed.data.leadId, organizationId: ctx.organization.id },
    select: { id: true },
  });
  if (!lead) {
    return NextResponse.json({ error: "LEAD_NOT_FOUND" }, { status: 404 });
  }

  const latest = await db.leadIntelligence.findFirst({
    where: { organizationId: ctx.organization.id, leadId: lead.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ intelligence: latest });
});
