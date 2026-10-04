import { z } from "zod";

export const leadStatusSchema = z.enum([
  "NEW",
  "RESEARCHING",
  "QUALIFIED",
  "CONTACTED",
  "REPLIED",
  "MEETING",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
  "NURTURE",
]);

export const leadSourceTypeSchema = z.enum([
  "GOOGLE_BUSINESS",
  "GEOAPIFY",
  "OPENSTREETMAP",
  "WEB_SEARCH",
  "WEBSITE_SEARCH",
  "DIRECTORY",
  "META",
  "GOVERNMENT_REGISTRY",
  "CSV",
  "MANUAL",
  "API",
  "DEMO",
]);

export const createLeadSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  jobTitle: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(300).optional(),
  industry: z.string().trim().max(200).optional(),
  location: z.string().trim().max(300).optional(),
  country: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  website: z.string().trim().max(500).optional(),
  status: leadStatusSchema.optional(),
  sourceType: leadSourceTypeSchema.optional(),
  sourceDetail: z.string().trim().max(500).optional(),
  assignedToId: z.string().cuid().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  // discovery fields (Phase 2) — set only from compliant discovery providers
  externalId: z.string().trim().max(200).optional(),
  sourceUrl: z.string().trim().max(1000).optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  discoveredAt: z.string().datetime().optional(),
  // discovery workspace — normalized candidate fields, never invented
  websiteStatus: z.enum(["NO_WEBSITE", "HAS_WEBSITE", "UNKNOWN"]).optional(),
  opportunityType: z
    .enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
    .optional(),
  opportunityReason: z.string().trim().max(500).optional(),
  contactable: z.boolean().optional(),
  leadScore: z.number().int().min(0).max(100).optional(),
  scoreReason: z.string().trim().max(500).optional(),
  googleMapsUrl: z.string().trim().max(1000).optional(),
  instagramUrl: z.string().trim().max(1000).optional(),
  facebookUrl: z.string().trim().max(1000).optional(),
  linkedinUrl: z.string().trim().max(1000).optional(),
  lastVerifiedAt: z.string().datetime().optional(),
});

export const updateLeadSchema = createLeadSchema.partial().extend({
  leadScore: z.number().int().min(0).max(100).optional(),
});

export const listLeadsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: leadStatusSchema.optional(),
  sourceType: leadSourceTypeSchema.optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  tag: z.string().trim().max(60).optional(),
  websiteStatus: z.enum(["NO_WEBSITE", "HAS_WEBSITE", "UNKNOWN"]).optional(),
  contactable: z.coerce.boolean().optional(),
  opportunityType: z
    .enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
    .optional(),
  sort: z.enum(["createdAt", "leadScore", "fullName", "updatedAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const bulkUpdateSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(200),
  status: leadStatusSchema.optional(),
  tagsToAdd: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  tagsToRemove: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  assignedToId: z.string().cuid().nullable().optional(),
});

export const importMappingSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.string()))
    .min(1)
    .max(5000),
  mapping: z.object({
    fullName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    jobTitle: z.string().optional(),
    companyName: z.string().optional(),
    industry: z.string().optional(),
    location: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    website: z.string().optional(),
  }),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

// ── Lead discovery (Phase 2) ─────────────────────────────────────────────

export const discoverySearchSchema = z.object({
  providerId: z.string().trim().min(1).max(60),
  keyword: z.string().trim().min(1).max(200),
  country: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  radiusMeters: z.coerce.number().int().min(100).max(50000).optional(),
  maxResults: z.coerce.number().int().min(1).max(20).default(20),
  category: z.string().trim().max(120).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

export type DiscoverySearchInput = z.infer<typeof discoverySearchSchema>;

export const discoveredCompanySchema = z.object({
  provider: z.string().trim().min(1).max(60),
  providerId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  category: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(320).optional(),
  website: z.string().trim().max(1000).optional(),
  sourceUrl: z.string().trim().max(1000).optional(),
  googleMapsUrl: z.string().trim().max(1000).optional(),
  instagramUrl: z.string().trim().max(1000).optional(),
  facebookUrl: z.string().trim().max(1000).optional(),
  linkedinUrl: z.string().trim().max(1000).optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  discoveredAt: z.string().datetime(),
  lastVerifiedAt: z.string().datetime().optional(),
  provenance: z.enum(["VERIFIED_DATA", "AI_INFERENCE", "USER_PROVIDED", "DEMO_DATA"]),
  // enrichment — computed server-side; accepted here so run results round-trip
  websiteStatus: z.enum(["NO_WEBSITE", "HAS_WEBSITE", "UNKNOWN"]).optional(),
  contactable: z.boolean().optional(),
  opportunityType: z
    .enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])
    .optional(),
  recentEvidenceDate: z.string().datetime().optional(),
  score: z.number().int().min(0).max(100).optional(),
  scoreReason: z.string().max(500).optional(),
  qualification: z.enum(["qualified", "maybe", "not_qualified", "unreviewed"]).optional(),
});

