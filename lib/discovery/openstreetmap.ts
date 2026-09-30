/**
 * OpenStreetMap (Overpass) discovery provider — the free default.
 *
 * Uses ONLY the public Overpass API interpreter endpoint. No API key, no
 * Nominatim, no scraping of OSM detail pages, no proxies, no CAPTCHA/bot
 * bypass, no fake accounts. An identifiable User-Agent is sent as required
 * by the Overpass usage policy.
 *
 * COMPLIANCE: every field is populated ONLY from tags the API actually
 * returned. Missing phone/website/address data is common in OSM and stays
 * undefined — the UI renders "not provided" instead of inventing values.
 * Attribution: © OpenStreetMap contributors.
 */
import {
  DiscoveryError,
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoveredCompany,
  type LeadDiscoveryProvider,
} from "./types";
import { toSafeHttpUrl } from "./google-places";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_FALLBACK_URL = "https://overpass.private.coffee/api/interpreter";
/** Tried strictly in order — never in parallel. */
const OVERPASS_ENDPOINTS = [OVERPASS_URL, OVERPASS_FALLBACK_URL];
const USER_AGENT = "WDD-AI-Sales-OS/1.0 (+https://wdd-ai-sales-os.vercel.app)";

/** Keyword → OSM tag selectors for common business types. */
const TAG_GROUPS: { match: RegExp; tags: string[] }[] = [
  {
    match: /manufactur|factor|industri/i,
    tags: ["craft", "industrial", "man_made=works", "office=company"],
  },
  {
    match: /salon|beauty|hair/i,
    tags: ["shop=beauty", "beauty=hairdresser", "beauty=beauty_salon"],
  },
  { match: /gym|fitness/i, tags: ["leisure=fitness_centre"] },
  {
    match: /restaurant|cafe|café|food|dining/i,
    tags: ["amenity=restaurant", "amenity=cafe"],
  },
  { match: /hotel|resort/i, tags: ["tourism=hotel"] },
];

/** Text tags searched with the user keyword (case-insensitive regex). */
const TEXT_TAGS = ["name", "brand", "operator", "description"];

interface OsmElement {
  type?: "node" | "way" | "relation";
  id?: number;
  tags?: Record<string, string>;
}

/** Escape user input for safe embedding in an Overpass regex. */
export function escapeOverpassRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagsForKeyword(keyword: string): string[] {
  const kw = keyword.trim();
  for (const group of TAG_GROUPS) {
    if (group.match.test(kw)) return group.tags;
  }
  return [];
}

/**
 * Build the Overpass QL query. Uses the most specific supplied location to
 * select an administrative area: city → admin 6/7/8, state → admin 4,
 * country → admin 2. The boundary relation is resolved first and converted
 * with map_to_area (the reliable pattern for name-based area selection).
 */
export function buildOverpassQuery(query: DiscoveryQuery): string {
  const keyword = query.keyword?.trim();
  if (!keyword) {
    throw new DiscoveryError("INVALID_QUERY", "A search keyword is required.");
  }

  let boundaryFilter: string;
  if (query.city?.trim()) {
    boundaryFilter = `["boundary"="administrative"]["admin_level"~"^(6|7|8)$"]["name"~"${escapeOverpassRegex(query.city.trim())}",i]`;
  } else if (query.state?.trim()) {
    boundaryFilter = `["boundary"="administrative"]["admin_level"="4"]["name"~"${escapeOverpassRegex(query.state.trim())}",i]`;
  } else if (query.country?.trim()) {
    boundaryFilter = `["boundary"="administrative"]["admin_level"="2"]["name"~"${escapeOverpassRegex(query.country.trim())}",i]`;
  } else {
    throw new DiscoveryError(
      "INVALID_QUERY",
      "A location (city, state, or country) is required for OpenStreetMap discovery.",
    );
  }

  const tagSelectors = tagsForKeyword(keyword);
  const kwRegex = escapeOverpassRegex(keyword);
  const clauses: string[] = [];

  if (tagSelectors.length > 0) {
    // Indexed business-tag search — fast even for large areas.
    for (const tag of tagSelectors) {
      const [k, v] = tag.split("=");
      clauses.push(v ? `nwr["${k}"="${v}"](area.searchArea);` : `nwr["${k}"](area.searchArea);`);
    }
  } else {
    // Fallback for keywords without a known tag mapping: case-insensitive
    // text search. Best-effort — regex scans can be slow on large areas.
    for (const tag of TEXT_TAGS) {
      clauses.push(`nwr["${tag}"~"${kwRegex}",i](area.searchArea);`);
    }
  }

  const limit = Math.min(Math.max(query.maxResults || 20, 1), 50);
  return [
    "[out:json][timeout:20];",
    `rel${boundaryFilter}->.boundary;`,
    ".boundary map_to_area->.searchArea;",
    "(",
    ...clauses,
    ");",
    `out center ${limit};`,
  ].join("\n");
}

function categoryFromTags(tags: Record<string, string>): string | undefined {
  const order: [string, string?][] = [
    ["craft"],
    ["industrial"],
    ["shop"],
    ["amenity"],
    ["office"],
    ["man_made"],
    ["tourism"],
    ["leisure"],
    ["beauty"],
  ];
  for (const [key] of order) {
    const v = tags[key];
    if (v) return v === "yes" ? key : `${key}: ${v}`;
  }
  return undefined;
}

