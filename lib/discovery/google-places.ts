/**
 * Google Places provider — the primary discovery source.
 *
 * Uses ONLY the official Places API (New) Text Search endpoint. No scraping,
 * no CAPTCHA/bot-protection bypass, no proxy rotation, no fake accounts.
 * The API key lives server-side in GOOGLE_PLACES_API_KEY and is sent as the
 * X-Goog-Api-Key header — it is never placed in a URL, never logged, and
 * never exposed to the browser.
 *
 * Fields are mapped ONLY from what the API returns. Missing fields stay
 * undefined — the UI renders "not provided" instead of inventing values.
 *
 * ── BILLING (verified against the official Places API (New) field docs) ──
 * Field masks set the price: you are billed at the HIGHEST tier of any
 * field in the mask.
 *   https://developers.google.com/maps/documentation/places/web-service/text-search
 * The mask below intentionally includes Enterprise-tier fields because they
 * are core product requirements:
 *   - places.websiteUri            → Enterprise (needed for NO_WEBSITE detection)
 *   - places.internationalPhoneNumber → Enterprise (needed for contactability)
 *   - places.rating / places.userRatingCount → Enterprise (social proof)
 * Everything else in the mask (id, displayName, formattedAddress,
 * addressComponents, googleMapsUri, primaryType) is a lower tier.
 * Cost control therefore happens in the APP, not in the mask:
 * lib/discovery/cost.ts enforces a conservative monthly request ceiling
 * (default 4,000) and ZERO_SPEND_MODE blocks paid usage entirely.
 * testConnection() uses an id-only mask — the Essentials SKU ($0).
 */
import {
  DiscoveryError,
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoveredCompany,
  type LeadDiscoveryProvider,
  type ProviderCapabilities,
} from "./types";
import type { LeadSourceType } from "@prisma/client";

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Field mask controls both the response shape and the billed SKU — keep it
// to exactly what the discovery UI shows. See the billing note above before
// adding any field: adding an Enterprise/Atmosphere field reprices EVERY
// request.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.primaryType",
  "nextPageToken",
].join(",");

// Id-only mask for the free connectivity check (Essentials SKU — $0).
const ID_ONLY_MASK = ["places.id", "nextPageToken"].join(",");

/** Max Text Search pages per query — each page is a billed request. */
const MAX_PAGES = 3;

interface PlacesAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface PlacesPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlacesAddressComponent[];
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
}

function readEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

/**
 * Validate an external URL's shape without fetching it (no SSRF surface —
 * discovery never fetches provider-returned URLs in Phase 2). Returns the
 * normalized href, or undefined when the value is not an http(s) URL.
 */
export function toSafeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function componentText(
  components: PlacesAddressComponent[] | undefined,
  type: string,
): string | undefined {
  const c = components?.find((ac) => ac.types?.includes(type));
  return c?.longText || c?.shortText || undefined;
}

function mapPlace(place: PlacesPlace): DiscoveredCompany | null {
  const providerId = place.id?.trim();
  const name = place.displayName?.text?.trim();
  if (!providerId || !name) return null; // unusable without id + name

  const company: DiscoveredCompany = {
    provider: "google-places",
    providerId,
    name,
    provenance: "VERIFIED_DATA",
    discoveredAt: new Date().toISOString(),
  };
  if (place.primaryType) company.category = place.primaryType;
  if (place.formattedAddress) company.address = place.formattedAddress;
  const city = componentText(place.addressComponents, "locality");
  const state = componentText(place.addressComponents, "administrative_area_level_1");
  const country = componentText(place.addressComponents, "country");
  if (city) company.city = city;
  if (state) company.state = state;
  if (country) company.country = country;
  // Phone/website only when publicly returned by the API — never invented.
  if (place.internationalPhoneNumber) company.phone = place.internationalPhoneNumber;
  const website = toSafeHttpUrl(place.websiteUri);
  if (website) company.website = website;
  const sourceUrl = toSafeHttpUrl(place.googleMapsUri);
  if (sourceUrl) {
    company.sourceUrl = sourceUrl;
    company.googleMapsUrl = sourceUrl;
  }
  if (typeof place.rating === "number") company.rating = place.rating;
  if (typeof place.userRatingCount === "number") company.reviewCount = place.userRatingCount;
  return company;
}

export class GooglePlacesProvider implements LeadDiscoveryProvider {
  readonly id = "google-places";
  readonly label = "Google Maps";
  readonly sourceType: LeadSourceType = "GOOGLE_BUSINESS";
  readonly searchable = true;
  readonly capabilities: ProviderCapabilities = {
    websiteAuthority: "authoritative",
    supportsPhone: true,
    supportsEmail: false,
    supportsSocial: false,
    supportsPagination: true,
    supportsRecentEvidence: false,
    discoverySupported: true,
  };

