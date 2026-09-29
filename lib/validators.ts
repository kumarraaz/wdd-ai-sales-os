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
  "WEBSITE_SEARCH",
  "DIRECTORY",
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
  website: z.string().trim().max(1000).optional(),
  sourceUrl: z.string().trim().max(1000).optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  discoveredAt: z.string().datetime(),
  provenance: z.enum(["VERIFIED_DATA", "AI_INFERENCE", "USER_PROVIDED", "DEMO_DATA"]),
});

export type DiscoveredCompanyInput = z.infer<typeof discoveredCompanySchema>;

export const discoveryImportSchema = z.object({
  providerId: z.string().trim().min(1).max(60),
  searchQuery: z.string().trim().max(300).optional(),
  companies: z.array(discoveredCompanySchema).min(1).max(100),
});

export type DiscoveryImportInput = z.infer<typeof discoveryImportSchema>;

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
