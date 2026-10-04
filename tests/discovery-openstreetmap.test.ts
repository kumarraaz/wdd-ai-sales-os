/**
 * OpenStreetMap (Overpass) provider tests.
 *
 * fetch is fully mocked — no live Overpass requests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  OpenStreetMapProvider,
  buildOverpassQuery,
  escapeOverpassRegex,
} from "../lib/discovery/openstreetmap";
import { DiscoveryError } from "../lib/discovery/types";

function mockFetch(response: Partial<Response> & { jsonImpl?: () => unknown }) {
  const fn = vi.fn(async () => {
    const res = {
      ok: true,
      status: 200,
      json: async () => {
        if (response.jsonImpl) return response.jsonImpl();
        throw new Error("invalid json");
      },
    } as Response;
    return Object.assign(res, { ok: response.ok ?? true, status: response.status ?? 200 });
  });
  return fn as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

/**
 * Mock fetch with per-call responses, in order. A response entry can be:
 * - { status, ok, jsonImpl } for an HTTP response
 * - { networkError: true } to throw
 */
type SeqEntry =
  | (Partial<Response> & { jsonImpl?: () => unknown })
  | { networkError: true };

function mockFetchSequence(entries: SeqEntry[]) {
  const calls: unknown[][] = [];
  const fn = vi.fn(async (url: unknown, init: unknown) => {
    calls.push([url, init]);
    const entry = entries[Math.min(calls.length - 1, entries.length - 1)];
    if ("networkError" in entry) throw new Error("boom");
    const res = {
      ok: true,
      status: 200,
      json: async () => {
        const impl = (entry as { jsonImpl?: () => unknown }).jsonImpl;
        if (impl) return impl();
        throw new Error("invalid json");
      },
    } as Response;
    return Object.assign(res, {
      ok: (entry as Partial<Response>).ok ?? true,
      status: (entry as Partial<Response>).status ?? 200,
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const PRIMARY = "https://overpass-api.de/api/interpreter";
const FALLBACK = "https://overpass.private.coffee/api/interpreter";

function overpassResponse(elements: unknown[]) {
  return mockFetch({
    jsonImpl: () => ({ elements }),
  });
}

describe("OpenStreetMapProvider identity", () => {
  it("has the correct id, label, sourceType and flags", () => {
    const p = new OpenStreetMapProvider(mockFetch({}));
    expect(p.id).toBe("openstreetmap");
    expect(p.label).toBe("OpenStreetMap (Overpass)");
    expect(p.sourceType).toBe("OPENSTREETMAP");
    expect(p.searchable).toBe(true);
  });

  it("isConfigured() is always true — no API key required", () => {
    const p = new OpenStreetMapProvider(mockFetch({}));
    expect(p.isConfigured()).toBe(true);
  });
});

describe("escapeOverpassRegex", () => {
  it("escapes regex special characters", () => {
    expect(escapeOverpassRegex("A.C.M.E (Pvt) Ltd.")).toBe("A\\.C\\.M\\.E \\(Pvt\\) Ltd\\.");
  });
});

describe("buildOverpassQuery", () => {
  it("builds manufacturer tag clauses for a state area (no slow name regex)", () => {
    const ql = buildOverpassQuery({
      keyword: "Manufacturers",
      state: "Gujarat",
      country: "India",
      maxResults: 10,
    });
    expect(ql).toContain("[out:json][timeout:20];");
    expect(ql).toContain('admin_level"="4"');
    expect(ql).toContain("Gujarat");
    expect(ql).toContain('nwr["craft"](area.searchArea);');
    expect(ql).toContain('nwr["industrial"](area.searchArea);');
    expect(ql).toContain('nwr["man_made"="works"](area.searchArea);');
    expect(ql).toContain('nwr["office"="company"](area.searchArea);');
    // Known business types use the fast indexed tag search, not regex scans.
    expect(ql).not.toContain('nwr["name"~');
    expect(ql).toContain("out center 10;");
    expect(ql).toContain("map_to_area");
  });

  it("falls back to name/brand/operator/description regex for unknown keywords", () => {
    const ql = buildOverpassQuery({ keyword: "yoga studio", state: "Gujarat", maxResults: 5 });
    expect(ql).toContain('nwr["name"~"yoga studio",i](area.searchArea);');
    expect(ql).toContain('nwr["brand"~"yoga studio",i](area.searchArea);');
    expect(ql).toContain('nwr["operator"~"yoga studio",i](area.searchArea);');
    expect(ql).toContain('nwr["description"~"yoga studio",i](area.searchArea);');
  });

  it("builds salon tag clauses", () => {
    const ql = buildOverpassQuery({ keyword: "salon", city: "Surat", maxResults: 5 });
    expect(ql).toContain('nwr["shop"="beauty"](area.searchArea);');
    expect(ql).toContain('nwr["beauty"="hairdresser"](area.searchArea);');
    expect(ql).toContain('nwr["beauty"="beauty_salon"](area.searchArea);');
    expect(ql).toContain('admin_level"~"^(6|7|8)$"');
    expect(ql).toContain("Surat");
  });

  it("builds gym tag clauses", () => {
    const ql = buildOverpassQuery({ keyword: "gym", country: "India", maxResults: 5 });
    expect(ql).toContain('nwr["leisure"="fitness_centre"](area.searchArea);');
    expect(ql).toContain('admin_level"="2"');
  });

  it("prefers city over state over country", () => {
    const cityQl = buildOverpassQuery({
      keyword: "x", city: "Ahmedabad", state: "Gujarat", country: "India", maxResults: 5,
    });
    expect(cityQl).toContain("Ahmedabad");
    expect(cityQl).not.toContain("Gujarat");

    const stateQl = buildOverpassQuery({
      keyword: "x", state: "Gujarat", country: "India", maxResults: 5,
    });
    expect(stateQl).toContain("Gujarat");
    expect(stateQl).not.toContain("India\",i]->.searchArea");

    const countryQl = buildOverpassQuery({ keyword: "x", country: "India", maxResults: 5 });
    expect(countryQl).toContain('admin_level"="2"');
  });

  it("escapes the keyword in the regex", () => {
    const ql = buildOverpassQuery({ keyword: "A.C.M.E", state: "Gujarat", maxResults: 5 });
    expect(ql).toContain('nwr["name"~"A\\.C\\.M\\.E",i]');
  });

  it("respects maxResults up to 50", () => {
    expect(buildOverpassQuery({ keyword: "x", state: "y", maxResults: 50 })).toContain("out center 50;");
    expect(buildOverpassQuery({ keyword: "x", state: "y", maxResults: 99 })).toContain("out center 50;");
    expect(buildOverpassQuery({ keyword: "x", state: "y", maxResults: 7 })).toContain("out center 7;");
  });

  it("throws INVALID_QUERY without keyword or location", () => {
    expect(() => buildOverpassQuery({ keyword: "", state: "Gujarat", maxResults: 5 }))
      .toThrowError(DiscoveryError);
    expect(() => buildOverpassQuery({ keyword: "x", maxResults: 5 }))
      .toThrowError(DiscoveryError);
    try {
      buildOverpassQuery({ keyword: "", maxResults: 5 });
    } catch (e) {
      expect((e as DiscoveryError).code).toBe("INVALID_QUERY");
    }
  });
});

describe("search normalization", () => {
  const fullElement = {
    type: "node",
    id: 123456,
    lat: 23.0,
    lon: 72.5,
    tags: {
      name: "Vibrant Steel Fabricators",
      craft: "metal_construction",
      "addr:housenumber": "18",
      "addr:street": "GIDC Vatva",
      "addr:city": "Ahmedabad",
      "addr:state": "Gujarat",
      "addr:postcode": "382445",
      "addr:country": "India",
      phone: "+91 79 4000 2211",
      website: "https://vibrantsteel.example.com",
    },
  };

  it("normalizes name, providerId, website, phone, sourceUrl", async () => {
    const p = new OpenStreetMapProvider(overpassResponse([fullElement]));
    const result = await p.search({ keyword: "Manufacturers", state: "Gujarat", maxResults: 10 });

    expect(result.provider).toBe("openstreetmap");
    expect(result.companies).toHaveLength(1);
    const c = result.companies[0];
    expect(c.providerId).toBe("osm:node:123456");
    expect(c.name).toBe("Vibrant Steel Fabricators");
    expect(c.category).toBe("craft: metal_construction");
    expect(c.address).toBe("18 GIDC Vatva, Ahmedabad, 382445, India");
    expect(c.city).toBe("Ahmedabad");
    expect(c.state).toBe("Gujarat");
    expect(c.country).toBe("India");
    expect(c.phone).toBe("+91 79 4000 2211");
    expect(c.website).toBe("https://vibrantsteel.example.com/");
    expect(c.sourceUrl).toBe("https://www.openstreetmap.org/node/123456");
    expect(c.provenance).toBe("VERIFIED_DATA");
    expect(c.discoveredAt).toBeTruthy();
  });

  it("leaves missing fields undefined — never invents", async () => {
    const p = new OpenStreetMapProvider(
      overpassResponse([{ type: "way", id: 999, tags: { name: "Nameless Works", industrial: "yes" } }]),
    );
    const result = await p.search({ keyword: "factory", state: "Gujarat", maxResults: 10 });
    const c = result.companies[0];
    expect(c.providerId).toBe("osm:way:999");
    expect(c.phone).toBeUndefined();
    expect(c.website).toBeUndefined();
    expect(c.address).toBeUndefined();
    expect(c.city).toBeUndefined();
    expect(c.category).toBe("industrial");
  });

  it("skips elements without a name", async () => {
    const p = new OpenStreetMapProvider(
      overpassResponse([
        { type: "node", id: 1, tags: { craft: "plumber" } },
        { type: "node", id: 2, tags: { name: "Has Name" } },
      ]),
    );
    const result = await p.search({ keyword: "x", state: "y", maxResults: 10 });
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0].name).toBe("Has Name");
  });

  it("removes duplicate OSM elements by providerId", async () => {
    const el = { type: "node", id: 42, tags: { name: "Dup Co", shop: "beauty" } };
    const p = new OpenStreetMapProvider(overpassResponse([el, el, { ...el, id: 43 }]));
    const result = await p.search({ keyword: "salon", state: "y", maxResults: 10 });
    expect(result.companies.map((c) => c.providerId)).toEqual(["osm:node:42", "osm:node:43"]);
  });

  it("rejects non-http(s) websites", async () => {
    const p = new OpenStreetMapProvider(
      overpassResponse([{ type: "node", id: 5, tags: { name: "Bad Site", website: "ftp://example.com" } }]),
    );
    const result = await p.search({ keyword: "x", state: "y", maxResults: 10 });
    expect(result.companies[0].website).toBeUndefined();
  });
});

describe("request shape", () => {
  it("POSTs urlencoded data with an identifiable User-Agent", async () => {
    const fetchMock = mockFetch({ jsonImpl: () => ({ elements: [] }) });
    const p = new OpenStreetMapProvider(fetchMock);
    await p.search({ keyword: "Manufacturers", state: "Gujarat", maxResults: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("WDD-AI-Sales-OS");
    expect(String(init.body)).toMatch(/^data=/);
    expect(decodeURIComponent(String(init.body).slice(5))).toContain("[out:json][timeout:20];");
  });
});

describe("error handling", () => {
  it("primary succeeds — fallback never called", async () => {
    const { fetch, calls } = mockFetchSequence([
      { jsonImpl: () => ({ elements: [] }) },
      { jsonImpl: () => ({ elements: [] }) },
    ]);
    const p = new OpenStreetMapProvider(fetch);
    await p.search({ keyword: "x", state: "y", maxResults: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(PRIMARY);
  });

  it("primary 504 -> fallback succeeds", async () => {
    const el = { type: "node", id: 1, tags: { name: "Fallback Co" } };
    const { fetch, calls } = mockFetchSequence([
      { status: 504, ok: false },
      { jsonImpl: () => ({ elements: [el] }) },
    ]);
    const p = new OpenStreetMapProvider(fetch);
    const result = await p.search({ keyword: "x", state: "y", maxResults: 5 });
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(PRIMARY);
    expect(calls[1][0]).toBe(FALLBACK);
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0].name).toBe("Fallback Co");
    expect(result.provider).toBe("openstreetmap");
  });

  it("primary 503 -> fallback succeeds", async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 503, ok: false },
      { jsonImpl: () => ({ elements: [] }) },
    ]);
    const p = new OpenStreetMapProvider(fetch);
    const result = await p.search({ keyword: "x", state: "y", maxResults: 5 });
    expect(calls).toHaveLength(2);
    expect(result.companies).toHaveLength(0);
  });

  it("primary 429 -> fallback succeeds and returns normal companies", async () => {
    const el = { type: "way", id: 7, tags: { name: "Rate Ltd Co", shop: "beauty" } };
    const { fetch, calls } = mockFetchSequence([
      { status: 429, ok: false },
      { jsonImpl: () => ({ elements: [el] }) },
    ]);
    const p = new OpenStreetMapProvider(fetch);
    const result = await p.search({ keyword: "salon", state: "y", maxResults: 5 });
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toBe(FALLBACK);
    expect(result.companies[0].providerId).toBe("osm:way:7");
  });

  it("primary network failure -> fallback succeeds", async () => {
    const { fetch, calls } = mockFetchSequence([
      { networkError: true },
      { jsonImpl: () => ({ elements: [] }) },
    ]);
    const p = new OpenStreetMapProvider(fetch);
    await p.search({ keyword: "x", state: "y", maxResults: 5 });
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(PRIMARY);
    expect(calls[1][0]).toBe(FALLBACK);
  });

  it("both endpoints 429 -> RATE_LIMITED", async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 429, ok: false },
      { status: 429, ok: false },
    ]);
    const p = new OpenStreetMapProvider(fetch);
    const err = await p.search({ keyword: "x", state: "y", maxResults: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(DiscoveryError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toMatch(/rate-limit/i);
    expect(calls).toHaveLength(2);
  });

  it("both endpoints fail (504 then network) -> PROVIDER_UNREACHABLE with friendly message", async () => {
    const { fetch } = mockFetchSequence([
      { status: 504, ok: false },
      { networkError: true },
    ]);
    const p = new OpenStreetMapProvider(fetch);
    const err = await p.search({ keyword: "x", state: "y", maxResults: 5 }).catch((e) => e);
    expect(err.code).toBe("PROVIDER_UNREACHABLE");
    expect(err.message).toBe("OpenStreetMap is temporarily busy. Please try again in a moment.");
  });

  it("does not send requests in parallel — fallback only after primary settles", async () => {
    const order: string[] = [];
    const { fetch } = mockFetchSequence([
      { status: 504, ok: false },
      { jsonImpl: () => ({ elements: [] }) },
    ]);
    const wrapped = (async (url: unknown, init: unknown) => {
      order.push(`start:${url}`);
      const res = await (fetch as (u: unknown, i: unknown) => Promise<Response>)(url, init);
      order.push(`end:${url}`);
      return res;
    }) as unknown as typeof fetch;
    const p = new OpenStreetMapProvider(wrapped);
    await p.search({ keyword: "x", state: "y", maxResults: 5 });
    expect(order).toEqual([
      `start:${PRIMARY}`,
      `end:${PRIMARY}`,
      `start:${FALLBACK}`,
      `end:${FALLBACK}`,
    ]);
  });

  it("non-retryable errors (e.g. 400) fail fast without fallback", async () => {
    const { fetch, calls } = mockFetchSequence([
      { status: 400, ok: false },
      { jsonImpl: () => ({ elements: [] }) },
    ]);
    const p = new OpenStreetMapProvider(fetch);
    const err = await p.search({ keyword: "x", state: "y", maxResults: 5 }).catch((e) => e);
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(calls).toHaveLength(1);
  });

  it("maps invalid JSON to PROVIDER_ERROR", async () => {
    const p = new OpenStreetMapProvider(mockFetch({})); // jsonImpl throws
    const err = await p.search({ keyword: "x", state: "y", maxResults: 5 }).catch((e) => e);
    expect(err.code).toBe("PROVIDER_ERROR");
  });

  it("surfaces INVALID_QUERY for missing keyword", async () => {
    const p = new OpenStreetMapProvider(mockFetch({}));
    const err = await p.search({ keyword: "  ", state: "y", maxResults: 5 }).catch((e) => e);
    expect(err.code).toBe("INVALID_QUERY");
  });
});
