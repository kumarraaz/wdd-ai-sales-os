import { z } from "zod";

/**
 * Structured AI lead-intelligence schema (Phase 2 Step 3).
 *
 * Every inference and every verified signal MUST cite at least one evidence
 * reference pointing at data that was actually supplied to the model. The
 * server additionally checks that cited fields were really in the AI input
 * (see validateEvidenceRefs in generate.ts).
 */

export const evidenceSourceTypes = [
  "LEAD",
  "COMPANY",
  "GOOGLE_PLACES",
  "WEBSITE_INSPECTION",
  "USER_PROVIDED",
] as const;

export const evidenceRefSchema = z.object({
  sourceType: z.enum(evidenceSourceTypes),
  /** Field in the supplied AI input, e.g. "metaDescription", "rating". */
  field: z.string().min(1).max(120),
  /** Database id of the source record when available. */
  sourceId: z.string().max(64).optional(),
});

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

const verifiedSignalSchema = z.object({
  type: z.literal("VERIFIED_DATA"),
  statement: z.string().min(1).max(500),
  evidence: z.array(evidenceRefSchema).min(1).max(10),
});

const inferenceSchema = z.object({
  type: z.literal("AI_INFERENCE"),
  statement: z.string().min(1).max(500),
  evidence: z.array(evidenceRefSchema).min(1).max(10),
});

export const leadIntelligenceOutputSchema = z.object({
  summary: z.object({
    text: z.string().min(1).max(2000),
    evidence: z.array(evidenceRefSchema).min(1).max(10),
  }),
  /** Business type/category — the model must output "Unknown" when unsupported. */
  businessType: z.string().min(1).max(120),
  verifiedSignals: z.array(verifiedSignalSchema).max(20),
  inferredOpportunities: z.array(inferenceSchema).max(20),
  recommendedServices: z.array(inferenceSchema).max(10),
  salesAngle: z.object({
    text: z.string().min(1).max(1000),
    evidence: z.array(evidenceRefSchema).min(1).max(10),
  }),
  discoveryQuestions: z.array(z.string().min(1).max(300)).max(10),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  confidenceReason: z.string().min(1).max(500),
  evidence: z.array(evidenceRefSchema).max(40),
});

export type LeadIntelligenceOutput = z.infer<typeof leadIntelligenceOutputSchema>;

/** Canonical "field" names the prompt builder may supply per source type. */
export const ALLOWED_EVIDENCE_FIELDS: Record<string, string[]> = {
  LEAD: [
    "fullName",
    "jobTitle",
    "email",
    "phone",
    "website",
    "industry",
    "location",
    "city",
    "country",
    "sourceType",
    "status",
  ],
  COMPANY: ["name", "website", "industry", "location", "city", "country"],
  GOOGLE_PLACES: [
    "name",
    "rating",
    "reviewCount",
    "address",
    "phone",
    "website",
    "placeId",
  ],
  WEBSITE_INSPECTION: [
    "httpStatus",
    "https",
    "responseTimeMs",
    "title",
    "metaDescription",
    "canonicalUrl",
    "robotsMeta",
    "viewportMeta",
    "h1Count",
    "h2Count",
    "imageCount",
    "imagesMissingAlt",
    "internalLinkCount",
    "externalLinkCount",
    "robotsTxt",
    "sitemap",
    "favicon",
    "openGraph",
    "twitterCard",
    "lang",
    "structuredData",
    "mobile",
    "techSignals",
    "contactEmails",
    "contactPhones",
    "socialLinks",
    "redirectChain",
  ],
  USER_PROVIDED: ["note"],
};
