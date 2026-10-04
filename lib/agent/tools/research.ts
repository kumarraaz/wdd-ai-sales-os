/**
 * Research tools (Phase 2).
 *
 * Typed wrappers over the existing intelligence layer. No new research
 * logic: website inspection goes through runWebsiteInspection (the existing
 * SSRF-safe path — no new fetch implementation here), AI intelligence
 * through generateLeadIntelligence, scoring through the deterministic
 * calculateScore. Provenance semantics (VERIFIED_DATA / AI_INFERENCE /
 * USER_PROVIDED / DEMO_DATA) are preserved by the wrapped functions.
 */
import { z } from "zod";
import { runWebsiteInspection } from "../../intelligence/inspect";
import { generateLeadIntelligence } from "../../intelligence/generate";
import { calculateScore } from "../../intelligence/scoring";
import { getLead } from "../../leads";
import { SafeFetchError } from "../../intelligence/safe-fetch";
import { IntelligenceError } from "../../intelligence/generate";
import type {
  AIInputCompany,
  AIInputInspection,
  AIInputLead,
} from "../../intelligence/prompt";
import type { WebsiteFindings } from "../../intelligence/inspect";
import type { ToolDefinition } from "./registry";
import { ToolError } from "./registry";

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid http(s) URL." },
  );

export const researchWebsiteSchema = z
  .object({
    url: httpUrl,
  })
  .strict();

export type ResearchWebsiteInput = z.infer<typeof researchWebsiteSchema>;

export const researchWebsiteTool: ToolDefinition<typeof researchWebsiteSchema> = {
  name: "research.website",
  description:
    "Inspect a website through the existing SSRF-safe inspection pipeline (DNS validation, safe fetch, robots/sitemap/favicon probes). Returns structured technical findings. Read-only.",
  inputSchema: researchWebsiteSchema,
  requiresApproval: false,
  handler: async (_ctx, input): Promise<WebsiteFindings> => {
    try {
      return await runWebsiteInspection(input.url);
    } catch (err) {
      if (err instanceof SafeFetchError) {
        throw new ToolError("WEBSITE_UNREACHABLE", err.message);
      }
      throw err;
    }
  },
};

export const researchLeadSchema = z
  .object({
    /** CRM lead id (must belong to the caller's organization). */
    leadId: z.string().cuid(),
    /** Optional website override; otherwise the lead's stored website is used. */
    website: httpUrl.optional(),
  })
  .strict();

export type ResearchLeadInput = z.infer<typeof researchLeadSchema>;

export const researchLeadTool: ToolDefinition<typeof researchLeadSchema> = {
  name: "research.lead",
  description:
    "Research a CRM lead: optionally inspects its website (SSRF-safe), generates AI intelligence from verified data only, and computes the deterministic lead score. Returns intelligence plus score.",
  inputSchema: researchLeadSchema,
  requiresApproval: false,
  handler: async (ctx, input) => {
    const lead = await getLead(ctx.organization.id, input.leadId);
    if (!lead) {
      throw new ToolError(
        "LEAD_NOT_FOUND",
        "Lead not found in this organization.",
      );
    }

    const website = input.website ?? lead.website ?? undefined;
    let findings: WebsiteFindings | null = null;
    if (website) {
      try {
        findings = await runWebsiteInspection(website);
      } catch (err) {
        if (err instanceof SafeFetchError) {
          throw new ToolError("WEBSITE_UNREACHABLE", err.message);
        }
        throw err;
      }
    }

    const aiLead: AIInputLead = {
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
    };
    const aiCompany: AIInputCompany | null = lead.company
      ? {
          id: lead.company.id,
          name: lead.company.name,
          website: lead.company.website,
          industry: lead.company.industry,
          city: lead.company.city,
          country: lead.company.country,
        }
      : null;
    const aiInspection: AIInputInspection | null = findings
      ? {
          id: lead.id,
          requestedUrl: findings.requestedUrl,
          findings: findings as unknown as Record<string, unknown>,
        }
      : null;

    try {
      const intelligence = await generateLeadIntelligence(
        aiLead,
        aiCompany,
        aiInspection,
      );
      const score = calculateScore(
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
          company: aiCompany,
        },
        findings
          ? {
              id: lead.id,
              findings: findings as unknown as Record<string, unknown>,
            }
          : null,
        null,
      );
      return { intelligence, score, websiteInspected: Boolean(findings) };
    } catch (err) {
      if (err instanceof IntelligenceError) {
        throw new ToolError(err.code, err.message);
      }
      throw err;
    }
  },
};
