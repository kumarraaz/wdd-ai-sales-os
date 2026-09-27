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
