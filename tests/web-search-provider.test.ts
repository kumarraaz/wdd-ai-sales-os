/**
 * WebSearchProvider tests — the shared public-web-search abstraction.
 *
 * Asserts: Tavily returns mapped results; missing key is an honest
 * no-config (empty results, never fake); HTTP errors surface; Instagram
 * URLs are excludable; the registry shares one instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TavilySearchProvider, getWebSearchProvider } from "../lib/research/search-provider";

const TAVILY_RESPONSE = {
  results: [
    {
      title: "ABC Plastics",
      url: "https://abcplastics.com",
      content: "Manufacturers of plastic packaging.",
    },
  ],
};

describe("TavilySearchProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.TAVILY_API_KEY = "tvly-test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.TAVILY_API_KEY;
  });

  it("returns mapped results on success", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => TAVILY_RESPONSE,
    } as Response);

    const provider = new TavilySearchProvider();
    expect(provider.isConfigured()).toBe(true);
    const results = await provider.search("ABC Plastics Ahmedabad", { maxResults: 5 });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://abcplastics.com");
    expect(results[0].title).toBe("ABC Plastics");
    expect(results[0].snippet).toContain("plastic packaging");
    expect(results[0].source).toBe("tavily");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toBe("ABC Plastics Ahmedabad");
    expect(body.search_depth).toBe("basic");
    expect(body.max_results).toBe(5);
    expect(body.include_answer).toBe(false);
  });

  it("excludes Instagram URLs when asked", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "IG", url: "https://www.instagram.com/abcplastics/", content: "x" },
          { title: "Site", url: "https://abcplastics.com", content: "y" },
        ],
      }),
    } as Response);

    const provider = new TavilySearchProvider();
    const results = await provider.search("abc plastics", { excludeInstagramUrls: true });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://abcplastics.com");
  });

  it("throws with the HTTP status on provider failure", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as unknown as Response);

    const provider = new TavilySearchProvider();
    await expect(provider.search("x")).rejects.toThrow("Tavily returned HTTP 401");
  });

  it("unconfigured: empty results, honest status detail", async () => {
    delete process.env.TAVILY_API_KEY;
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const provider = new TavilySearchProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.statusDetail()).toContain("not configured");
    const results = await provider.search("x");
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getWebSearchProvider shares a singleton", () => {
    const a = getWebSearchProvider();
    const b = getWebSearchProvider();
    expect(a).toBe(b);
    expect(a.id).toBe("tavily");
  });
});
