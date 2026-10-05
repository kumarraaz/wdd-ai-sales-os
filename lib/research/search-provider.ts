/**
 * Generic public web-search provider abstraction.
 *
 * Tavily is ONE provider behind this interface — not "the Instagram
 * database". Future providers (Serper, Brave, self-hosted, …) implement the
 * same interface. API keys stay server-side; this module never exposes them.
 *
 * Results are normalized to { title, url, snippet, source, retrievedAt }.
 * When the provider is not configured, search() resolves to [] (never fake
 * results); callers use isConfigured()/statusDetail() for health reporting.
 */

/** Base URL for the Tavily Search API (direct HTTPS calls, no SDK). */
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Provider id, e.g. "tavily". */
  source: string;
  /** ISO timestamp of retrieval. */
  retrievedAt: string;
}

export interface WebSearchOptions {
  maxResults?: number;
  /** Per-request timeout in ms. Default 20_000. */
  timeoutMs?: number;
  /** Drop instagram.com URLs from results (research mode: listed, never fetched). */
  excludeInstagramUrls?: boolean;
}

export interface WebSearchProvider {
  readonly id: string;
  isConfigured(): boolean;
  /** Human-readable status for health checks — never includes secrets. */
  statusDetail(): string;
  search(query: string, opts?: WebSearchOptions): Promise<WebSearchResult[]>;
}

function isInstagramUrl(url: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() === "instagram.com";
  } catch {
    return false;
  }
}

/**
 * Tavily implementation. Direct HTTPS calls to api.tavily.com/search —
 * intentionally no SDK dependency (the integration predates any package).
 * Auth via api_key in the request body, per Tavily's API.
 */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = "tavily";

  isConfigured(): boolean {
    return !!process.env.TAVILY_API_KEY;
  }

  statusDetail(): string {
    return this.isConfigured()
      ? "Configured"
      : "Public web search provider is not configured.";
  }

  async search(query: string, opts: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    // Not configured: no fake results, just an empty set. Callers report
    // statusDetail() to the user.
    if (!apiKey) return [];

    const maxResults = Math.min(Math.max(opts.maxResults ?? 10, 1), 20);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await fetch(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "basic",
          max_results: maxResults,
          include_answer: false,
        }),
      });
      if (!res.ok) throw new Error(`Tavily returned HTTP ${res.status}.`);
      const data = (await res.json()) as {
        results?: { title?: string; url?: string; content?: string }[];
      };
      const retrievedAt = new Date().toISOString();
      return (data.results ?? [])
        .filter((r) => r.url && !(opts.excludeInstagramUrls && isInstagramUrl(r.url)))
        .map((r) => ({
          title: r.title ?? "",
          url: r.url as string,
          snippet: (r.content ?? "").slice(0, 600),
          source: this.id,
          retrievedAt,
        }));
    } finally {
      clearTimeout(timer);
    }
  }
}

let cached: WebSearchProvider | null = null;

/** Resolve the configured web-search provider (Tavily today). */
export function getWebSearchProvider(): WebSearchProvider {
  if (!cached) cached = new TavilySearchProvider();
  return cached;
}
