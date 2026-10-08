/**
 * Multi-source candidate acquisition for the AI sales agent.
 *
 * The agent researches substantially MORE candidates than the day's target
 * (a research pool of ~3x target, bounded by quota) so verification can be
 * strict and still reach the target with quality prospects.
 *
 * Sources (each optional, each failure-isolated):
 *   1. Instagram discovery — site:instagram.com via the web-search provider
 *      (Tavily). Existing discoverInstagramUsernames; profiles are LISTED,
 *      never fetched. Source honesty is preserved end to end.
 *   2. Google Places — real business listings (name, address, phone, website,
 *      Maps URL, category, place_id) when GOOGLE_PLACES_API_KEY is set.
 *      Business discovery, NOT an Instagram source.
 *   3. Public web search — Tavily general queries for business homepages.
 *      Conservative: only results that look like a business homepage become
 *      candidates, and verification treats them as weak single-source
 *      evidence.
 *
 * Every candidate carries per-field provenance (provider, URL, retrievedAt).
 * Nothing is invented: missing fields stay null.
 */
import { getDiscoveryProvider } from "../discovery/registry";
import { getWebSearchProvider } from "../research/search-provider";
import { matchEntities } from "./entity-match";
import { instagramProfileUrl } from "../outreach/instagram";
import {
  discoverInstagramUsernames,
  type DiscoveryDeps,
  type ProspectingDayTarget,
} from "./instagram-discovery";

export interface AgentCandidateSource {
  /** Provider id, e.g. "tavily", "google-places". */
  provider: string;
  /** LeadSourceType-style label: "INSTAGRAM" | "GOOGLE_BUSINESS" | "WEB_SEARCH". */
  sourceType: string;
  url?: string;
  retrievedAt: string;
  /** Human label shown in the UI, e.g. "Google Places listing". */
  label: string;
}

export interface AgentCandidate {
  businessName: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  googlePlaceId: string | null;
  googleMapsUrl: string | null;
  instagramUsername: string | null;
  instagramUrl: string | null;
  rating: number | null;
  sources: AgentCandidateSource[];
}

export interface SourceNote {
  provider: string;
  status: "ok" | "skipped" | "error";
  count: number;
  note: string;
  /** Observability (§6): queries attempted against the provider. */
  queriesAttempted?: number;
  /** Raw results returned by the provider. */
  resultsReturned?: number;
  /** Results that became usable candidates. */
  usableCandidates?: number;
  /** Safe error message when status === "error" (never secrets). */
  error?: string;
}

export interface AcquireResult {
  candidates: AgentCandidate[];
  sourceNotes: SourceNote[];
  /** Billable-ish search operations spent (for quota metering). */
  searchesMade: number;
}

export interface AcquireDeps {
  discoveryDeps?: DiscoveryDeps;
  /** Research pool target (candidates). Defaults to 150. */
  poolSize?: number;
}

const nowIso = () => new Date().toISOString();

/** Domains that are never business homepages — skip for web candidates. */
const NON_BUSINESS_HOSTS = [
  "instagram.com", "facebook.com", "linkedin.com", "twitter.com", "x.com",
  "youtube.com", "tiktok.com", "pinterest.com", "wikipedia.org",
  "yelp.", "justdial.com", "indiamart.com", "tradeindia.com",
  "sulekha.com", "yellowpages", " tripadvisor.",
];

function looksLikeBusinessHomepage(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (NON_BUSINESS_HOSTS.some((h) => host.includes(h.trim()))) return false;
  // Homepage, not a deep article/page.
  const path = new URL(url).pathname.replace(/\/+$/, "");
  return path === "" || path === "/index.html" || path === "/home";
}

/** "ABC Plastics — Manufacturer in Ahmedabad | abcplastics.com" → "ABC Plastics". */
function cleanBusinessName(title: string): string | null {
  const cut = title.split(/[-|–—:]/)[0]?.trim() ?? "";
  if (cut.length < 3 || cut.length > 80) return null;
  if (/^(home|welcome|about)/i.test(cut)) return null;
  return cut;
}