function addressFromTags(tags: Record<string, string>): string | undefined {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"] ?? tags["addr:place"],
    tags["addr:postcode"],
    tags["addr:country"],
  ].filter((p) => p && p.trim());
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function mapElement(el: OsmElement): DiscoveredCompany | null {
  const type = el.type;
  const id = el.id;
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!type || !id || !name) return null; // unusable without type + id + name

  const company: DiscoveredCompany = {
    provider: "openstreetmap",
    providerId: `osm:${type}:${id}`,
    name,
    provenance: "VERIFIED_DATA",
    discoveredAt: new Date().toISOString(),
    sourceUrl: `https://www.openstreetmap.org/${type}/${id}`,
  };

  const category = categoryFromTags(tags);
  if (category) company.category = category;

  const address = addressFromTags(tags);
  if (address) company.address = address;
  if (tags["addr:city"]?.trim() || tags["addr:place"]?.trim()) {
    company.city = (tags["addr:city"] ?? tags["addr:place"] ?? "").trim() || undefined;
  }
  if (tags["addr:state"]?.trim()) company.state = tags["addr:state"].trim();
  if (tags["addr:country"]?.trim()) company.country = tags["addr:country"].trim();

  // Phone/website only when OSM actually provides the tags — never invented.
  const phone = tags.phone?.trim() || tags["contact:phone"]?.trim();
  if (phone) company.phone = phone;
  const website = toSafeHttpUrl(tags.website?.trim() || tags["contact:website"]?.trim());
  if (website) company.website = website;

  return company;
}

export class OpenStreetMapProvider implements LeadDiscoveryProvider {
  readonly id = "openstreetmap";
  readonly label = "OpenStreetMap (Overpass)";
  readonly sourceType = "DIRECTORY" as const;
  readonly searchable = true;

  private fetcher: typeof fetch;

  /** fetcher is injectable so tests can mock the Overpass API. */
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  /** Free provider — always configured, no API key required. */
  isConfigured(): boolean {
    return true;
  }

  setupInstructions(): string[] {
    return [
      "No setup required — OpenStreetMap discovery works out of the box.",
      "Public Overpass API is rate-limited and best-effort; attribute © OpenStreetMap contributors.",
    ];
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const ql = buildOverpassQuery(query); // throws INVALID_QUERY when unusable

    // Sequential endpoint attempts: primary first, fallback once on
    // temporary failures (429/502/503/504/network). Never parallel, never
    // retried indefinitely.
    let lastError: DiscoveryError | null = null;
    for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
      const endpoint = OVERPASS_ENDPOINTS[i];
      const label = i === 0 ? "primary" : "fallback";
      try {
        const result = await this.attemptSearch(endpoint, ql);
        if (i > 0) console.log("[osm] fallback request succeeded");
        return result;
      } catch (err) {
        if (!(err instanceof DiscoveryError) || !isRetryable(err)) throw err;
        console.warn(`[osm] ${label} request failed: ${err.detail ?? err.code}`);
        lastError = err;
        if (i === 0) console.log("[osm] trying fallback endpoint");
        // fall through to the next endpoint
      }
    }

    // Both endpoints failed — clean, user-facing error. Never expose raw
    // server HTML or infrastructure details.
    if (lastError?.code === "RATE_LIMITED") {
      throw new DiscoveryError(
        "RATE_LIMITED",
        "OpenStreetMap is rate-limiting requests right now. Please wait a minute and try again.",
      );
    }
    throw new DiscoveryError(
      "PROVIDER_UNREACHABLE",
      "OpenStreetMap is temporarily busy. Please try again in a moment.",
    );
  }

  /**
   * One attempt against a single endpoint. Throws DiscoveryError with a
   * retryable code (RATE_LIMITED / PROVIDER_UNREACHABLE) for temporary
   * failures, PROVIDER_ERROR for definitive failures.
   */
  private async attemptSearch(
    endpoint: string,
    ql: string,
  ): Promise<DiscoveryResult> {
    let res: Response;
    try {
      res = await this.fetcher(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(ql)}`,
      });
    } catch (err) {
      throw new DiscoveryError(
        "PROVIDER_UNREACHABLE",
        "Could not reach the OpenStreetMap Overpass API.",
        err instanceof Error ? err.message : "network failure",
      );
    }

    if (res.status === 429) {
      throw new DiscoveryError("RATE_LIMITED", "Rate limited.", "429");
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new DiscoveryError(
        "PROVIDER_UNREACHABLE",
        "Overpass server overloaded.",
        String(res.status),
      );
    }
    if (!res.ok) {
      throw new DiscoveryError(
        "PROVIDER_ERROR",
        `OpenStreetMap Overpass API returned ${res.status}.`,
      );
    }

    let data: { elements?: OsmElement[] };
    try {
      data = (await res.json()) as { elements?: OsmElement[] };
    } catch {
      throw new DiscoveryError(
        "PROVIDER_ERROR",
        "OpenStreetMap returned an unreadable response.",
      );
    }

    // Deduplicate by providerId (an element can match several clauses).
    const seen = new Set<string>();
    const companies: DiscoveredCompany[] = [];
    for (const el of data.elements ?? []) {
      const company = mapElement(el);
      if (!company || seen.has(company.providerId)) continue;
      seen.add(company.providerId);
      companies.push(company);
    }
    return { provider: this.id, companies, searchedAt: new Date().toISOString() };
  }
}

/** Temporary failures worth trying the fallback endpoint for. */
function isRetryable(err: DiscoveryError): boolean {
  return err.code === "RATE_LIMITED" || err.code === "PROVIDER_UNREACHABLE";
}