  private fetcher: typeof fetch;

  /** fetcher is injectable so tests can mock the Google API. */
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  isConfigured(): boolean {
    return !!readEnv("GOOGLE_PLACES_API_KEY");
  }

  setupInstructions(): string[] {
    return [
      "Create a project in the Google Cloud Console and enable the Places API (New).",
      "Create an API key and restrict it to the Places API.",
      'Set GOOGLE_PLACES_API_KEY="<your-key>" in your server environment (.env.local for local dev).',
      "The app enforces a conservative monthly request ceiling (default 4,000) — see GOOGLE_PLACES_MONTHLY_CEILING.",
      "Restart the app server so the new variable is loaded.",
    ];
  }

  /** Cheap connectivity check — id-only mask bills at the Essentials ($0) SKU. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const apiKey = readEnv("GOOGLE_PLACES_API_KEY");
    if (!apiKey) {
      return { ok: false, message: "GOOGLE_PLACES_API_KEY is not set." };
    }
    try {
      const res = await this.fetcher(PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": ID_ONLY_MASK,
        },
        body: JSON.stringify({ textQuery: "test", maxResultCount: 1 }),
      });
      if (!res.ok) {
        return { ok: false, message: `Places API returned HTTP ${res.status}. Check the key and that the Places API (New) is enabled.` };
      }
      return { ok: true, message: "Connected — Places API (New) responded." };
    } catch (err) {
      return {
        ok: false,
        message: `Could not reach the Places API: ${err instanceof Error ? err.message : "network error"}`,
      };
    }
  }

  private async postSearch(
    apiKey: string,
    body: Record<string, unknown>,
    fieldMask: string,
  ): Promise<{ places: PlacesPlace[]; nextPageToken?: string; status: number }> {
    let res: Response;
    try {
      res = await this.fetcher(PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new DiscoveryError(
        "PROVIDER_UNREACHABLE",
        "Could not reach the Google Places API.",
        err instanceof Error ? err.message : undefined,
      );
    }

    if (!res.ok) {
      // Parse the error body for a safe message — never include the key.
      let detail: string | undefined;
      try {
        const errBody = (await res.json()) as { error?: { message?: string } };
        detail = errBody?.error?.message;
      } catch {
        detail = undefined;
      }
      if (res.status === 429) {
        throw new DiscoveryError("RATE_LIMITED", "Google Places API rate limit hit.", detail);
      }
      throw new DiscoveryError(
        "PROVIDER_ERROR",
        `Google Places API returned ${res.status}.`,
        detail,
      );
    }

    const data = (await res.json()) as { places?: PlacesPlace[]; nextPageToken?: string };
    return { places: data.places ?? [], nextPageToken: data.nextPageToken, status: res.status };
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const apiKey = readEnv("GOOGLE_PLACES_API_KEY");
    if (!apiKey) {
      throw new DiscoveryError(
        "PROVIDER_NOT_CONFIGURED",
        "Google Places is not connected. Set GOOGLE_PLACES_API_KEY to enable discovery.",
      );
    }
    if (!query.keyword?.trim()) {
      throw new DiscoveryError("INVALID_QUERY", "A search keyword is required.");
    }

    const textQuery = [query.keyword.trim(), query.city, query.state, query.country]
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(", ");

    const baseBody: Record<string, unknown> = {
      textQuery,
      maxResultCount: Math.min(Math.max(query.maxResults, 1), 20),
    };
    // Radius is honored only when a center is supplied — we never geocode
    // place names server-side.
    if (
      query.radiusMeters &&
      typeof query.latitude === "number" &&
      typeof query.longitude === "number"
    ) {
      baseBody.locationBias = {
        circle: {
          center: { latitude: query.latitude, longitude: query.longitude },
          radius: Math.min(Math.max(query.radiusMeters, 100), 50000),
        },
      };
    }

    // Paginate through nextPageToken (each page is a billed request).
    // Bounded at MAX_PAGES so one query can never run away in cost.
    const companies: DiscoveredCompany[] = [];
    let requestsMade = 0;
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = { ...baseBody, ...(pageToken ? { pageToken } : {}) };
      const { places, nextPageToken } = await this.postSearch(apiKey, body, FIELD_MASK);
      requestsMade++;
      for (const place of places) {
        const company = mapPlace(place);
        if (company) companies.push(company);
      }
      // A short delay between pages is required by the API for the token
      // to become valid — and it also keeps us polite.
      if (nextPageToken) {
        pageToken = nextPageToken;
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        break;
      }
    }

    return {
      provider: this.id,
      companies,
      searchedAt: new Date().toISOString(),
      meta: { requestsMade },
    };
  }
}