async function acquireInstagram(
  target: ProspectingDayTarget,
  budget: number,
  discoveryDeps?: DiscoveryDeps,
): Promise<{ candidates: AgentCandidate[]; note: SourceNote; searchesMade: number }> {
  const retrievedAt = nowIso();
  if (budget <= 0) {
    return {
      candidates: [],
      searchesMade: 0,
      note: {
        provider: "tavily",
        status: "skipped",
        count: 0,
        note: getWebSearchProvider().isConfigured()
          ? "No budget allocated (redistributed to primary sources)."
          : "Public web search provider is not configured.",
      },
    };
  }
  try {
    const found = await discoverInstagramUsernames(target, {
      ...discoveryDeps,
      maxQueries: discoveryDeps?.maxQueries ?? 4,
    });
    const candidates = found.usernames.slice(0, Math.max(budget, 0)).map((username) => {
      const url = instagramProfileUrl(username);
      return {
        businessName: null,
        category: null,
        address: null,
        city: target.location,
        country: target.country,
        phone: null,
        email: null,
        website: null,
        googlePlaceId: null,
        googleMapsUrl: null,
        instagramUsername: username,
        instagramUrl: url,
        rating: null,
        sources: [
          {
            provider: "tavily",
            sourceType: "INSTAGRAM",
            url,
            retrievedAt,
            label: "Instagram profile URL via public web search (listed, not accessed)",
          } satisfies AgentCandidateSource,
        ],
      } satisfies AgentCandidate;
    });
    const configured = getWebSearchProvider().isConfigured();
    return {
      candidates,
      searchesMade: found.searchesMade,
      note: {
        provider: "tavily",
        status: "ok",
        count: candidates.length,
        note:
          found.usernames.length === 0 && !configured
            ? "Public web search provider is not configured."
            : `${found.searchesMade} searches, ${(found.queriesUsed ?? []).length} queries`,
        queriesAttempted: (found.queriesUsed ?? []).length,
        resultsReturned: found.usernames.length,
        usableCandidates: candidates.length,
      },
    };
  } catch (err) {
    return {
      candidates: [],
      searchesMade: 0,
      note: {
        provider: "tavily",
        status: "error",
        count: 0,
        note: "Instagram discovery failed.",
        error: err instanceof Error ? err.message.slice(0, 300) : "Instagram discovery failed.",
      },
    };
  }
}

async function acquireGooglePlaces(
  target: ProspectingDayTarget,
  budget: number,
): Promise<{ candidates: AgentCandidate[]; note: SourceNote; searchesMade: number }> {
  const provider = getDiscoveryProvider("google-places");
  if (!provider || !provider.isConfigured()) {
    return {
      candidates: [],
      searchesMade: 0,
      note: {
        provider: "google-places",
        status: "skipped",
        count: 0,
        note: "Google Places is not configured (GOOGLE_PLACES_API_KEY).",
      },
    };
  }
  if (budget <= 0) {
    return {
      candidates: [],
      searchesMade: 0,
      note: {
        provider: "google-places",
        status: "skipped",
        count: 0,
        note: "No budget allocated (redistributed to other sources).",
      },
    };
  }
  try {
    // Multiple keyword variations so a larger budget actually widens
    // coverage instead of over-fetching one query's pages.
    const keywords = [
      [target.industry, target.businessType].filter(Boolean).join(" "),
      target.businessType ? `${target.businessType} ${target.location ?? ""}`.trim() : null,
      `${target.industry} ${target.location ?? ""}`.trim(),
    ].filter((k): k is string => !!k && k.length > 0);
    const uniqueKeywords = [...new Set(keywords)].slice(0, 3);
    const perQuery = Math.max(1, Math.ceil(budget / uniqueKeywords.length));

    const retrievedAt = nowIso();
    const candidates: AgentCandidate[] = [];
    const seenPlaceIds = new Set<string>();
    let requestsMade = 0;
    let resultsReturned = 0;
    const queriesAttempted: string[] = [];

    for (const keyword of uniqueKeywords) {
      if (candidates.length >= budget) break;
      const result = await provider.search({
        keyword,
        city: target.location ?? undefined,
        country: target.country ?? undefined,
        maxResults: Math.min(perQuery, 20),
        category: target.businessType ?? undefined,
      });
      queriesAttempted.push(keyword);
      requestsMade += result.meta?.requestsMade ?? 1;
      resultsReturned += result.companies.length;
      for (const c of result.companies) {
        if (candidates.length >= budget) break;
        if (seenPlaceIds.has(c.providerId)) continue;
        seenPlaceIds.add(c.providerId);
        candidates.push({
          businessName: c.name,
          category: c.category ?? null,
          address: c.address ?? null,
          city: c.city ?? target.location,
          country: c.country ?? target.country,
          phone: c.phone ?? null,
          email: c.email ?? null,
          website: c.website ?? null,
          googlePlaceId: c.providerId,
          googleMapsUrl: c.googleMapsUrl ?? c.sourceUrl ?? null,
          instagramUsername: null,
          instagramUrl: c.instagramUrl ?? null,
          rating: c.rating ?? null,
          sources: [
            {
              provider: "google-places",
              sourceType: "GOOGLE_BUSINESS",
              url: c.googleMapsUrl ?? c.sourceUrl,
              retrievedAt,
              label: "Google Places business listing",
            } satisfies AgentCandidateSource,
          ],
        } satisfies AgentCandidate);
      }
    }
    return {
      candidates,
      searchesMade: requestsMade,
      note: {
        provider: "google-places",
        status: "ok",
        count: candidates.length,
        note: `${requestsMade} Places request(s) across ${queriesAttempted.length} queries`,
        queriesAttempted: queriesAttempted.length,
        resultsReturned,
        usableCandidates: candidates.length,
      },
    };
  } catch (err) {
    return {
      candidates: [],
      searchesMade: 0,
      note: {
        provider: "google-places",
        status: "error",
        count: 0,
        note: "Google Places search failed.",
        error: err instanceof Error ? err.message.slice(0, 300) : "Google Places search failed.",
      },
    };
  }
}

