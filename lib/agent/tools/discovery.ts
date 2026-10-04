/**
 * Discovery tools (Phase 2).
 *
 * Thin, typed wrappers over the existing discovery layer. No new discovery
 * logic lives here: search goes through lib/discovery/registry.ts and the
 * registered LeadDiscoveryProvider implementations; import goes through
 * lib/discovery/import.ts with its existing duplicate detection and
 * provenance handling.
 *
 * Compliance: the existing provider rules apply unchanged — official/public
 * APIs only, no scraping, no CAPTCHA bypass, no proxy rotation, no fake
 * accounts. Results carry provider provenance; nothing is fabricated.
 */
import { z } from "zod";
import {
  getDiscoveryProvider,
  listDiscoveryProviders,
} from "../../discovery/registry";
import { importDiscoveredCompanies } from "../../discovery/import";
import { DiscoveryError } from "../../discovery/types";
import type {
  DiscoveredCompany,
  DiscoveryQuery,
  DataProvenance,
} from "../../discovery/types";
import type { ToolDefinition } from "./registry";
import { ToolError } from "./registry";

/** Resolve a searchable provider: explicit id, else first searchable+configured. */
function resolveSearchProvider(providerId?: string) {
  if (providerId) {
    const provider = getDiscoveryProvider(providerId);
    if (!provider) {
      throw new ToolError(
        "UNKNOWN_PROVIDER",
        `Unknown discovery provider "${providerId}".`,
      );
    }
    if (!provider.searchable) {
      throw new ToolError(
        "SEARCH_UNSUPPORTED",
        `Discovery provider "${providerId}" cannot run searches.`,
      );
    }
    if (!provider.isConfigured()) {
      throw new ToolError(
        "PROVIDER_NOT_CONFIGURED",
        `Discovery provider "${providerId}" is not configured.`,
      );
    }
    return provider;
  }
  const fallback = listDiscoveryProviders().find(
    (p) => p.searchable && p.isConfigured(),
  );
  if (!fallback) {
    throw new ToolError(
      "PROVIDER_NOT_CONFIGURED",
      "No discovery provider is configured for searching.",
    );
  }
  return fallback;
}

const provenanceSchema = z.enum([
  "VERIFIED_DATA",
  "AI_INFERENCE",
  "USER_PROVIDED",
  "DEMO_DATA",
]) as z.ZodType<DataProvenance>;

/** Mirrors DiscoveryQuery — the normalized query every provider understands. */
export const discoverySearchSchema = z
  .object({
    keyword: z.string().trim().min(1).max(200),
    country: z.string().trim().max(120).optional(),
    state: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    radiusMeters: z.number().positive().max(100_000).optional(),
    maxResults: z.number().int().min(1).max(20).default(10),
    category: z.string().trim().max(120).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    /** Discovery provider id, e.g. "openstreetmap". Defaults to the first searchable, configured provider. */
    provider: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

export type DiscoverySearchInput = z.infer<typeof discoverySearchSchema>;

export const discoverySearchTool: ToolDefinition<typeof discoverySearchSchema> = {
  name: "discovery.search",
  description:
    "Search for business prospects using a compliant discovery provider (e.g. OpenStreetMap). Returns normalized companies with source provenance. Never invents company data.",
  inputSchema: discoverySearchSchema,
  requiresApproval: false,
  handler: async (_ctx, input) => {
    const provider = resolveSearchProvider(input.provider);
    const query: DiscoveryQuery = {
      keyword: input.keyword,
      country: input.country,
      state: input.state,
      city: input.city,
      radiusMeters: input.radiusMeters,
      maxResults: input.maxResults,
      category: input.category,
      latitude: input.latitude,
      longitude: input.longitude,
    };
    try {
      return await provider.search(query);
    } catch (err) {
      if (err instanceof DiscoveryError) {
        throw new ToolError(err.code, err.message);
      }
      throw err;
    }
  },
};

const discoveredCompanySchema = z
  .object({
    provider: z.string().min(1).max(60),
    providerId: z.string().min(1).max(300),
    name: z.string().min(1).max(300),
    category: z.string().max(200).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    country: z.string().max(120).optional(),
    phone: z.string().max(40).optional(),
    website: z.string().max(500).optional(),
    sourceUrl: z.string().max(1000).optional(),
    rating: z.number().min(0).max(5).optional(),
    reviewCount: z.number().int().min(0).optional(),
    discoveredAt: z.string().datetime(),
    provenance: provenanceSchema,
  })
  .strict();

export const discoveryImportSchema = z
  .object({
    /** Discovery provider id whose import rules apply, e.g. "openstreetmap". */
    provider: z.string().trim().min(1).max(60),
    companies: z.array(discoveredCompanySchema).min(1).max(100),
    searchQuery: z.string().trim().max(300).optional(),
  })
  .strict();

export type DiscoveryImportInput = z.infer<typeof discoveryImportSchema>;

export const discoveryImportTool: ToolDefinition<typeof discoveryImportSchema> = {
  name: "discovery.import",
  description:
    "Import discovered companies as CRM leads using the existing import pipeline (duplicate detection, provenance labels, org isolation). Organization and actor come from the server context, never from input.",
  inputSchema: discoveryImportSchema,
  requiresApproval: false,
  handler: async (ctx, input) => {
    const provider = getDiscoveryProvider(input.provider);
    if (!provider) {
      throw new ToolError(
        "UNKNOWN_PROVIDER",
        `Unknown discovery provider "${input.provider}".`,
      );
    }
    const companies: DiscoveredCompany[] = input.companies;
    return importDiscoveredCompanies(
      ctx.organization.id,
      ctx.user.id,
      provider,
      companies,
      { searchQuery: input.searchQuery },
    );
  },
};