export type DiscoveredCompanyInput = z.infer<typeof discoveredCompanySchema>;

export const discoveryImportSchema = z.object({
  providerId: z.string().trim().min(1).max(60),
  searchQuery: z.string().trim().max(300).optional(),
  companies: z.array(discoveredCompanySchema).min(1).max(100),
  /**
   * Optional pipeline research keyed by company.providerId. Persisted as
   * WebsiteInspection / LeadIntelligence rows on the created leads.
   * JSON-shaped only — never trust nested provider data blindly.
   */
  research: z
    .record(
      z.string(),
      z.object({
        websiteFindings: z.record(z.string(), z.unknown()).optional(),
        aiOutput: z.record(z.string(), z.unknown()).optional(),
        aiWarnings: z.array(z.string().max(500)).max(20).optional(),
      }),
    )
    .optional(),
});

export type DiscoveryImportInput = z.infer<typeof discoveryImportSchema>;

// ── Discovery pipeline (guided: search → research → AI → qualify) ─────────

export const discoveryPipelineSchema = z.object({
  providerId: z.string().trim().min(1).max(60),
  /** Industry / keyword, e.g. "Manufacturers". */
  industry: z.string().trim().min(1).max(200),
  /** Free-text location, e.g. "Gujarat, India". */
  location: z.string().trim().min(1).max(200),
  websiteFilter: z.enum(["any", "has_website", "no_website"]).default("any"),
  opportunity: z
    .enum(["website_improvement", "new_website", "seo", "any"])
    .default("any"),
  /** 1..50 requested; providers cap per their own API limits. */
  limit: z.coerce.number().int().min(1).max(50).default(10),
  category: z.string().trim().max(120).optional(),
});

export type DiscoveryPipelineInput = z.infer<typeof discoveryPipelineSchema>;

// ── Discovery workspace: multi-source run ─────────────────────────────────

export const discoveryRunSchema = z.object({
  sources: z
    .array(
      z.object({
        providerId: z.string().trim().min(1).max(60),
        role: z.enum(["primary", "fallback"]),
      }),
    )
    .min(1)
    .max(10)
    .default([{ providerId: "all", role: "primary" }]),
  industry: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(200),
  websiteFilter: z.enum(["any", "no_website", "has_website"]).default("any"),
  contactRequired: z.boolean().default(true),
  opportunity: z
    .enum(["any", "HIGH", "MEDIUM", "LOW", "new_website", "website_improvement", "seo"])
    .default("any"),
  recentEvidence: z.enum(["any", "30d", "90d", "6m", "1y"]).default("any"),
  /** Desired final candidates after filters. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().trim().max(120).optional(),
  /** Optional saved profile id (for history attribution). */
  profileId: z.string().cuid().optional(),
});

export type DiscoveryRunRequest = z.infer<typeof discoveryRunSchema>;

// ── Website inspection (Phase 2 Step 2) ──────────────────────────────────

export const websiteInspectSchema = z.object({
  /** Website URL to inspect. Optional when leadId is given (uses the lead's website). */
  url: z.string().trim().max(2000).optional(),
  /** Link the inspection to an existing lead in this workspace. */
  leadId: z.string().cuid().optional(),
}).refine((d) => d.url || d.leadId, {
  message: "Either url or leadId is required.",
});

export type WebsiteInspectInput = z.infer<typeof websiteInspectSchema>;

// ── AI lead intelligence (Phase 2 Step 3) ────────────────────────────────

export const leadIntelligenceSchema = z.object({
  leadId: z.string().cuid(),
});

export type LeadIntelligenceInput = z.infer<typeof leadIntelligenceSchema>;

// ── AI lead scoring (Phase 2 Step 4) ─────────────────────────────────────

export const leadScoreSchema = z.object({
  leadId: z.string().cuid(),
});

export type LeadScoreInput = z.infer<typeof leadScoreSchema>;

// ── Instagram Outreach Assistant (human-in-the-loop) ─────────────────────

export const instagramResearchSchema = z.object({
  usernames: z.string().trim().min(1).max(5000),
  name: z.string().trim().max(120).optional(),
});

export type InstagramResearchInput = z.infer<typeof instagramResearchSchema>;

export const instagramItemEditSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const instagramItemLinkSchema = z.object({
  leadId: z.string().cuid().optional(),
  create: z.boolean().optional(),
});