async function acquireWeb(
  target: ProspectingDayTarget,
  budget: number,
): Promise<{ candidates: AgentCandidate[]; note: SourceNote; searchesMade: number }> {
  const provider = getWebSearchProvider();
  if (!provider.isConfigured()) {
    return {
      candidates: [],
      searchesMade: 0,
      note: {
        provider: "tavily-web",
        status: "skipped",
        count: 0,
        note: "Public web search provider is not configured.",
      },
    };
  }
  if (budget <= 0) {
    return {
      candidates: [],
      searchesMade: 0,
      note: {
        provider: "tavily-web",
        status: "skipped",
        count: 0,
        note: "No budget allocated (redistributed to primary sources).",
      },
    };
  }
  try {
    const loc = [target.location, target.country].filter(Boolean).join(" ");
    const queries = [
      `"${target.industry}" ${loc} company`,
      `"${target.industry}" ${loc} manufacturer OR exporter OR supplier`,
    ];
    const seen = new Set<string>();
    const candidates: AgentCandidate[] = [];
    let resultsReturned = 0;
    let queriesAttempted = 0;
    for (const q of queries) {
      if (candidates.length >= budget) break;
      const hits = await provider.search(q, { maxResults: 10 });
      queriesAttempted++;
      resultsReturned += hits.length;
      for (const hit of hits) {
        if (candidates.length >= budget) break;
        if (!looksLikeBusinessHomepage(hit.url)) continue;
        let origin: string;
        try {
          origin = new URL(hit.url).origin;
        } catch {
          continue;
        }
        if (seen.has(origin)) continue;
        seen.add(origin);
        const name = cleanBusinessName(hit.title);
        if (!name) continue;
        candidates.push({
          businessName: name,
          category: null,
          address: null,
          city: target.location,
          country: target.country,
          phone: null,
          email: null,
          website: origin,
          googlePlaceId: null,
          googleMapsUrl: null,
          instagramUsername: null,
          instagramUrl: null,
          rating: null,
          sources: [
            {
              provider: "tavily",
              sourceType: "WEB_SEARCH",
              url: hit.url,
              retrievedAt: hit.retrievedAt,
              label: "Business homepage via public web search",
            } satisfies AgentCandidateSource,
          ],
        });
      }
    }
    return {
      candidates,
      searchesMade: queriesAttempted,
      note: {
        provider: "tavily-web",
        status: "ok",
        count: candidates.length,
        note: `${queriesAttempted} web queries`,
        queriesAttempted,
        resultsReturned,
        usableCandidates: candidates.length,
      },
    };
  } catch (err) {
    return {
      candidates: [],
      searchesMade: 0,
      note: {
        provider: "tavily-web",
        status: "error",
        count: 0,
        note: "Web search failed.",
        error: err instanceof Error ? err.message.slice(0, 300) : "Web search failed.",
      },
    };
  }
}

