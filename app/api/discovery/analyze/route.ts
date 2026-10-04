import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { z } from "zod";
import { discoveredCompanySchema } from "@/lib/validators";
import { getAIProvider } from "@/lib/ai/registry";
import { AIProviderError } from "@/lib/ai/provider";
import { audit } from "@/lib/audit";

const analyzeSchema = z.object({
  candidates: z.array(discoveredCompanySchema).min(1).max(20),
});

const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    analyses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          providerId: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          opportunity: { type: "string" },
          approach: { type: "string" },
          messageDraft: { type: "string" },
          nextAction: { type: "string" },
        },
        required: ["providerId", "priority", "opportunity", "approach", "messageDraft", "nextAction"],
      },
    },
  },
  required: ["analyses"],
};

/**
 * POST /api/discovery/analyze — "Analyze Selected Leads".
 *
 * Runs the SELECTED normalized candidates through the existing AI
 * provider abstraction (single structured generation — not a second
 * agent). Output per lead: priority, opportunity, suggested approach,
 * message draft, next action. AI output is labeled AI_INFERENCE and the
 * model is instructed to use only the provided verified fields.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`ai:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = analyzeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const provider = getAIProvider();
    if (!provider.isConfigured()) {
      return NextResponse.json(
        { error: "AI_NOT_CONFIGURED", message: "No AI provider is configured (set GEMINI_API_KEY or GROQ_API_KEY, or AI_PROVIDER)." },
        { status: 409 },
      );
    }

    const leads = parsed.data.candidates.map((c) => ({
      providerId: c.providerId,
      name: c.name,
      industry: c.category ?? null,
      location: [c.city, c.state, c.country].filter(Boolean).join(", ") || null,
      phone: c.phone ? "available" : null,
      website: c.website ?? null,
      websiteStatus: c.websiteStatus ?? null,
      score: c.score ?? null,
      source: c.provider,
    }));

    const system = [
      "You are a B2B sales analyst for Web Digital Development (WDD), a web development and digital marketing agency.",
      "Analyze each prospect using ONLY the provided fields. Never invent facts.",
      "Prioritize: no-website businesses (strongest WDD opportunity), then contactable prospects in relevant industries.",
      "Return JSON matching the given schema. messageDraft: a 2-3 sentence personalized opener. Keep every string concise.",
    ].join("\n");

    try {
      const gen = await provider.generateJson(
        system,
        `Prospects (JSON):\n${JSON.stringify(leads)}\n\nSchema:\n${JSON.stringify(ANALYSIS_JSON_SCHEMA)}`,
        { maxTokens: 4096, temperature: 0.3 },
      );
      let parsed_out: { analyses?: unknown[] } = {};
      try {
        parsed_out = JSON.parse(gen.text) as { analyses?: unknown[] };
      } catch {
        return NextResponse.json(
          { error: "AI_ERROR", message: "AI returned unparseable output." },
          { status: 502 },
        );
      }
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "discovery.analyze",
        resource: "lead",
        metadata: { count: leads.length, provider: provider.name },
        req,
      });
      return NextResponse.json({
        analyses: Array.isArray(parsed_out.analyses) ? parsed_out.analyses : [],
        provenance: "AI_INFERENCE",
        provider: provider.name,
      });
    } catch (err) {
      if (err instanceof AIProviderError) {
        return NextResponse.json(
          { error: "AI_ERROR", message: err.message },
          { status: 502 },
        );
      }
      throw err;
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
