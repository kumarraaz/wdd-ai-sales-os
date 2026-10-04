/**
 * Discovery workspace tests — real lead acquisition layer.
 *
 * Covers (§47):
 *  1-8.   Google provider: config, pagination, field-mask cost behavior,
 *          no-website detection, contactability, dedup, budget guard,
 *          free-mode block
 *  9-10.  Geoapify provider + budget guard
 *  11.    OSM fallback intact
 *  12-13. Tavily provider + free budget
 *  14.    Gemini web research provider (attribution required)
 *  15.    Groq provider
 *  16-18. Meta: config failure, permission failure, no consumer discovery
 *  19.    LinkedIn discovery remains disabled
 *  20-21. import: unqualified lead imports; duplicate import
 *  22-23. export selected / filtered
 *  24-26. result filtering, select-all-filtered
 *  27.    no-website leads never trigger website inspection
 *  28.    partial results
 *  29.    provenance labels
 *  30.    tenant isolation (profiles/history)
 *  31.    secret redaction in source catalog
 *  32.    API source failure isolation
 *
 * No real network, no real database — provider HTTP is mocked, db is
 * mocked, and DB-backed suites stay skipIf(!DATABASE_URL).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── hoisted db mock ─────────────────────────────────────────────────────
const { dbState, dbMock } = vi.hoisted(() => {
  const dbState = {
    usageRows: new Map<string, { requests: number; credits: number; blockedRequests: number }>(),
    profiles: [] as any[],
    history: [] as any[],
    leads: [] as any[],
    createdLeads: [] as any[],
  };
  const key = (o: string, p: string, per: string, start: Date) =>
    `${o}|${p}|${per}|${start.toISOString()}`;
  const dbMock = {
    providerUsage: {
      findUnique: vi.fn(async ({ where }: any) => {
        const w = where.organizationId_provider_period_periodStart;
        return dbState.usageRows.get(key(w.organizationId, w.provider, w.period, w.periodStart)) ?? null;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const w = where.organizationId_provider_period_periodStart;
        const k = key(w.organizationId, w.provider, w.period, w.periodStart);
        const prev = dbState.usageRows.get(k) ?? { requests: 0, credits: 0, blockedRequests: 0 };
        const next = {
          requests: prev.requests + (create.requests ?? update.requests?.increment ?? 0),
          credits: prev.credits + (create.credits ?? update.credits?.increment ?? 0),
          blockedRequests: prev.blockedRequests + (create.blockedRequests ?? update.blockedRequests?.increment ?? 0),
        };
        dbState.usageRows.set(k, next);
        return next;
      }),
    },
    discoveryProfile: {
      findMany: vi.fn(async ({ where }: any) => dbState.profiles.filter((p) => p.organizationId === where.organizationId)),
      findFirst: vi.fn(async ({ where }: any) => dbState.profiles.find((p) => p.id === where.id && p.organizationId === where.organizationId) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `prof-${dbState.profiles.length + 1}`, ...data };
        dbState.profiles.push(row);
        return row;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => dbState.profiles.length),
    },
    discoveryHistory: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `hist-${dbState.history.length + 1}`, ...data };
        dbState.history.push(row);
        return row;
      }),
    },
    lead: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    leadFieldProvenance: { createMany: vi.fn(async () => ({ count: 0 })) },
    company: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: "comp-1", ...data })),
    },
  };
  return { dbState, dbMock };
});

vi.mock("../lib/db", () => ({ db: dbMock }));

// createLead is mocked so import tests don't need a database; the mock
// records what it received for assertions.
const { createdLeads } = vi.hoisted(() => ({ createdLeads: [] as any[] }));
vi.mock("../lib/leads", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/leads")>();
  return {
    ...orig,
    createLead: vi.fn(async (_org: string, _actor: string, input: any) => {
      const lead = { id: `lead-${createdLeads.length + 1}`, company: { id: "comp-1" }, ...input };
      createdLeads.push(lead);
      return { lead };
    }),
    findDuplicate: vi.fn(async () => null),
  };
});

import { DiscoveryError, type DiscoveredCompany } from "../lib/discovery/types";
import { GooglePlacesProvider } from "../lib/discovery/google-places";
import { GeoapifyProvider } from "../lib/discovery/providers/geoapify";
import { TavilyProvider } from "../lib/discovery/providers/tavily";
import { GeminiGroundingProvider } from "../lib/discovery/providers/gemini-grounding";
import { MetaProvider } from "../lib/discovery/providers/meta";
import { IndiaRegistryProvider } from "../lib/discovery/providers/india-registry";
import { GroqProvider } from "../lib/ai/providers/groq";
import { getDiscoveryProvider, listSearchableProviders } from "../lib/discovery/registry";
import {
  enrichCandidate,
  dedupeCandidates,
  computeWebsiteStatus,
  computeContactable,
} from "../lib/discovery/candidates";
import {
  runDiscovery,
  buildQueryVariants,
  applyCandidateFilters,
  type RunDeps,
} from "../lib/discovery/run";
import {
  checkProviderBudget,
  recordProviderUsage,
  isZeroSpendMode,
  getProviderCeilings,
} from "../lib/discovery/cost";
import { getSourceCatalog } from "../lib/discovery/sources";
import { listProfiles, createProfile } from "../lib/discovery/profiles";
import { buildCandidatesCsv } from "../lib/discovery/export";
import { filterCandidates, EMPTY_FILTERS } from "../lib/discovery/result-filters";
import { importDiscoveredCompanies } from "../lib/discovery/import";

// ─── helpers ─────────────────────────────────────────────────────────────
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: any, init?: any) => handler(String(url), init)) as unknown as typeof fetch;
}

function googlePlace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ChIJ-test-1",
    displayName: { text: "Sharma Industries" },
    formattedAddress: "Plot 12, GIDC, Ahmedabad, Gujarat, India",
    addressComponents: [
      { longText: "Ahmedabad", types: ["locality"] },
      { longText: "Gujarat", types: ["administrative_area_level_1"] },
      { longText: "India", types: ["country"] },
    ],
    internationalPhoneNumber: "+91 79 4000 1234",
    googleMapsUri: "https://maps.google.com/?cid=123",
    rating: 4.2,
    userRatingCount: 37,
    primaryType: "manufacturer",
    ...overrides,
  };
}

function baseCompany(overrides: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    provider: "google-places",
    providerId: `ChIJ-${Math.random().toString(36).slice(2, 8)}`,
    name: "Sharma Industries",
    category: "manufacturer",
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    phone: "+91 79 4000 1234",
    discoveredAt: new Date().toISOString(),
    provenance: "VERIFIED_DATA",
    ...overrides,
  };
}

function testDeps(overrides: Partial<RunDeps> = {}): RunDeps {
  return {
    getProvider: getDiscoveryProvider,
    listSearchable: listSearchableProviders,
    checkBudget: async () => ({
      allowed: true,
      usedRequests: 0,
      usedCredits: 0,
      period: "month" as const,
      resetLabel: "",
      zeroSpendMode: true,
    }),
    recordUsage: async () => {},
    recordBlocked: async () => {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  dbState.usageRows.clear();
  dbState.profiles.length = 0;
  dbState.history.length = 0;
  createdLeads.length = 0;
  vi.clearAllMocks();
  // Re-apply default mock implementations cleared by clearAllMocks.
  dbMock.lead.findFirst.mockResolvedValue(null);
  dbMock.lead.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1-8. Google provider
// ═══════════════════════════════════════════════════════════════════════════
describe("Google Places provider", () => {
  it("1. throws PROVIDER_NOT_CONFIGURED without an API key", async () => {
    const p = new GooglePlacesProvider(mockFetch(async () => jsonResponse({})));
    expect(p.isConfigured()).toBe(false);
    await expect(p.search({ keyword: "x", maxResults: 5 })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("2. paginates via nextPageToken and counts requests", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "k");
    let calls = 0;
    const fetch = mockFetch(async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      if (calls === 1) {
        expect(body.pageToken).toBeUndefined();
        return jsonResponse({ places: [googlePlace()], nextPageToken: "tok-2" });
      }
      expect(body.pageToken).toBe("tok-2");
      return jsonResponse({ places: [googlePlace({ id: "ChIJ-test-2", displayName: { text: "Patel Works" } })] });
    });
    // Skip the inter-page delay in tests.
    vi.spyOn(global, "setTimeout").mockImplementation(((fn: any) => { fn(); return 0; }) as any);
    const p = new GooglePlacesProvider(fetch);
    const res = await p.search({ keyword: "manufacturers", state: "Gujarat", country: "India", maxResults: 20 });
    expect(res.companies).toHaveLength(2);
    expect(res.meta?.requestsMade).toBe(2);
    (global.setTimeout as any).mockRestore();
  });

  it("3. field mask avoids expensive atmosphere fields; test uses id-only mask", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "k");
    const masks: string[] = [];
    const fetch = mockFetch(async (_url, init) => {
      masks.push(String((init?.headers as Record<string, string>)["X-Goog-FieldMask"]));
      return jsonResponse({ places: [] });
    });
    const p = new GooglePlacesProvider(fetch);
    await p.search({ keyword: "x", maxResults: 5 });
    const mask = masks[0];
    expect(mask).toContain("places.websiteUri");
    expect(mask).toContain("places.internationalPhoneNumber");
    expect(mask).not.toMatch(/places\.reviews\b/);
    expect(mask).not.toContain("editorialSummary");
    await p.testConnection();
    expect(masks[1]).toContain("places.id");
    expect(masks[1]).not.toContain("places.websiteUri");
  });

  it("4. websiteUri absent is mapped without a website (no guessing)", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "k");
    const fetch = mockFetch(async () =>
      jsonResponse({ places: [googlePlace({ websiteUri: undefined })] }),
    );
    const p = new GooglePlacesProvider(fetch);
    const res = await p.search({ keyword: "x", maxResults: 5 });
    expect(res.companies[0].website).toBeUndefined();
    // Enrichment with Google authority → NO_WEBSITE.
    const enriched = enrichCandidate(res.companies[0], "authoritative");
    expect(enriched.websiteStatus).toBe("NO_WEBSITE");
  });

  it("5. contactability: phone → true; nothing → false", () => {
    expect(computeContactable({ phone: "+91 1" })).toBe(true);
    expect(computeContactable({ email: "a@b.com" })).toBe(true);
    expect(computeContactable({})).toBe(false);
    // A maps/directory URL alone is not a contact signal.
    const c = enrichCandidate(baseCompany({ phone: undefined, email: undefined }), "authoritative");
    expect(c.contactable).toBe(false);
  });

  it("6. cross-page duplicates are removed", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "k");
    const dup = googlePlace();
    const fetch = mockFetch(async () => jsonResponse({ places: [dup, dup] }));
    const p = new GooglePlacesProvider(fetch);
    const res = await p.search({ keyword: "x", maxResults: 5 });
    const { unique, removed } = dedupeCandidates(res.companies);
    expect(unique).toHaveLength(1);
    expect(removed).toBe(1);
  });

  it("7. budget guard blocks at the ceiling", async () => {
    vi.stubEnv("GOOGLE_PLACES_MONTHLY_CEILING", "5");
    const start = new Date();
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    dbState.usageRows.set(`org-1|google-places|month|${monthStart.toISOString()}`, {
      requests: 5, credits: 0, blockedRequests: 0,
    });
    const check = await checkProviderBudget("org-1", "google-places");
    expect(check.allowed).toBe(false);
    expect(check.code).toBe("FREE_LIMIT_REACHED");
    expect(check.reason).toMatch(/safety budget/i);
  });

  it("8. zero-spend mode is ON by default; ceilings configurable via env", () => {
    expect(isZeroSpendMode()).toBe(true);
    vi.stubEnv("ZERO_SPEND_MODE", "false");
    expect(isZeroSpendMode()).toBe(false);
    vi.stubEnv("TAVILY_MONTHLY_CEILING", "42");
    expect(getProviderCeilings().tavily.credits).toBe(42);
    // Defaults are conservative.
    vi.unstubAllEnvs();
    expect(getProviderCeilings()["google-places"].requests).toBe(4000);
    expect(getProviderCeilings().tavily.credits).toBe(900);
    expect(getProviderCeilings().geoapify.credits).toBe(2500);
  });

  it("records usage honestly", async () => {
    await recordProviderUsage("org-1", "google-places", { requests: 3 });
    const check = await checkProviderBudget("org-1", "google-places");
    expect(check.usedRequests).toBe(3);
    expect(check.allowed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9-11. Geoapify + OSM
// ═══════════════════════════════════════════════════════════════════════════
describe("Geoapify provider", () => {
  it("9a. not configured without API key", async () => {
    const p = new GeoapifyProvider(mockFetch(async () => jsonResponse({})));
    expect(p.isConfigured()).toBe(false);
    await expect(p.search({ keyword: "x", maxResults: 5 })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("9b. geocodes then searches places; counts 2 credits", async () => {
    vi.stubEnv("GEOAPIFY_API_KEY", "k");
    const urls: string[] = [];
    const fetch = mockFetch(async (url) => {
      urls.push(url);
      if (url.includes("/geocode/")) {
        return jsonResponse({ features: [{ properties: { place_id: "place-1", lat: 23.0, lon: 72.5 } }] });
      }
      return jsonResponse({
        features: [
          {
            properties: {
              place_id: "g-1",
              name: "Ambica Tools",
              city: "Ahmedabad",
              state: "Gujarat",
              country: "India",
              formatted: "Ambica Tools, Ahmedabad, Gujarat",
              website: "https://ambicatools.example.com",
              datasource: { raw: { "contact:phone": "+91 79 1111 2222" } },
            },
          },
        ],
      });
    });
    const p = new GeoapifyProvider(fetch);
    const res = await p.search({ keyword: "manufacturers", state: "Gujarat", country: "India", maxResults: 10 });
    expect(res.companies).toHaveLength(1);
    expect(res.companies[0].name).toBe("Ambica Tools");
    expect(res.companies[0].phone).toBe("+91 79 1111 2222");
    expect(res.companies[0].website).toBe("https://ambicatools.example.com/");
    expect(res.meta?.creditsUsed).toBe(2);
    expect(urls[0]).toContain("/geocode/");
    expect(urls[1]).toContain("/v2/places");
  });

  it("10. geoapify ceiling is enforced", async () => {
    vi.stubEnv("GEOAPIFY_DAILY_CEILING", "3");
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    dbState.usageRows.set(`org-1|geoapify|day|${dayStart.toISOString()}`, {
      requests: 0, credits: 3, blockedRequests: 0,
    });
    const check = await checkProviderBudget("org-1", "geoapify");
    expect(check.allowed).toBe(false);
    expect(check.code).toBe("FREE_LIMIT_REACHED");
  });
});

describe("OpenStreetMap provider", () => {
  it("11. remains the free fallback with unreliable website authority", () => {
    const p = getDiscoveryProvider("openstreetmap");
    expect(p).toBeDefined();
    expect(p!.isConfigured()).toBe(true);
    expect(p!.capabilities?.websiteAuthority).toBe("unreliable");
    // Sparse OSM data: absent website → UNKNOWN, never NO_WEBSITE.
    expect(computeWebsiteStatus({}, false)).toBe("UNKNOWN");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12-14. Web search providers
// ═══════════════════════════════════════════════════════════════════════════
describe("Tavily provider", () => {
  it("12a. not configured without API key", async () => {
    const p = new TavilyProvider(mockFetch(async () => jsonResponse({})));
    expect(p.isConfigured()).toBe(false);
    await expect(p.search({ keyword: "x", maxResults: 5 })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("12b. maps results with source URLs; directory URLs are not websites", async () => {
    vi.stubEnv("TAVILY_API_KEY", "k");
    const fetch = mockFetch(async () =>
      jsonResponse({
        results: [
          {
            title: "Shree Balaji Industries - IndiaMART",
            url: "https://www.indiamart.com/shree-balaji-industries/",
            content: "Manufacturer of valves. Call +91 79 2222 3333 for inquiries.",
          },
          {
            title: "Acme Pumps",
            url: "https://acmepumps.example.com/about",
            content: "Industrial pump manufacturer in Rajkot.",
          },
        ],
      }),
    );
    const p = new TavilyProvider(fetch);
    const res = await p.search({ keyword: "manufacturers", city: "Ahmedabad", state: "Gujarat", country: "India", maxResults: 10 });
    expect(res.companies.length).toBeGreaterThan(0);
    const dir = res.companies.find((c) => c.name === "Shree Balaji Industries");
    expect(dir).toBeDefined();
    expect(dir!.sourceUrl).toContain("indiamart.com");
    expect(dir!.website).toBeUndefined(); // directory listing ≠ website
    expect(dir!.phone).toContain("91");
    expect(dir!.provenance).toBe("VERIFIED_DATA");
    const own = res.companies.find((c) => c.name === "Acme Pumps");
    expect(own?.website).toBe("https://acmepumps.example.com");
    expect(res.meta?.creditsUsed).toBe(2); // 2 queries
  });

  it("13. tavily monthly ceiling enforced", async () => {
    const start = new Date();
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    dbState.usageRows.set(`org-1|tavily|month|${monthStart.toISOString()}`, {
      requests: 0, credits: 900, blockedRequests: 0,
    });
    const check = await checkProviderBudget("org-1", "tavily");
    expect(check.allowed).toBe(false);
    expect(check.code).toBe("FREE_LIMIT_REACHED");
  });
});

describe("Gemini grounding provider", () => {
  it("14a. not configured without API key", async () => {
    const p = new GeminiGroundingProvider(mockFetch(async () => jsonResponse({})));
    expect(p.isConfigured()).toBe(false);
    await expect(p.search({ keyword: "x", maxResults: 5 })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("14b. requires source attribution; fields are AI_INFERENCE", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    const fetch = mockFetch(async () =>
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Sharma Industries | Ahmedabad | +91 79 4000 1234 | NONE | 1\nGhost Corp | Surat | NONE | NONE | 99",
                },
              ],
            },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: "https://example.com/sharma", title: "Sharma" } }],
            },
          },
        ],
      }),
    );
    const p = new GeminiGroundingProvider(fetch);
    const res = await p.search({ keyword: "manufacturers", state: "Gujarat", country: "India", maxResults: 10 });
    // Ghost Corp cites source #99 which does not exist → dropped.
    expect(res.companies).toHaveLength(1);
    expect(res.companies[0].name).toBe("Sharma Industries");
    expect(res.companies[0].provenance).toBe("AI_INFERENCE");
    expect(res.companies[0].sourceUrl).toBe("https://example.com/sharma");
    expect(res.meta?.requestsMade).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. Groq provider
// ═══════════════════════════════════════════════════════════════════════════
describe("Groq provider", () => {
  it("15a. isConfigured reflects GROQ_API_KEY; unknown AI provider rejected", async () => {
    const p = new GroqProvider({ fetchImpl: mockFetch(async () => jsonResponse({})) });
    expect(p.isConfigured()).toBe(false);
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    expect(new GroqProvider({ fetchImpl: mockFetch(async () => jsonResponse({})) }).isConfigured()).toBe(true);
    const { resolveAIProvider, UnknownAIProviderError } = await import("../lib/ai/registry");
    expect(() => resolveAIProvider("groq")).not.toThrow();
    expect(() => resolveAIProvider("nope")).toThrow(UnknownAIProviderError);
  });

  it("15b. generateText posts to the OpenAI-compatible endpoint", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test");
    const seen: { url: string; auth?: string; body?: any }[] = [];
    const fetch = mockFetch(async (url, init) => {
      seen.push({
        url,
        auth: (init?.headers as Record<string, string>)?.["Authorization"],
        body: JSON.parse(String(init?.body)),
      });
      return jsonResponse({
        choices: [{ message: { content: "Hello prospect" } }],
        model: "llama-3.3-70b-versatile",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    });
    const p = new GroqProvider({ fetchImpl: fetch });
    const gen = await p.generateText("sys", "user");
    expect(gen.text).toBe("Hello prospect");
    expect(seen[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(seen[0].auth).toBe("Bearer gsk-test");
    expect(seen[0].body.model).toBe("llama-3.3-70b-versatile");
    // The key is in the Authorization header, never in the URL.
    expect(seen[0].url).not.toContain("gsk-test");
  });

  it("15c. 401 surfaces as NOT_CONFIGURED without leaking the key", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-bad");
    const fetch = mockFetch(async () => new Response("bad", { status: 401 }));
    const p = new GroqProvider({ fetchImpl: fetch });
    await expect(p.generateText("s", "u")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16-19. Meta / registry / LinkedIn
// ═══════════════════════════════════════════════════════════════════════════
describe("Meta + registry stubs", () => {
  it("16. meta not configured without app credentials", () => {
    const p = new MetaProvider();
    expect(p.isConfigured()).toBe(false);
    expect(p.searchable).toBe(false);
  });

  it("17. meta search fails with permission reason, never fake results", async () => {
    const p = new MetaProvider();
    await expect(p.search({ keyword: "x", maxResults: 5 })).rejects.toMatchObject({
      code: "SEARCH_UNSUPPORTED",
    });
    await expect(p.search({ keyword: "x", maxResults: 5 })).rejects.toThrow(/official APIs do not support/i);
  });

  it("18. meta declares discovery unsupported (no consumer account access)", () => {
    const p = new MetaProvider();
    expect(p.capabilities?.discoverySupported).toBe(false);
    expect(p.capabilities?.discoveryUnsupportedReason).toMatch(/will not scrape/i);
  });

  it("19. linkedin discovery remains disabled; registry has no public API", async () => {
    expect(getDiscoveryProvider("linkedin")).toBeUndefined();
    expect(listSearchableProviders().some((p) => p.id === "linkedin")).toBe(false);
    const r = new IndiaRegistryProvider();
    expect(r.isConfigured()).toBe(false);
    await expect(r.search({ keyword: "x", maxResults: 5 })).rejects.toMatchObject({
      code: "SEARCH_UNSUPPORTED",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20-21. Import rules
// ═══════════════════════════════════════════════════════════════════════════
describe("import rules", () => {
  it("20. qualification NEVER blocks import — not_qualified still imports", async () => {
    const provider = getDiscoveryProvider("google-places")!;
    const summary = await importDiscoveredCompanies("org-1", "user-1", provider, [
      enrichCandidate({ ...baseCompany(), qualification: "not_qualified", score: 5 }, "authoritative"),
    ]);
    expect(summary.imported).toHaveLength(1);
    expect(summary.imported[0].status).toBe("imported");
    // Enrichment persisted on the lead.
    const created = createdLeads[0];
    expect(created.websiteStatus).toBeDefined();
    // Lead quality: name, score and opportunity flow into the CRM row.
    expect(created.fullName).toBe("Sharma Industries");
    expect(created.leadScore).toBeGreaterThan(0);
    expect(created.scoreReason).toBeTruthy();
    expect(created.opportunityType).toMatch(/^(HIGH|MEDIUM|LOW|UNKNOWN)$/);
  });

  it("21. duplicate import reports already_exists (idempotent)", async () => {
    const provider = getDiscoveryProvider("google-places")!;
    dbMock.lead.findFirst.mockResolvedValueOnce({
      id: "lead-old",
      externalId: "ChIJ-dup",
      sourceType: "GOOGLE_BUSINESS",
      status: "NEW",
    } as any);
    const summary = await importDiscoveredCompanies("org-1", "user-1", provider, [
      { ...baseCompany(), providerId: "ChIJ-dup" },
    ]);
    expect(summary.alreadyExists).toHaveLength(1);
    expect(summary.alreadyExists[0].status).toBe("already_exists");
    expect(summary.imported).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22-26. Export + table filtering
// ═══════════════════════════════════════════════════════════════════════════
describe("export + result filtering", () => {
  const rows = (): DiscoveredCompany[] => [
    enrichCandidate(baseCompany({ name: "Alpha Mfg", provider: "google-places", providerId: "g-1", category: "manufacturing", phone: "+91 79 9000 0001", rating: 4.8, reviewCount: 200 }), "authoritative"),
    enrichCandidate(baseCompany({ name: "Beta Traders", provider: "geoapify", providerId: "geo-1", category: "trading", phone: undefined, website: undefined }), "unreliable"),
    enrichCandidate(baseCompany({ name: "Gamma Works", provider: "google-places", providerId: "g-3", website: "https://gamma.example.com", phone: "+91 79 9000 0003", rating: 4.0, reviewCount: 50 }), "authoritative"),
  ];

  it("22. export selected builds honest CSV (no invented filler)", () => {
    const csv = buildCandidatesCsv([rows()[0]]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Company");
    expect(lines[0]).toContain("Website Status");
    expect(lines[1]).toContain("Alpha Mfg");
    expect(lines[1]).toContain("NO_WEBSITE");
    expect(csv).not.toMatch(/N\/A|Unknown Owner|Not Available/);
  });

  it("23. export escapes commas and quotes", () => {
    const csv = buildCandidatesCsv([
      { ...rows()[0], name: 'Acme, "Best" Works' },
    ]);
    expect(csv).toContain('"Acme, ""Best"" Works"');
  });

  it("24-25. table filters: source, website status, score bands", () => {
    const all = rows();
    expect(filterCandidates(all, EMPTY_FILTERS)).toHaveLength(3);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, source: "geoapify" })).toHaveLength(1);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, websiteStatus: "NO_WEBSITE" })).toHaveLength(1);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, websiteStatus: "HAS_WEBSITE" })).toHaveLength(1);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, score: "80" })).toHaveLength(0);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, score: "60" })).toHaveLength(1);
    // Scores are computed deterministically from verified evidence:
    // A=60 (no-website 25 + phone 20 + confidence 5 + rating 5 + reviews 5),
    // B=0, C=35 (has website: phone 20 + confidence 5 + rating 5 + reviews 5).
    expect(filterCandidates(all, { ...EMPTY_FILTERS, score: "40" })).toHaveLength(1);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, score: "below40" })).toHaveLength(2);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, contactable: "no" })).toHaveLength(1);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, qualification: "qualified" })).toHaveLength(1);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, qualification: "not_qualified" })).toHaveLength(1);
    expect(filterCandidates(all, { ...EMPTY_FILTERS, qualification: "unreviewed" })).toHaveLength(1);
  });

  it("26. select-all-matching uses filtered ids only", () => {
    const all = rows();
    const filtered = filterCandidates(all, { ...EMPTY_FILTERS, source: "google-places" });
    const ids = filtered.map((c) => c.providerId);
    expect(ids).toEqual(["g-1", "g-3"]);
    expect(ids).not.toContain("geo-1"); // hidden row never selected
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 27-28, 32. Orchestrator: no inspection, partial results, isolation
// ═══════════════════════════════════════════════════════════════════════════
describe("run orchestrator", () => {
  it("27. no-website leads never trigger website inspection (no fetch beyond search)", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "k");
    let fetches = 0;
    const fetch = mockFetch(async () => {
      fetches++;
      return jsonResponse({ places: [googlePlace({ websiteUri: undefined, internationalPhoneNumber: undefined })] });
    });
    const deps = testDeps({
      getProvider: (id) => (id === "google-places" ? new GooglePlacesProvider(fetch) : getDiscoveryProvider(id)),
    });
    const out = await runDiscovery(
      {
        sources: [{ providerId: "google-places", role: "primary" }],
        industry: "manufacturers",
        location: "Gujarat, India",
        websiteFilter: "no_website",
        contactRequired: false,
        opportunity: "new_website",
        recentEvidence: "any",
        limit: 20,
      },
      deps,
    );
    // All fetches are the provider's own search calls (base + 4 Gujarat
    // city variants) — no website inspection, no other hosts.
    expect(fetches).toBe(5);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.candidates.every((c) => c.websiteStatus === "NO_WEBSITE")).toBe(true);
  });

  it("28. partial results: one source fails, the other survives", async () => {
    const good = {
      id: "good",
      label: "Good",
      sourceType: "API",
      searchable: true,
      isConfigured: () => true,
      setupInstructions: () => [],
      search: async () => ({
        provider: "good",
        companies: [baseCompany({ provider: "good", providerId: "gd-1" })],
        searchedAt: new Date().toISOString(),
      }),
    } as any;
    const bad = {
      ...good,
      id: "bad",
      label: "Bad",
      search: async () => {
        throw new DiscoveryError("PROVIDER_ERROR", "boom");
      },
    };
    const deps = testDeps({
      getProvider: (id) => (id === "good" ? good : id === "bad" ? bad : undefined),
      listSearchable: () => [good, bad],
    });
    const out = await runDiscovery(
      {
        sources: [
          { providerId: "good", role: "primary" },
          { providerId: "bad", role: "fallback" },
        ],
        industry: "x",
        location: "Gujarat, India",
        websiteFilter: "any",
        contactRequired: false,
        opportunity: "any",
        recentEvidence: "any",
        limit: 20,
      },
      deps,
    );
    expect(out.status).toBe("PARTIAL");
    expect(out.candidates).toHaveLength(1);
    expect(out.sources.find((s) => s.providerId === "bad")?.status).toBe("failed");
    expect(out.sources.find((s) => s.providerId === "good")?.status).toBe("ok");
  });

  it("32. source failure isolation + truthful counts (never claims the target)", async () => {
    const few = {
      id: "few",
      label: "Few",
      sourceType: "API",
      searchable: true,
      isConfigured: () => true,
      setupInstructions: () => [],
      search: async () => ({
        provider: "few",
        companies: [
          baseCompany({ provider: "few", providerId: "f-1", name: "Few One", phone: "+91 11 1111 1111" }),
          baseCompany({ provider: "few", providerId: "f-2", name: "Few Two", phone: "+91 11 2222 2222" }),
        ],
        searchedAt: new Date().toISOString(),
      }),
    } as any;
    const deps = testDeps({ getProvider: () => few, listSearchable: () => [few] });
    const out = await runDiscovery(
      {
        sources: [{ providerId: "few", role: "primary" }],
        industry: "x",
        location: "India",
        websiteFilter: "any",
        contactRequired: false,
        opportunity: "any",
        recentEvidence: "any",
        limit: 20,
      },
      deps,
    );
    expect(out.summary.requested).toBe(20);
    expect(out.summary.discovered).toBe(2);
    expect(out.candidates).toHaveLength(2);
  });

  it("blocked budget stops the source before any call (FREE_LIMIT_REACHED)", async () => {
    let searched = false;
    const pricey = {
      id: "pricey",
      label: "Pricey",
      sourceType: "API",
      searchable: true,
      isConfigured: () => true,
      setupInstructions: () => [],
      search: async () => {
        searched = true;
        throw new Error("should not be called");
      },
    } as any;
    const deps = testDeps({
      getProvider: () => pricey,
      listSearchable: () => [pricey],
      checkBudget: async () => ({
        allowed: false,
        code: "FREE_LIMIT_REACHED" as const,
        reason: "Free-tier safety budget exhausted.",
        usedRequests: 4000,
        usedCredits: 0,
        period: "month" as const,
        resetLabel: "Resets soon",
        zeroSpendMode: true,
      }),
    });
    const out = await runDiscovery(
      {
        sources: [{ providerId: "pricey", role: "primary" }],
        industry: "x",
        location: "India",
        websiteFilter: "any",
        contactRequired: false,
        opportunity: "any",
        recentEvidence: "any",
        limit: 20,
      },
      deps,
    );
    expect(searched).toBe(false);
    expect(out.status).toBe("LIMIT_REACHED");
    expect(out.sources[0].status).toBe("blocked");
  });

  it("buildQueryVariants fans out Gujarat cities for Google only", () => {
    const variants = buildQueryVariants("google-places", "manufacturers", "Gujarat, India");
    expect(variants.length).toBeGreaterThan(1);
    expect(variants.some((v) => v.city === "Ahmedabad")).toBe(true);
    expect(buildQueryVariants("geoapify", "manufacturers", "Gujarat, India")).toHaveLength(1);
    expect(buildQueryVariants("google-places", "x", "Atlantis")).toHaveLength(1);
  });

  it("applyCandidateFilters honors website/contact/opportunity/evidence", () => {
    const cs = [
      enrichCandidate(baseCompany({ providerId: "a" }), "authoritative"), // no website, phone
      enrichCandidate(baseCompany({ providerId: "b", phone: undefined, website: "https://b.example.com" }), "authoritative"),
      enrichCandidate(baseCompany({ providerId: "c", phone: undefined }), "unreliable"), // unknown website, no phone
    ];
    const base = {
      sources: [], industry: "x", location: "y", websiteFilter: "any" as const,
      contactRequired: false, opportunity: "any" as const, recentEvidence: "any" as const, limit: 10,
    };
    expect(applyCandidateFilters(cs, { ...base, websiteFilter: "no_website" }).map((c) => c.providerId)).toEqual(["a"]);
    expect(applyCandidateFilters(cs, { ...base, contactRequired: true }).map((c) => c.providerId)).toEqual(["a", "b"]);
    expect(applyCandidateFilters(cs, { ...base, opportunity: "MEDIUM" }).map((c) => c.providerId)).toEqual(["a"]);
    expect(applyCandidateFilters(cs, { ...base, recentEvidence: "30d" })).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 29-31. Provenance, tenant isolation, secret redaction
// ═══════════════════════════════════════════════════════════════════════════
describe("provenance, isolation, redaction", () => {
  it("29. provenance labels survive enrichment", () => {
    const v = enrichCandidate(baseCompany({ provenance: "VERIFIED_DATA" }), "authoritative");
    expect(v.provenance).toBe("VERIFIED_DATA");
    const ai = enrichCandidate(baseCompany({ provenance: "AI_INFERENCE" }), "unreliable");
    expect(ai.provenance).toBe("AI_INFERENCE");
  });

  it("30. profiles are tenant-scoped", async () => {
    dbState.profiles.push(
      { id: "p1", organizationId: "org-A", name: "A", config: {} },
      { id: "p2", organizationId: "org-B", name: "B", config: {} },
    );
    const rows = await listProfiles("org-A");
    expect(rows.map((r) => r.id)).toEqual(["p1"]);
    const created = await createProfile("org-A", "Mine", {
      sources: [{ providerId: "google-places", role: "primary", enabled: true }],
      industry: "x",
      location: "y",
      websiteFilter: "any",
      contactRequired: true,
      opportunity: "any",
      recentEvidence: "any",
      limit: 10,
    } as any);
    expect(created.organizationId).toBe("org-A");
  });

  it("31. source catalog never exposes secret values", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "super-secret-key-123");
    vi.stubEnv("TAVILY_API_KEY", "tvly-secret-456");
    const catalog = await getSourceCatalog("org-1");
    const text = JSON.stringify(catalog);
    expect(text).not.toContain("super-secret-key-123");
    expect(text).not.toContain("tvly-secret-456");
    const google = catalog.sources.find((s) => s.id === "google-places")!;
    expect(google.configured).toBe(true);
    expect(google.availability).toBe("CONNECTED");
    const meta = catalog.sources.find((s) => s.id === "meta")!;
    expect(meta.availability).toBe("NOT_CONFIGURED");
  });
});