/**
 * Cross-source entity merge: candidates from different providers that are
 * the same business (per matchEntities) become ONE candidate with combined
 * sources and filled-in fields. Only MATCHED pairs merge — POSSIBLE matches
 * stay separate (no false merges).
 */
export function mergeCandidates(candidates: AgentCandidate[]): AgentCandidate[] {
  const identityOf = (c: AgentCandidate) => ({
    businessName: c.businessName,
    phone: c.phone,
    website: c.website,
    providerId: c.googlePlaceId,
    instagramUsername: c.instagramUsername,
    city: c.city,
  });
  const groups: AgentCandidate[] = [];
  for (const c of candidates) {
    let target: AgentCandidate | null = null;
    for (const g of groups) {
      if (matchEntities(identityOf(g), identityOf(c)).status === "MATCHED") {
        target = g;
        break;
      }
    }
    if (!target) {
      groups.push({ ...c, sources: [...c.sources] });
      continue;
    }
    // Merge into the group: fill empty fields, combine sources. Acquisition
    // orders Google first so the richest business record becomes the base.
    target.businessName ??= c.businessName;
    target.category ??= c.category;
    target.address ??= c.address;
    target.city ??= c.city;
    target.country ??= c.country;
    target.phone ??= c.phone;
    target.email ??= c.email;
    target.website ??= c.website;
    target.googlePlaceId ??= c.googlePlaceId;
    target.googleMapsUrl ??= c.googleMapsUrl;
    target.instagramUsername ??= c.instagramUsername;
    target.instagramUrl ??= c.instagramUrl;
    target.rating ??= c.rating;
    target.sources.push(...c.sources);
  }
  return groups;
}

/**
 * Acquire a research pool of candidates from all configured sources.
 *
 * Dynamic source budgeting (§4): each source receives a meaningful budget
 * based on its configured status — Google Places is primary when
 * configured, Tavily web search is secondary, Instagram public-search is
 * supplementary. Unconfigured sources get zero budget and their share
 * redistributes to the configured ones. No source can block the pipeline:
 * acquisition runs in parallel and every failure is isolated + reported.
 *
 * poolSize caps the total (default 150); per-source budgets are caps, not
 * guarantees — a source returning 0 never wastes the run budget.
 */
export async function acquireCandidates(
  target: ProspectingDayTarget,
  deps: AcquireDeps = {},
): Promise<AcquireResult> {
  const poolSize = Math.min(Math.max(deps.poolSize ?? 150, 1), 400);

  const googleConfigured = (() => {
    try {
      const p = getDiscoveryProvider("google-places");
      return !!p && p.isConfigured();
    } catch {
      return false;
    }
  })();
  const webConfigured = (() => {
    try {
      return getWebSearchProvider().isConfigured();
    } catch {
      return false;
    }
  })();
  // Instagram discovery rides on the web-search provider (public search).
  const instagramConfigured = webConfigured;

  // Shares: Google 50% (primary) / Web 35% (secondary) / Instagram 15%
  // (supplementary). Unconfigured sources contribute 0 and their share is
  // redistributed proportionally across the configured ones.
  const shares: { key: "google" | "web" | "instagram"; share: number; configured: boolean }[] = [
    { key: "google", share: 0.5, configured: googleConfigured },
    { key: "web", share: 0.35, configured: webConfigured },
    { key: "instagram", share: 0.15, configured: instagramConfigured },
  ];
  const configuredShare = shares
    .filter((s) => s.configured)
    .reduce((sum, s) => sum + s.share, 0);

  const budgetFor = (key: "google" | "web" | "instagram", cap: number): number => {
    const s = shares.find((x) => x.key === key)!;
    if (!s.configured || configuredShare <= 0) return 0;
    return Math.min(cap, Math.ceil((poolSize * s.share) / configuredShare));
  };

  const googleBudget = budgetFor("google", 40);
  const webBudget = budgetFor("web", 40);
  const instagramBudget = budgetFor("instagram", 30);

  const [ig, google, web] = await Promise.all([
    acquireInstagram(target, instagramBudget, deps.discoveryDeps),
    acquireGooglePlaces(target, googleBudget),
    acquireWeb(target, webBudget),
  ]);

  const candidates = [...google.candidates, ...ig.candidates, ...web.candidates].slice(
    0,
    poolSize,
  );
  return {
    candidates,
    sourceNotes: [google.note, ig.note, web.note],
    searchesMade: ig.searchesMade + google.searchesMade + web.searchesMade,
  };
}
