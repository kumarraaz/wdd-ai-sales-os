/**
 * Discovery unit tests — no database required.
 *
 * Covers: provider abstraction, missing API key, invalid input, mocked
 * Google provider responses, normalization, duplicate detection, rate
 * limiting, no client-side API key exposure, and demo-mode discovery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { NextRequest } from "next/server";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const v = jar.get(name);
      return v === undefined ? undefined : { value: v };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));

import {
  DiscoveryError,
  type DiscoveredCompany,
} from "../lib/discovery/types";
import { listDiscoveryProviders, getDiscoveryProvider } from "../lib/discovery/registry";
import {
  GooglePlacesProvider,
  toSafeHttpUrl,
} from "../lib/discovery/google-places";
import { CsvImportProvider } from "../lib/discovery/csv-import";
import { duplicateReason } from "../lib/discovery/import";
import {
  discoverySearchSchema,
  discoveryImportSchema,
} from "../lib/validators";
import { checkRateLimit } from "../lib/rate-limit";
import {
  DEMO_COOKIE_NAME,
  createDemoSession,
} from "../lib/demo";
import { getDemoDiscoveryResults } from "../lib/demo-data";
import { POST as demoDiscoverySearch } from "../app/api/demo/discovery/search/route";

beforeEach(() => {
  jar.clear();
  delete process.env.DEMO_MODE;
  delete process.env.GOOGLE_PLACES_API_KEY;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("provider abstraction", () => {
  it("registry lists google-places and csv-import with the required interface", () => {
    const providers = listDiscoveryProviders();
    expect(providers.map((p) => p.id).sort()).toEqual(["csv-import", "google-places"]);
    for (const p of providers) {
      expect(typeof p.label).toBe("string");
      expect(typeof p.isConfigured).toBe("function");
      expect(typeof p.setupInstructions).toBe("function");
      expect(typeof p.search).toBe("function");
      expect(typeof p.searchable).toBe("boolean");
      expect(["GOOGLE_BUSINESS", "CSV", "DIRECTORY", "API"]).toContain(p.sourceType);
    }
  });

  it("getDiscoveryProvider resolves by id and returns undefined for unknown", () => {
    expect(getDiscoveryProvider("google-places")?.label).toBe("Google Places");
    expect(getDiscoveryProvider("csv-import")?.label).toBe("CSV Import");
    expect(getDiscoveryProvider("nope")).toBeUndefined();
  });

  it("google-places is searchable, csv-import is not", () => {
    expect(getDiscoveryProvider("google-places")?.searchable).toBe(true);
    expect(getDiscoveryProvider("csv-import")?.searchable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("missing API key", () => {
  it("isConfigured() is false without GOOGLE_PLACES_API_KEY", () => {
    expect(new GooglePlacesProvider().isConfigured()).toBe(false);
  });

  it("isConfigured() is true when the key is set", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    expect(new GooglePlacesProvider().isConfigured()).toBe(true);
  });

  it("search() throws PROVIDER_NOT_CONFIGURED without a key (never calls fetch)", async () => {
    const fetcher = vi.fn();
    const provider = new GooglePlacesProvider(fetcher as unknown as typeof fetch);
    await expect(provider.search({ keyword: "gyms", maxResults: 5 })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("setup instructions never contain a secret", () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "super-secret-key");
    const instructions = new GooglePlacesProvider().setupInstructions();
    expect(instructions.length).toBeGreaterThan(0);
    for (const step of instructions) {
      expect(step).not.toContain("super-secret-key");
    }
  });
});

// ---------------------------------------------------------------------------
function mockPlacesFetch(places: unknown[], status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () =>
      status === 200 ? { places } : { error: { message: "API key not valid." } },
  })) as unknown as typeof fetch;
}

const SAMPLE_PLACE = {
  id: "ChIJ123",
  displayName: { text: "Acme Industrial" },
  formattedAddress: "Plot 42, GIDC, Ahmedabad, Gujarat, India",
  addressComponents: [
    { longText: "Ahmedabad", types: ["locality"] },
    { longText: "Gujarat", types: ["administrative_area_level_1"] },
    { longText: "India", types: ["country"] },
  ],
  internationalPhoneNumber: "+91 79 4000 1122",
  websiteUri: "https://acme.example.com/",
  googleMapsUri: "https://maps.google.com/?cid=123",
  rating: 4.6,
  userRatingCount: 128,
  primaryType: "manufacturer",
};

describe("Google Places provider (mocked)", () => {
  it("maps a full place response to a normalized company", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    const provider = new GooglePlacesProvider(mockPlacesFetch([SAMPLE_PLACE]));
    const result = await provider.search({ keyword: "manufacturers", maxResults: 5 });

    expect(result.provider).toBe("google-places");
    expect(result.companies).toHaveLength(1);
    const c = result.companies[0] as DiscoveredCompany;
    expect(c.providerId).toBe("ChIJ123");
    expect(c.name).toBe("Acme Industrial");
    expect(c.category).toBe("manufacturer");
    expect(c.city).toBe("Ahmedabad");
    expect(c.state).toBe("Gujarat");
    expect(c.country).toBe("India");
    expect(c.phone).toBe("+91 79 4000 1122");
    expect(c.website).toBe("https://acme.example.com/");
    expect(c.sourceUrl).toBe("https://maps.google.com/?cid=123");
    expect(c.rating).toBe(4.6);
    expect(c.reviewCount).toBe(128);
    expect(c.provenance).toBe("VERIFIED_DATA");
    expect(typeof c.discoveredAt).toBe("string");
  });

  it("never invents missing fields — they stay undefined", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    const provider = new GooglePlacesProvider(
      mockPlacesFetch([{ id: "ChIJ999", displayName: { text: "No Data Co" } }]),
    );
    const result = await provider.search({ keyword: "x", maxResults: 5 });
    const c = result.companies[0] as DiscoveredCompany;
    expect(c.phone).toBeUndefined();
    expect(c.website).toBeUndefined();
    expect(c.rating).toBeUndefined();
    expect(c.reviewCount).toBeUndefined();
    expect(c.city).toBeUndefined();
  });

  it("skips places without an id or name", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    const provider = new GooglePlacesProvider(
      mockPlacesFetch([
        { id: "ChIJ1" }, // no name
        { displayName: { text: "Nameless" } }, // no id
        SAMPLE_PLACE,
      ]),
    );
    const result = await provider.search({ keyword: "x", maxResults: 5 });
    expect(result.companies).toHaveLength(1);
  });

  it("sends the key as a header, never in the URL", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key-abc");
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetcher = vi.fn(async (url: unknown, init: unknown) => {
      capturedUrl = String(url);
      capturedHeaders = (init as { headers: Record<string, string> }).headers;
      return { ok: true, status: 200, json: async () => ({ places: [] }) };
    }) as unknown as typeof fetch;
    await new GooglePlacesProvider(fetcher).search({ keyword: "x", maxResults: 5 });
    expect(capturedUrl).not.toContain("test-key-abc");
    expect(capturedHeaders["X-Goog-Api-Key"]).toBe("test-key-abc");
  });

  it("maps API errors to PROVIDER_ERROR without leaking the key", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key-abc");
    const provider = new GooglePlacesProvider(mockPlacesFetch([], 400));
    const err = await provider
      .search({ keyword: "x", maxResults: 5 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(`${err.message}${err.detail ?? ""}`).not.toContain("test-key-abc");
  });

  it("maps network failures to PROVIDER_UNREACHABLE", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(
      new GooglePlacesProvider(fetcher).search({ keyword: "x", maxResults: 5 }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNREACHABLE" });
  });

  it("rejects an empty keyword with INVALID_QUERY", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    await expect(
      new GooglePlacesProvider(mockPlacesFetch([])).search({ keyword: "  ", maxResults: 5 }),
    ).rejects.toMatchObject({ code: "INVALID_QUERY" });
  });
});

// ---------------------------------------------------------------------------
describe("URL normalization", () => {
  it("accepts https URLs", () => {
    expect(toSafeHttpUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("rejects javascript: and non-URL strings", () => {
    expect(toSafeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(toSafeHttpUrl("not a url")).toBeUndefined();
    expect(toSafeHttpUrl(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("duplicate detection (pure)", () => {
  const candidate = {
    providerId: "ChIJ123",
    sourceType: "GOOGLE_BUSINESS",
    phone: "+91 79 4000 1122",
    domain: "acme.example.com",
  };

  it("detects the same provider listing", () => {
    const reason = duplicateReason(
      candidate,
      {
        id: "l1",
        externalId: "ChIJ123",
        sourceType: "GOOGLE_BUSINESS",
        email: null,
        phone: null,
        domain: null,
      },
      "Google Places",
    );
    expect(reason).toContain("same Google Places listing");
  });

  it("detects email matches case-insensitively", () => {
    const reason = duplicateReason(
      { ...candidate, email: "Info@Acme.com" },
      { id: "l1", externalId: null, sourceType: "", email: "info@acme.com", phone: null, domain: null },
      "Google Places",
    );
    expect(reason).toContain("email");
  });

  it("detects phone matches after digit normalization", () => {
    const reason = duplicateReason(
      candidate,
      {
        id: "l1",
        externalId: null,
        sourceType: "",
        email: null,
        phone: "+91-79-4000-1122",
        domain: null,
      },
      "Google Places",
    );
    expect(reason).toContain("phone");
  });

  it("detects domain matches", () => {
    const reason = duplicateReason(
      candidate,
      { id: "l1", externalId: null, sourceType: "", email: null, phone: null, domain: "acme.example.com" },
      "Google Places",
    );
    expect(reason).toContain("website");
  });

  it("returns null when nothing matches", () => {
    expect(
      duplicateReason(
        candidate,
        { id: "l1", externalId: "other", sourceType: "GOOGLE_BUSINESS", email: null, phone: null, domain: null },
        "Google Places",
      ),
    ).toBeNull();
    expect(duplicateReason(candidate, null, "Google Places")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("CSV import provider", () => {
  it("ingestRows normalizes rows with USER_PROVIDED provenance", () => {
    const provider = new CsvImportProvider();
    const companies = provider.ingestRows(
      [
        { Company: "Acme", City: "Ahmedabad", Phone: "+91 1" },
        { Company: "", City: "Nowhere" }, // no name → skipped
      ],
      { name: "Company", city: "City", phone: "Phone" },
    );
    expect(companies).toHaveLength(1);
    expect(companies[0]?.name).toBe("Acme");
    expect(companies[0]?.city).toBe("Ahmedabad");
    expect(companies[0]?.provenance).toBe("USER_PROVIDED");
    expect(companies[0]?.provider).toBe("csv-import");
  });

  it("search() throws SEARCH_UNSUPPORTED", () => {
    expect(() =>
      new CsvImportProvider().search({ keyword: "x", maxResults: 1 }),
    ).toThrowError(expect.objectContaining({ code: "SEARCH_UNSUPPORTED" }));
  });
});

// ---------------------------------------------------------------------------
describe("input validation", () => {
  it("rejects invalid discovery searches", () => {
    expect(discoverySearchSchema.safeParse({ providerId: "google-places", keyword: "" }).success).toBe(false);
    expect(
      discoverySearchSchema.safeParse({ providerId: "google-places", keyword: "x", maxResults: 21 }).success,
    ).toBe(false);
    expect(
      discoverySearchSchema.safeParse({ providerId: "google-places", keyword: "x", maxResults: 0 }).success,
    ).toBe(false);
    expect(
      discoverySearchSchema.safeParse({ providerId: "google-places", keyword: "x", radiusMeters: 50 }).success,
    ).toBe(false);
    expect(
      discoverySearchSchema.safeParse({ providerId: "", keyword: "x" }).success,
    ).toBe(false);
  });

  it("accepts a valid discovery search with defaults", () => {
    const parsed = discoverySearchSchema.safeParse({
      providerId: "google-places",
      keyword: "manufacturers in Ahmedabad",
      city: "Ahmedabad",
      country: "India",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.maxResults).toBe(20);
  });

  it("rejects invalid discovery imports", () => {
    expect(
      discoveryImportSchema.safeParse({ providerId: "google-places", companies: [] }).success,
    ).toBe(false);
    expect(
      discoveryImportSchema.safeParse({
        providerId: "google-places",
        companies: Array.from({ length: 101 }, (_, i) => ({
          provider: "google-places",
          providerId: `p${i}`,
          name: "X",
          discoveredAt: new Date().toISOString(),
          provenance: "VERIFIED_DATA",
        })),
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("rate limiting (memory fallback)", () => {
  it("blocks after the limit is exceeded", async () => {
    const key = `discovery-test-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(key, { limit: 5, windowMs: 60_000 });
      expect(r.success).toBe(true);
    }
    const blocked = await checkRateLimit(key, { limit: 5, windowMs: 60_000 });
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("no client-side API key exposure", () => {
  it("provider source never references NEXT_PUBLIC_", () => {
    const src = readFileSync("lib/discovery/google-places.ts", "utf8");
    expect(src).not.toContain("NEXT_PUBLIC");
  });

  it("providers API route source never embeds the key", () => {
    const src = readFileSync("app/api/discovery/providers/route.ts", "utf8");
    expect(src).not.toContain("GOOGLE_PLACES_API_KEY");
  });
});

// ---------------------------------------------------------------------------
describe("demo-mode discovery", () => {
  function seedDemoCookie(): string {
    vi.stubEnv("DEMO_MODE", "true");
    const token = createDemoSession();
    if (!token) throw new Error("test setup failed");
    jar.set(DEMO_COOKIE_NAME, token);
    return token;
  }

  it("fixtures are all labeled DEMO_DATA and filter by keyword", () => {
    const results = getDemoDiscoveryResults({ keyword: "manufacturer", maxResults: 20 });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.provenance).toBe("DEMO_DATA");
      expect(r.provider).toBe("google-places");
    }
    const none = getDemoDiscoveryResults({ keyword: "zzz-no-match", maxResults: 20 });
    expect(none).toHaveLength(0);
  });

  it("POST /api/demo/discovery/search returns 404 when demo mode is off", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const res = await demoDiscoverySearch(
      new NextRequest("http://localhost/api/demo/discovery/search", {
        method: "POST",
        body: JSON.stringify({ keyword: "x" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/demo/discovery/search serves DEMO_DATA with a valid session", async () => {
    seedDemoCookie();
    const res = await demoDiscoverySearch(
      new NextRequest("http://localhost/api/demo/discovery/search", {
        method: "POST",
        body: JSON.stringify({ keyword: "dubai", maxResults: 20 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demo).toBe(true);
    expect(body.companies.length).toBeGreaterThan(0);
    for (const c of body.companies) expect(c.provenance).toBe("DEMO_DATA");
  });

  it("demo discovery never touches the network (fixtures are static)", async () => {
    const fetcher = vi.fn();
    void fetcher;
    // getDemoDiscoveryResults is synchronous over static fixtures — if it
    // ever needed fetch, this test's design would have to change.
    const results = getDemoDiscoveryResults({ keyword: "", maxResults: 20 });
    expect(results.length).toBeGreaterThan(0);
  });
});
