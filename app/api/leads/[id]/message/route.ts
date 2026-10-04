import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { z } from "zod";
import { getLead } from "@/lib/leads";
import { getAIProvider } from "@/lib/ai/registry";
import { AIProviderError } from "@/lib/ai/provider";
import { audit } from "@/lib/audit";

const messageSchema = z.object({
  channel: z.enum(["instagram", "facebook", "linkedin", "whatsapp", "email", "call"]).default("instagram"),
});

const CHANNEL_INSTRUCTIONS: Record<string, string> = {
  instagram: "a short Instagram DM (under 500 characters), friendly and direct",
  facebook: "a short Facebook message (under 500 characters), friendly and direct",
  linkedin: "a concise LinkedIn connection note (under 300 characters), professional",
  whatsapp: "a short WhatsApp message (under 400 characters), warm and direct",
  email: "a short cold email (subject line + under 120 words), professional",
  call: "a 30-second call opener script, natural spoken language",
};

/**
 * POST /api/leads/[id]/message — generate a personalized outreach message.
 *
 * Draft-first: the message is returned for the user to COPY and send
 * manually. Nothing is sent automatically. The message is AI-generated
 * (labeled AI_INFERENCE) from the lead's VERIFIED fields only — the model
 * is instructed never to invent facts.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`ai:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const lead = await getLead(ctx.organization.id, id);
    if (!lead) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const companyName = lead.company?.name ?? "your business";
    const facts = [
      `Business: ${companyName}`,
      lead.industry ? `Industry: ${lead.industry}` : null,
      [lead.city, lead.state, lead.country].filter(Boolean).length > 0
        ? `Location: ${[lead.city, lead.state, lead.country].filter(Boolean).join(", ")}`
        : null,
      lead.websiteStatus === "NO_WEBSITE"
        ? "Website: none found (verified — no website listed by the source)"
        : lead.website
          ? `Website: ${lead.website}`
          : null,
    ]
      .filter(Boolean)
      .join("\n");

    const system = [
      "You write outreach messages for Web Digital Development (WDD), a web development and digital marketing agency.",
      "Rules:",
      "- Use ONLY the facts provided. Never invent names, numbers, revenue, or claims.",
      "- Write in a natural, human tone — no robotic AI phrasing, no excessive flattery.",
      "- Mention WDD once. End with a soft call to action (a quick reply / 10-min call).",
      "- Keep it short and specific to this business.",
    ].join("\n");
    const user = `Write ${CHANNEL_INSTRUCTIONS[parsed.data.channel]} for this prospect:\n${facts}`;

    try {
      const provider = getAIProvider();
      if (!provider.isConfigured()) {
        return NextResponse.json(
          { error: "AI_NOT_CONFIGURED", message: "No AI provider is configured (set GEMINI_API_KEY or GROQ_API_KEY, or AI_PROVIDER)." },
          { status: 409 },
        );
      }
      const gen = await provider.generateText(system, user, { maxTokens: 400, temperature: 0.5 });
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "lead.message.generate",
        resource: "lead",
        resourceId: lead.id,
        metadata: { channel: parsed.data.channel, provider: provider.name },
        req,
      });
      return NextResponse.json({
        message: gen.text,
        channel: parsed.data.channel,
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
