/**
 * Instagram username discovery — compliant sources ONLY.
 *
 * How it works:
 * - Builds several web-search queries from the day's target (industry,
 *   location, business type) with `site:instagram.com` variants.
 * - Runs them through the Tavily Search API (public web index).
 * - Extracts candidate usernames from instagram.com profile URLs found in
 *   the results. instagram.com pages are NEVER fetched — only the URL
 *   strings returned by the search engine are read.
 * - Validates every handle with the existing normalizeUsername rules and
 *   filters to profiles whose title/snippet/username matches the target
 *   industry (existing industryMatchesTarget).
 *
 * Honest limits (stated, not hidden):
 * - This is web search, not an Instagram directory. Yield is noisy and
 *   varies by industry/location. The pipeline returns the maximum valid
 *   unique count found — it NEVER invents usernames to hit 70–80.
 * - No follower counts are available from compliant sources, so the
 *   plan's followerThreshold is stored but cannot be enforced.
 * - Connection status cannot be determined → always UNKNOWN.
 */
import { normalizeUsername } from "../outreach/instagram";
import { industryMatchesTarget } from "../discovery/candidates";

export interface ProspectingDayTarget {
  industry: string;
  location: string | null;
  country: string | null;
  businessType: string | null;
  targetAudience: string | null;
  websitePreference: string;
  targetCount: number;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface DiscoveryDeps {
  /** Tavily-style web search. Defaults to the real Tavily API. */
  webSearch?: (query: string) => Promise<SearchHit[]>;
  /** Maximum search queries to spend on one daily run (quota guard). */
  maxQueries?: number;
}

export interface UsernameDiscovery {
  /** Unique, validated, industry-relevant usernames (normalized). */
  usernames: string[];
  queriesUsed: string[];
  searchesMade: number;
}

/** instagram.com path segments that are NOT profiles. */
const RESERVED_SEGMENTS = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "accounts",
  "about", "developer", "blog", "directory", "legal", "privacy",
  "emojis", "nametag", "web",
]);

/**
 * Extract a profile username from an instagram.com URL string.
 * Returns null for posts/reels/explore URLs and non-profile paths.
 */
export function usernameFromInstagramUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.hostname.replace(/^www\./, "").toLowerCase() !== "instagram.com") {
    return null;
  }
  const seg = parsed.pathname.split("/").filter(Boolean)[0];
  if (!seg || RESERVED_SEGMENTS.has(seg.toLowerCase())) return null;
  const normalized = normalizeUsername(seg);
  return normalized.ok ? normalized.username : null;
}

async function tavilySearch(query: string): Promise<SearchHit[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily returned HTTP ${res.status}.`);
  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (data.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title ?? "",
      url: r.url as string,
      snippet: (r.content ?? "").slice(0, 500),
    }));
}

/** Build query variations from the day's target (industry-first). */
export function buildDiscoveryQueries(target: ProspectingDayTarget): string[] {
  const loc = [target.location, target.country].filter(Boolean).join(" ");
  const industry = target.industry.trim();
  const bizType = target.businessType?.trim();
  const queries = [
    `site:instagram.com "${industry}"${loc ? ` ${loc}` : ""}`,
    `"${industry}"${loc ? ` ${loc}` : ""} instagram business profile`,
  ];
  if (bizType) {
    queries.push(`site:instagram.com "${bizType}" "${industry}"${loc ? ` ${loc}` : ""}`);
  }
  if (loc) {
    queries.push(`site:instagram.com "${industry}" "${loc}" manufacturer OR exporter OR store OR studio`);
  }
  // Dedupe while preserving order.
  return [...new Set(queries)];
}

function isIndustryRelevant(
  hit: SearchHit,
  username: string,
  industry: string,
): boolean {
  const hayTitle = `${hit.title} ${hit.snippet}`;
  if (industryMatchesTarget(hayTitle, username, industry)) return true;
  // Username itself carrying industry tokens (e.g. jaipur_jewels).
  if (industryMatchesTarget("", username.replace(/[._]/g, " "), industry)) return true;
  return false;
}

/**
 * Discover unique Instagram usernames for a day's target.
 * Never throws for search failures — returns what was found.
 */
export async function discoverInstagramUsernames(
  target: ProspectingDayTarget,
  deps: DiscoveryDeps = {},
): Promise<UsernameDiscovery> {
  const webSearch = deps.webSearch ?? tavilySearch;
  const maxQueries = deps.maxQueries ?? 8;
  const queries = buildDiscoveryQueries(target).slice(0, maxQueries);

  const seen = new Set<string>();
  const usernames: string[] = [];
  let searchesMade = 0;

  for (const query of queries) {
    if (usernames.length >= target.targetCount) break;
    let hits: SearchHit[];
    try {
      hits = (await webSearch(query)) ?? [];
      searchesMade++;
    } catch {
      continue; // one failed query never stops discovery
    }
    for (const hit of hits) {
      const username = usernameFromInstagramUrl(hit.url);
      if (!username || seen.has(username)) continue;
      seen.add(username);
      // Industry gate: the profile must match the day's target.
      if (!isIndustryRelevant(hit, username, target.industry)) continue;
      usernames.push(username);
      if (usernames.length >= target.targetCount) break;
    }
  }

  return { usernames, queriesUsed: queries.slice(0, searchesMade), searchesMade };
}
