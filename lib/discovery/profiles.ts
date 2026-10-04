/**
 * Saved discovery profiles — quick daily source switching without a
 * scheduler. A profile is a named JSON snapshot of the run input:
 * sources + priority, industry, location, filters, desired count, scoring
 * prefs, outreach channel, per-source enabled flags.
 *
 * Config never contains secrets. All queries are tenant-scoped.
 */
import { z } from "zod";
import { db } from "../db";

export const discoveryProfileConfigSchema = z.object({
  sources: z
    .array(
      z.object({
        providerId: z.string().min(1).max(60),
        role: z.enum(["primary", "fallback"]),
        enabled: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(10),
  industry: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(200),
  websiteFilter: z.enum(["any", "no_website", "has_website"]).default("any"),
  contactRequired: z.boolean().default(true),
  opportunity: z.enum(["any", "new_website", "website_improvement", "seo"]).default("any"),
  recentEvidence: z.enum(["any", "30d", "90d", "6m", "1y"]).default("any"),
  limit: z.number().int().min(1).max(100).default(20),
  category: z.string().trim().max(120).optional(),
  /** Minimum score to highlight (informational — never blocks import). */
  minScore: z.number().int().min(0).max(100).default(0),
  outreachChannel: z.enum(["instagram", "linkedin", "whatsapp", "email", "call"]).default("instagram"),
});

export type DiscoveryProfileConfig = z.infer<typeof discoveryProfileConfigSchema>;

export const EXAMPLE_PROFILES: { name: string; config: DiscoveryProfileConfig }[] = [
  {
    name: "Gujarat Manufacturers — No Website",
    config: {
      sources: [
        { providerId: "google-places", role: "primary", enabled: true },
        { providerId: "geoapify", role: "fallback", enabled: true },
        { providerId: "openstreetmap", role: "fallback", enabled: true },
      ],
      industry: "manufacturers",
      location: "Gujarat, India",
      websiteFilter: "no_website",
      contactRequired: true,
      opportunity: "new_website",
      recentEvidence: "any",
      limit: 20,
      minScore: 0,
      outreachChannel: "instagram",
    },
  },
  {
    name: "Delhi Traders — No Website",
    config: {
      sources: [
        { providerId: "google-places", role: "primary", enabled: true },
        { providerId: "tavily", role: "fallback", enabled: true },
        { providerId: "openstreetmap", role: "fallback", enabled: true },
      ],
      industry: "traders",
      location: "Delhi, India",
      websiteFilter: "no_website",
      contactRequired: true,
      opportunity: "new_website",
      recentEvidence: "any",
      limit: 20,
      minScore: 0,
      outreachChannel: "whatsapp",
    },
  },
  {
    name: "India Exporters",
    config: {
      sources: [
        { providerId: "google-places", role: "primary", enabled: true },
        { providerId: "tavily", role: "fallback", enabled: true },
        { providerId: "gemini-grounding", role: "fallback", enabled: false },
      ],
      industry: "exporters",
      location: "India",
      websiteFilter: "any",
      contactRequired: true,
      opportunity: "any",
      recentEvidence: "any",
      limit: 20,
      minScore: 0,
      outreachChannel: "email",
    },
  },
  {
    name: "Website Improvement Prospects",
    config: {
      sources: [
        { providerId: "google-places", role: "primary", enabled: true },
        { providerId: "geoapify", role: "fallback", enabled: true },
      ],
      industry: "hotels",
      location: "Gujarat, India",
      websiteFilter: "has_website",
      contactRequired: true,
      opportunity: "website_improvement",
      recentEvidence: "any",
      limit: 20,
      minScore: 0,
      outreachChannel: "instagram",
    },
  },
];

export async function listProfiles(organizationId: string) {
  return db.discoveryProfile.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, config: true, createdAt: true, updatedAt: true },
  });
}

export async function getProfile(organizationId: string, id: string) {
  return db.discoveryProfile.findFirst({
    where: { id, organizationId },
  });
}

export async function createProfile(
  organizationId: string,
  name: string,
  config: DiscoveryProfileConfig,
) {
  const parsed = discoveryProfileConfigSchema.parse(config);
  return db.discoveryProfile.create({
    data: {
      organizationId,
      name: name.trim().slice(0, 120),
      config: parsed as never,
    },
  });
}

export async function updateProfile(
  organizationId: string,
  id: string,
  patch: { name?: string; config?: DiscoveryProfileConfig },
) {
  const data: { name?: string; config?: never } = {};
  if (patch.name !== undefined) data.name = patch.name.trim().slice(0, 120);
  if (patch.config !== undefined) {
    data.config = discoveryProfileConfigSchema.parse(patch.config) as never;
  }
  return db.discoveryProfile.updateMany({
    where: { id, organizationId },
    data,
  });
}

export async function deleteProfile(organizationId: string, id: string) {
  return db.discoveryProfile.deleteMany({ where: { id, organizationId } });
}

/** Seed the example profiles for a workspace that has none. Idempotent. */
export async function seedExampleProfiles(organizationId: string): Promise<number> {
  const existing = await db.discoveryProfile.count({ where: { organizationId } });
  if (existing > 0) return 0;
  let created = 0;
  for (const ex of EXAMPLE_PROFILES) {
    try {
      await createProfile(organizationId, ex.name, ex.config);
      created++;
    } catch {
      // Name collision — skip.
    }
  }
  return created;
}
