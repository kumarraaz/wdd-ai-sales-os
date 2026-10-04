/**
 * Geoapify Places provider — optional secondary business/POI source.
 *
 * Uses ONLY the official Geoapify APIs:
 *   1. Geocoding API — resolves the location text to a place_id + center.
 *   2. Places API v2 — lists businesses inside that place (or a circle).
 *
 * Role: top-up / fallback when Google Places is not configured. Data
 * quality is NOT assumed equal to Google — every field keeps its provider
 * provenance and website detection is marked "unreliable" (an absent
 * website tag is not proof of no website).
 *
 * Cost: each HTTP request costs ~1 credit (geocode + places). The app-level
 * daily ceiling (default 2,500, vendor free tier 3,000/day) is enforced in
 * lib/discovery/cost.ts — never rely on vendor alerts alone.
 * Key: GEOAPIFY_API_KEY (server-side only, sent as a query param over HTTPS
 * per Geoapify's documented auth scheme; never logged or sent to the browser).
 */
import {
  DiscoveryError,
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoveredCompany,
  type LeadDiscoveryProvider,
  type ProviderCapabilities,
} from "../types";
import type { LeadSourceType } from "@prisma/client";

const GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search";
const PLACES_URL = "https://api.geoapify.com/v2/places";
const USER_AGENT = "WDD-AI-Sales-OS/1.0";

/** Keyword → Geoapify Places categories (conservative mapping). */
const CATEGORY_GROUPS: { match: RegExp; categories: string }[] = [
  { match: /manufactur|factor|industri|plant/i, categories: "commercial.industrial" },
  { match: /wholesal|warehouse|godown|stockist/i, categories: "commercial.warehouse,commercial.industrial" },
  { match: /export/i, categories: "commercial.industrial,commercial" },
  { match: /salon|beauty|hair|spa/i, categories: "commercial.beauty" },
  { match: /gym|fitness/i, categories: "sport.fitness" },
  { match: /restaurant|cafe|café|food|dining|hotel/i, categories: "catering,accommodation" },
  { match: /hospital|clinic|doctor|dental/i, categories: "healthcare" },
  { match: /school|college|coach|tutori/i, categories: "education" },
  { match: /auto|car|garage|service/i, categories: "service.vehicle,commercial" },
];

function categoriesFor(keyword: string): string {
  for (const g of CATEGORY_GROUPS) {
    if (g.match.test(keyword)) return g.categories;
  }
  return "commercial";
}

function readEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

function toSafeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

interface GeocodeFeature {
  properties?: {
    place_id?: string;
    lat?: number;
    lon?: number;
    formatted?: string;
  };
}

interface PlacesFeature {
  properties?: {
    place_id?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    suburb?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
    formatted?: string;
    website?: string;
    phone?: string;
    email?: string;
    categories?: string[];
    datasource?: {
      raw?: Record<string, unknown>;
    };
  };
}

export class GeoapifyProvider implements LeadDiscoveryProvider {
  readonly id = "geoapify";
  readonly label = "Geoapify Places";
  readonly sourceType: LeadSourceType = "GEOAPIFY";
  readonly searchable = true;
  readonly capabilities: ProviderCapabilities = {
    websiteAuthority: "unreliable",
    supportsPhone: true,
    supportsEmail: true,
    supportsSocial: false,
    supportsPagination: false,
    supportsRecentEvidence: false,
    discoverySupported: true,
  };

  private fetcher: typeof fetch;

  /** fetcher is injectable so tests can mock the Geoapify API. */
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  isConfigured(): boolean {
    return !!readEnv("GEOAPIFY_API_KEY");
  }

  setupInstructions(): string[] {
    return [
      "Create a free account at geoapify.com (3,000 credits/day free).",
      "Create an API key in the Geoapify dashboard.",
      'Set GEOAPIFY_API_KEY="<your-key>" in your server environment.',
      "The app enforces a 2,500 credits/day internal safety ceiling — see GEOAPIFY_DAILY_CEILING.",
      "Restart the app server so the new variable is loaded.",
    ];
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const apiKey = readEnv("GEOAPIFY_API_KEY");
    if (!apiKey) return { ok: false, message: "GEOAPIFY_API_KEY is not set." };
    try {
      const url = `${GEOCODE_URL}?text=${encodeURIComponent("New Delhi, India")}&limit=1&apiKey=${encodeURIComponent(apiKey)}`;
      const res = await this.fetcher(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) {
        return { ok: false, message: `Geoapify returned HTTP ${res.status}. Check the API key.` };
      }
      return { ok: true, message: "Connected — Geoapify Geocoding responded." };
    } catch (err) {
      return {
        ok: false,
        message: `Could not reach Geoapify: ${err instanceof Error ? err.message : "network error"}`,
      };
    }
  }

