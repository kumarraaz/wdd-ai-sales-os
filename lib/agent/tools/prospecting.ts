/**
 * Prospecting agent tools — thin, typed wrappers over the verification
 * layer. No new logic lives here: verification, classification, and entity
 * matching all go through lib/prospecting/*.
 *
 * These tools are read-only compute (no external writes, no outreach), so
 * they don't require human approval — but like every tool they validate
 * input, run in the workspace context, and never invent data.
 */
import { z } from "zod";
import type { ToolDefinition } from "./registry";
import {
  verifyCandidate,
  type VerificationInput,
} from "../../prospecting/verification";
import { classifyIndustry } from "../../prospecting/industry-classify";
import { matchEntities } from "../../prospecting/entity-match";

const sourceRefSchema = z.object({
  provider: z.string().max(60),
  sourceType: z.string().max(40),
  url: z.string().max(1000).optional(),
  retrievedAt: z.string().max(40),
  label: z.string().max(200).optional(),
});

const verifyCandidateSchema = z.object({
  businessName: z.string().max(300).nullish(),
  category: z.string().max(200).nullish(),
  city: z.string().max(120).nullish(),
  country: z.string().max(120).nullish(),
  website: z.string().max(500).nullish(),
  phone: z.string().max(40).nullish(),
  instagramUsername: z.string().max(30).nullish(),
  providerId: z.string().max(200).nullish(),
  targetIndustry: z.string().trim().min(1).max(200),
  targetLocation: z.string().max(120).nullish(),
  targetCountry: z.string().max(120).nullish(),
  sources: z.array(sourceRefSchema).max(8),
  industryRelevance: z.number().int().min(0).max(100).nullish(),
});

export const prospectVerifyCandidateTool: ToolDefinition<typeof verifyCandidateSchema> = {
  name: "prospecting.verifyCandidate",
  description:
    "Verify a prospect candidate against source-backed evidence: identity, industry, location, and source independence. Returns HIGH/MEDIUM/LOW/REJECTED confidence with a source-cited reason. Never invents data.",
  inputSchema: verifyCandidateSchema,
  requiresApproval: false,
  handler: async (_ctx, input) => {
    const verificationInput: VerificationInput = {
      businessName: input.businessName ?? null,
      category: input.category ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      website: input.website ?? null,
      phone: input.phone ?? null,
      instagramUsername: input.instagramUsername ?? null,
      providerId: input.providerId ?? null,
      targetIndustry: input.targetIndustry,
      targetLocation: input.targetLocation ?? null,
      targetCountry: input.targetCountry ?? null,
      sources: input.sources,
      industryRelevance: input.industryRelevance ?? null,
    };
    return verifyCandidate(verificationInput);
  },
};

const classifyIndustrySchema = z.object({
  businessName: z.string().max(300).nullish(),
  category: z.string().max(200).nullish(),
  location: z.string().max(300).nullish(),
  website: z.string().max(500).nullish(),
  observations: z.string().max(2000).nullish(),
  sourceLabels: z.array(z.string().max(120)).max(8),
  targetIndustry: z.string().trim().min(1).max(200),
});

export const prospectClassifyIndustryTool: ToolDefinition<typeof classifyIndustrySchema> = {
  name: "prospecting.classifyIndustry",
  description:
    "Classify a candidate's industry against a target industry using AI reasoning over verified evidence (deterministic fallback when AI is unconfigured). Returns industry, sub-industry, 0-100 relevance, and source-backed reasoning.",
  inputSchema: classifyIndustrySchema,
  requiresApproval: false,
  handler: async (_ctx, input) => {
    return classifyIndustry(
      {
        businessName: input.businessName ?? null,
        category: input.category ?? null,
        location: input.location ?? null,
        website: input.website ?? null,
        observations: input.observations ?? null,
        sourceLabels: input.sourceLabels,
      },
      input.targetIndustry,
    );
  },
};

const entityIdentitySchema = z.object({
  businessName: z.string().max(300).nullish(),
  phone: z.string().max(40).nullish(),
  website: z.string().max(500).nullish(),
  providerId: z.string().max(200).nullish(),
  instagramUsername: z.string().max(30).nullish(),
  city: z.string().max(120).nullish(),
});

const matchEntitiesSchema = z.object({
  a: entityIdentitySchema,
  b: entityIdentitySchema,
});

export const prospectMatchEntitiesTool: ToolDefinition<typeof matchEntitiesSchema> = {
  name: "prospecting.matchEntities",
  description:
    "Deterministically match two candidate identities (phone, domain, provider id, Instagram username, normalized name + city). Returns MATCHED/POSSIBLE/UNKNOWN/NOT_MATCHED with 0-100 confidence and the signals that fired. Never invents a match.",
  inputSchema: matchEntitiesSchema,
  requiresApproval: false,
  handler: async (_ctx, input) => {
    const toIdentity = (x: z.infer<typeof entityIdentitySchema>) => ({
      businessName: x.businessName ?? null,
      phone: x.phone ?? null,
      website: x.website ?? null,
      providerId: x.providerId ?? null,
      instagramUsername: x.instagramUsername ?? null,
      city: x.city ?? null,
    });
    return matchEntities(toIdentity(input.a), toIdentity(input.b));
  },
};
