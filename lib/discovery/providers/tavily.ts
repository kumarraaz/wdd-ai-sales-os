/**
 * Tavily web-search provider — structured web discovery & research.
 *
 * Priority #1 in the WebSearchProvider order (Tavily → Gemini grounding →
 * optional Brave → no-result fallback). Uses ONLY the official Tavily Search
 * API — no scraping of search-result pages, no CAPTCHA/bot bypass.
 *
 * What it returns: normalized business candidates derived from public
 * search results. Every candidate keeps its source URL. Fields extracted
 * from result snippets (phone/email) carry the page URL as evidence —
 * they are never invented, but website detection is "unreliable" here:
 * an absent website on a directory listing is NOT proof of no website.
 *
 * Cost: basic-depth searches cost 1 credit each; this provider runs at
 * most 2 queries per search call (general + directory-oriented). The
 * app-level monthly ceiling (default 900 credits) is enforced in
 * lib/discovery/cost.ts.
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

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/** Directory/marketplace domains — never treated as the business's website. */
const DIRECTORY_DOMAINS = [
  "indiamart.com",
  "tradeindia.com",
  "exportersindia.com",
  "justdial.com",
  "sulekha.com",
  "yellowpages.in",
  "indianyellowpages.com",
  "dir.indiamart.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "google.com",
  "youtube.com",
];

function readEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isDirectoryUrl(url: string): boolean {
  const d = domainOf(url);
  return !!d && DIRECTORY_DOMAINS.some((dir) => d === dir || d.endsWith(`.${dir}`));
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

/** Strip common directory suffixes: "ABC Industries - IndiaMART" → "ABC Industries". */
function cleanTitle(title: string): string {
  return title
    .split(/\s[-–|]\s/)[0]
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

const PHONE_RE = /\+?91[\s-]?\d{2,5}[\s-]?\d{4,5}[\s-]?\d{4,5}|\b\d{5}[\s-]?\d{5}\b|\b\d{4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function extractFirst(text: string, re: RegExp): string | undefined {
  re.lastIndex = 0;
  const m = re.exec(text);
  return m?.[0]?.trim();
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

/**
 * Build the directory-oriented query variants for one discovery query.
 * Exported for tests.
 */
export function buildTavilyQueries(query: DiscoveryQuery): string[] {
  const loc = [query.city, query.state, query.country]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ");
  const base = [query.keyword.trim(), loc].filter(Boolean).join(" ");
  const queries = [base];
  // One directory-oriented variant — cheap, high signal for Indian B2B.
  if (!/site:/i.test(base)) {
    queries.push(`${base} (site:indiamart.com OR site:tradeindia.com OR site:exportersindia.com)`);
  }
  return queries.slice(0, 2);
}

export class TavilyProvider implements LeadDiscoveryProvider {
  readonly id = "tavily";
  readonly label = "Web Search (Tavily)";
  readonly sourceType: LeadSourceType = "WEB_SEARCH";
  readonly searchable = true;
  readonly capabilities: ProviderCapabilities = {
    websiteAuthority: "unreliable",
    supportsPhone: true,
    supportsEmail: true,
    supportsSocial: false,
    supportsPagination: false,
    supportsRecentEvidence: true,
    discoverySupported: true,
  };

  private fetcher: typeof fetch;

  /** fetcher is injectable so tests can mock the Tavily API. */
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  isConfigured(): boolean {
    return !!readEnv("TAVILY_API_KEY");
  }

  setupInstructions(): string[] {
    return [
      "Create a free account at tavily.com (1,000 free credits/month).",
      "Copy your API key from the Tavily dashboard.",
      'Set TAVILY_API_KEY="<your-key>" in your server environment.',
      "The app enforces a 900 credits/month internal safety ceiling — see TAVILY_MONTHLY_CEILING.",
      "Restart the app server so the new variable is loaded.",
    ];
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const apiKey = readEnv("TAVILY_API_KEY");
    if (!apiKey) return { ok: false, message: "TAVILY_API_KEY is not set." };
    try {
      const res = await this.fetcher(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: "test connectivity",
          search_depth: "basic",
          max_results: 1,
        }),
      });
      if (res.status === 401) return { ok: false, message: "Tavily API key rejected. Check TAVILY_API_KEY." };
      if (!res.ok) return { ok: false, message: `Tavily returned HTTP ${res.status}.` };
      return { ok: true, message: "Connected — Tavily Search responded." };
    } catch (err) {
      return {
        ok: false,
        message: `Could not reach Tavily: ${err instanceof Error ? err.message : "network error"}`,
      };
    }
  }

  private mapResult(r: TavilyResult): DiscoveredCompany | null {
    const url = toSafeHttpUrl(r.url);
    if (!url) return null;
    const name = r.title ? cleanTitle(r.title) : null;
    if (!name) return null;

    const company: DiscoveredCompany = {
      provider: this.id,
      providerId: `tavily:${domainOf(url)}:${Buffer.from(url).toString("base64url").slice(0, 32)}`,
      name,
      provenance: "VERIFIED_DATA",
      discoveredAt: new Date().toISOString(),
      sourceUrl: url,
    };

    const snippet = `${r.title ?? ""}\n${r.content ?? ""}`;
    // Phone/email extracted from the public snippet — evidence lives at the
    // source URL, which the UI always shows. Never invented.
    const phone = extractFirst(snippet, PHONE_RE);
    if (phone) company.phone = phone;
    const email = extractFirst(snippet, EMAIL_RE);
    if (email && !/example\.com$/i.test(email)) company.email = email;

    // If the result IS the business's own site (not a directory), the
    // origin is their website. Directory listings → website stays undefined
    // (UNKNOWN), never assumed absent.
    if (!isDirectoryUrl(url)) {
      try {
        const u = new URL(url);
        company.website = `${u.protocol}//${u.host}`;
      } catch {
        /* ignore */
      }
    }
    if (r.published_date) {
      const d = new Date(r.published_date);
      if (!Number.isNaN(d.getTime())) company.recentEvidenceDate = d.toISOString();
    }
    return company;
  }

  private async runQuery(apiKey: string, q: string, maxResults: number): Promise<TavilyResult[]> {
    let res: Response;
    try {
      res = await this.fetcher(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: q,
          search_depth: "basic",
          max_results: Math.min(Math.max(maxResults, 1), 10),
          include_answer: false,
        }),
      });
    } catch (err) {
      throw new DiscoveryError(
        "PROVIDER_UNREACHABLE",
        "Could not reach the Tavily API.",
        err instanceof Error ? err.message : undefined,
      );
    }
    if (res.status === 401) {
      throw new DiscoveryError("PROVIDER_NOT_CONFIGURED", "Tavily API key rejected. Check TAVILY_API_KEY.");
    }
    if (res.status === 429) {
      throw new DiscoveryError("RATE_LIMITED", "Tavily rate limit hit. Try again later.");
    }
    if (!res.ok) {
      throw new DiscoveryError("PROVIDER_ERROR", `Tavily returned HTTP ${res.status}.`);
    }
    const data = (await res.json()) as { results?: TavilyResult[] };
    return data.results ?? [];
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const apiKey = readEnv("TAVILY_API_KEY");
    if (!apiKey) {
      throw new DiscoveryError(
        "PROVIDER_NOT_CONFIGURED",
        "Web Search is not connected. Set TAVILY_API_KEY to enable it.",
      );
    }
    if (!query.keyword?.trim()) {
      throw new DiscoveryError("INVALID_QUERY", "A search keyword is required.");
    }

    const queries = buildTavilyQueries(query);
    const companies: DiscoveredCompany[] = [];
    const seen = new Set<string>();
    let creditsUsed = 0;
    for (const q of queries) {
      const results = await this.runQuery(apiKey, q, Math.min(query.maxResults, 10));
      creditsUsed += 1; // basic-depth search = 1 credit
      for (const r of results) {
        const c = this.mapResult(r);
        if (c && !seen.has(c.providerId)) {
          seen.add(c.providerId);
          companies.push(c);
        }
      }
    }
    return {
      provider: this.id,
      companies,
      searchedAt: new Date().toISOString(),
      meta: { requestsMade: queries.length, creditsUsed },
    };
  }
}