  private async geocode(apiKey: string, text: string): Promise<{ placeId?: string; lat?: number; lon?: number }> {
    const url =
      `${GEOCODE_URL}?text=${encodeURIComponent(text)}` +
      `&limit=1&apiKey=${encodeURIComponent(apiKey)}`;
    let res: Response;
    try {
      res = await this.fetcher(url, { headers: { "User-Agent": USER_AGENT } });
    } catch (err) {
      throw new DiscoveryError(
        "PROVIDER_UNREACHABLE",
        "Could not reach the Geoapify API.",
        err instanceof Error ? err.message : undefined,
      );
    }
    if (!res.ok) {
      if (res.status === 429) {
        throw new DiscoveryError("RATE_LIMITED", "Geoapify rate limit hit. Try again later.");
      }
      if (res.status === 401 || res.status === 403) {
        throw new DiscoveryError("PROVIDER_NOT_CONFIGURED", "Geoapify API key rejected. Check GEOAPIFY_API_KEY.");
      }
      throw new DiscoveryError("PROVIDER_ERROR", `Geoapify returned HTTP ${res.status}.`);
    }
    const data = (await res.json()) as { features?: GeocodeFeature[] };
    const props = data.features?.[0]?.properties;
    return { placeId: props?.place_id, lat: props?.lat, lon: props?.lon };
  }

  private mapFeature(f: PlacesFeature): DiscoveredCompany | null {
    const p = f.properties;
    if (!p) return null;
    const rawId = p.place_id?.trim() || p.datasource?.raw?.["@id"];
    const providerId = typeof rawId === "string" ? rawId : String(rawId ?? "");
    const name = p.name?.trim();
    if (!providerId || !name) return null;

    const company: DiscoveredCompany = {
      provider: this.id,
      providerId,
      name,
      provenance: "VERIFIED_DATA",
      discoveredAt: new Date().toISOString(),
    };
    if (p.formatted) company.address = p.formatted;
    else {
      const addr = [p.housenumber, p.street, p.suburb].filter(Boolean).join(" ");
      if (addr) company.address = addr;
    }
    if (p.city) company.city = p.city;
    if (p.state) company.state = p.state;
    if (p.country) company.country = p.country;
    if (p.categories?.length) company.category = p.categories[0];

    const raw = p.datasource?.raw ?? {};
    const phone = p.phone ?? raw["contact:phone"] ?? raw["phone"];
    if (typeof phone === "string" && phone.trim()) company.phone = phone.trim();
    const email = p.email ?? raw["contact:email"] ?? raw["email"];
    if (typeof email === "string" && email.trim()) company.email = email.trim();
    const website = toSafeHttpUrl(p.website ?? raw["contact:website"] ?? raw["website"]);
    if (website) company.website = website;
    return company;
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const apiKey = readEnv("GEOAPIFY_API_KEY");
    if (!apiKey) {
      throw new DiscoveryError(
        "PROVIDER_NOT_CONFIGURED",
        "Geoapify is not connected. Set GEOAPIFY_API_KEY to enable discovery.",
      );
    }
    if (!query.keyword?.trim()) {
      throw new DiscoveryError("INVALID_QUERY", "A search keyword is required.");
    }

    const locationText = [query.city, query.state, query.country]
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(", ");
    if (!locationText) {
      throw new DiscoveryError("INVALID_QUERY", "A location is required for Geoapify search.");
    }

    // 1 credit: resolve the location.
    const geo = await this.geocode(apiKey, locationText);
    let requestsMade = 1;
    if (!geo.placeId && (geo.lat == null || geo.lon == null)) {
      throw new DiscoveryError("INVALID_QUERY", `Could not resolve location "${locationText}".`);
    }

    // 1 credit: places search within the resolved place (or a circle fallback).
    const filter = geo.placeId
      ? `place:${geo.placeId}`
      : `circle:${geo.lon},${geo.lat},50000`;
    const limit = Math.min(Math.max(query.maxResults, 1), 100);
    const params = new URLSearchParams({
      categories: categoriesFor(query.keyword),
      filter,
      limit: String(limit),
      apiKey,
    });
    // Name bias keeps generic categories relevant to the keyword.
    if (query.keyword.trim().length >= 3 && !/manufactur|trader|export|wholesal|supplier/i.test(query.keyword)) {
      params.set("name", query.keyword.trim());
    }
    let res: Response;
    try {
      res = await this.fetcher(`${PLACES_URL}?${params.toString()}`, {
        headers: { "User-Agent": USER_AGENT },
      });
    } catch (err) {
      throw new DiscoveryError(
        "PROVIDER_UNREACHABLE",
        "Could not reach the Geoapify Places API.",
        err instanceof Error ? err.message : undefined,
      );
    }
    requestsMade++;
    if (!res.ok) {
      if (res.status === 429) {
        throw new DiscoveryError("RATE_LIMITED", "Geoapify rate limit hit. Try again later.");
      }
      throw new DiscoveryError("PROVIDER_ERROR", `Geoapify Places returned HTTP ${res.status}.`);
    }
    const data = (await res.json()) as { features?: PlacesFeature[] };
    const companies: DiscoveredCompany[] = [];
    for (const f of data.features ?? []) {
      const c = this.mapFeature(f);
      if (c) companies.push(c);
    }
    return {
      provider: this.id,
      companies,
      searchedAt: new Date().toISOString(),
      meta: { requestsMade, creditsUsed: requestsMade },
    };
  }
}
