/**
 * Google Places provider — the Phase 2 primary discovery source.
 *
 * Uses ONLY the official Places API (New) Text Search endpoint. No scraping,
 * no CAPTCHA/bot-protection bypass, no proxy rotation, no fake accounts.
 * The API key lives server-side in GOOGLE_PLACES_API_KEY and is sent as the
 * X-Goog-Api-Key header — it is never placed in a URL, never logged, and
 * never exposed to the browser.
 *
 * Fields are mapped ONLY from what the API returns. Missing fields stay
 * undefined — the UI renders "not provided" instead of inventing values.
 */
import {
  DiscoveryError,
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoveredCompany,
  type LeadDiscoveryProvider,
} from "./types";

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Field mask controls both the response shape and the billed SKU — keep it
// to exactly what the discovery UI shows.
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
].join(",");

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
  if (sourceUrl) company.sourceUrl = sourceUrl;
  if (typeof place.rating === "number") company.rating = place.rating;
  if (typeof place.userRatingCount === "number") company.reviewCount = place.userRatingCount;
  return company;
}

export class GooglePlacesProvider implements LeadDiscoveryProvider {
  readonly id = "google-places";
  readonly label = "Google Places";
  readonly sourceType = "GOOGLE_BUSINESS" as const;
  readonly searchable = true;

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
      "Restart the app server so the new variable is loaded.",
    ];
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

    const body: Record<string, unknown> = {
      textQuery,
      maxResultCount: Math.min(Math.max(query.maxResults, 1), 20),
    };
    // Radius is honored only when a center is supplied — we never geocode
    // place names server-side in Phase 2.
    if (
      query.radiusMeters &&
      typeof query.latitude === "number" &&
      typeof query.longitude === "number"
    ) {
      body.locationBias = {
        circle: {
          center: { latitude: query.latitude, longitude: query.longitude },
          radius: Math.min(Math.max(query.radiusMeters, 100), 50000),
        },
      };
    }

    let res: Response;
    try {
      res = await this.fetcher(PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
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
      throw new DiscoveryError(
        "PROVIDER_ERROR",
        `Google Places API returned ${res.status}.`,
        detail,
      );
    }

    const data = (await res.json()) as { places?: PlacesPlace[] };
    const companies: DiscoveredCompany[] = [];
    for (const place of data.places ?? []) {
      const company = mapPlace(place);
      if (company) companies.push(company);
    }
    return { provider: this.id, companies, searchedAt: new Date().toISOString() };
  }
}
