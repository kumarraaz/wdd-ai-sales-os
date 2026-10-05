/**
 * System health API tests.
 *
 * Asserts: statuses reflect configuration without ever leaking secret
 * values; kill switch flips automation to PAUSED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fake = vi.hoisted(() => {
  return {
    planActive: true,
    db: {
      $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
      instagramProspectingPlan: {
        findFirst: vi.fn(async () => ({ isActive: fake.planActive })),
      },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: fake.db }));
vi.mock("@/lib/tenant", () => ({
  withWorkspace: (handler: any) => async (req: any) =>
    handler(req, {
      organization: { id: "org-1" },
      membership: { role: "SALES_MANAGER" },
      user: { id: "user-1" },
    }),
}));
vi.mock("@/lib/research/search-provider", () => ({
  getWebSearchProvider: () => ({
    id: "tavily",
    isConfigured: () => !!process.env.TAVILY_API_KEY,
    statusDetail: () =>
      process.env.TAVILY_API_KEY ? "Configured" : "Public web search provider is not configured.",
  }),
}));
vi.mock("@/lib/discovery/registry", () => ({
  getDiscoveryProvider: () => ({ isConfigured: () => !!process.env.GOOGLE_PLACES_API_KEY }),
}));
vi.mock("@/lib/ai/registry", () => ({
  getAIProvider: () => ({ isConfigured: () => !!process.env.GEMINI_API_KEY }),
}));

const { GET } = await import("../app/api/system/health/route");

function req() {
  return {
    req: { nextUrl: { searchParams: new URLSearchParams() }, headers: new Headers() } as any,
    params: { params: Promise.resolve({}) },
  };
}

describe("GET /api/system/health", () => {
  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
    fake.planActive = true;
  });
  afterEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
  });

  it("reports NOT_CONFIGURED honestly when nothing is set", async () => {
    const { req: r, params } = req();
    const res = await GET(r, params);
    const body = await res.json();
    expect(body.tavily).toBe("NOT_CONFIGURED");
    expect(body.googlePlaces).toBe("NOT_CONFIGURED");
    expect(body.aiProvider).toBe("NOT_CONFIGURED");
    expect(body.database).toBe("CONNECTED");
    expect(body.automation).toBe("ACTIVE");
    expect(JSON.stringify(body)).not.toContain("tvly");
  });

  it("reports CONFIGURED when keys exist — values never leak", async () => {
    process.env.TAVILY_API_KEY = "tvly-secret-value";
    process.env.GOOGLE_PLACES_API_KEY = "gplaces-secret";
    process.env.GEMINI_API_KEY = "gemini-secret";
    const { req: r, params } = req();
    const res = await GET(r, params);
    const body = await res.json();
    expect(body.tavily).toBe("CONFIGURED");
    expect(body.googlePlaces).toBe("CONFIGURED");
    expect(body.aiProvider).toBe("CONFIGURED");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("tvly-secret-value");
    expect(raw).not.toContain("gplaces-secret");
    expect(raw).not.toContain("gemini-secret");
  });

  it("kill switch flips automation to PAUSED", async () => {
    process.env.WDD_AUTOMATION_KILL_SWITCH = "true";
    const { req: r, params } = req();
    const res = await GET(r, params);
    const body = await res.json();
    expect(body.automation).toBe("PAUSED");
  });

  it("inactive plan flips automation to PAUSED", async () => {
    fake.planActive = false;
    const { req: r, params } = req();
    const res = await GET(r, params);
    const body = await res.json();
    expect(body.automation).toBe("PAUSED");
  });
});
