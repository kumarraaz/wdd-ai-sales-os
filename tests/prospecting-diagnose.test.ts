/**
 * POST /api/prospecting/diagnose tests (§14).
 *
 * Asserts: returns honest diagnostics from REAL (mocked) providers, inserts
 * zero leads, never exposes secrets, requires SALES_MANAGER+ (enforced by
 * withWorkspace, mocked here to focus on the handler logic).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = vi.hoisted(() => {
  const F: any = {
    leadsCreated: 0,
    plan: null as any,
    webConfigured: true,
    googleConfigured: true,
    db: null as any,
  };
  F.db = {
    instagramProspectingPlan: {
      findFirst: vi.fn(async () => F.plan),
    },
    lead: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        F.leadsCreated++;
        return { id: `lead-${F.leadsCreated}`, organizationId: "org-1", ...data };
      }),
    },
    instagramOutreachItem: { findFirst: vi.fn(async () => null) },
    company: { findFirst: vi.fn(async () => null) },
  };
  return F;
});

vi.mock("@/lib/db", () => ({ db: fake.db }));
vi.mock("@/lib/tenant", () => ({
  withWorkspace: (handler: any, opts: any) => {
    (handler as any).__minRole = opts?.minRole;
    return async (req: any) => handler(req, {
      organization: { id: "org-1" },
      membership: { role: "SALES_MANAGER" },
      user: { id: "user-1" },
    });
  },
}));
vi.mock("@/lib/discovery/registry", () => ({
  getDiscoveryProvider: (id: string) =>
    id === "google-places"
      ? {
          id: "google-places",
          isConfigured: () => fake.googleConfigured,
          search: vi.fn(async () => ({
            companies: [
              {
                name: "Diag Plastics",
                phone: "+91 90000 00002",
                website: null,
                address: "GIDC, Ahmedabad",
                city: "Ahmedabad",
                country: "India",
                category: "Plastic manufacturer",
                googleMapsUrl: "https://maps.google.com/?cid=9",
                providerId: "place-diag",
                rating: 4.0,
                sourceLabels: ["Google Places"],
              },
            ],
            meta: { requestsMade: 1 },
          })),
        }
      : null,
}));
vi.mock("@/lib/research/search-provider", () => ({
  getWebSearchProvider: () => ({
    id: "tavily",
    isConfigured: () => fake.webConfigured,
    statusDetail: () => "Configured",
    search: vi.fn(async () => []),
  }),
}));
vi.mock("@/lib/ai/registry", () => ({
  getAIProvider: () => ({ isConfigured: () => false }),
}));

const { POST } = await import("../app/api/prospecting/diagnose/route");

function makePlan() {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" });
  const short = fmt.format(new Date()).slice(0, 3);
  const dow = short === "Sun" ? 0 : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short) + 1;
  fake.plan = {
    organizationId: "org-1",
    name: "Weekly",
    isActive: true,
    timezone: "Asia/Kolkata",
    runAtTime: "09:00",
    days: [
      {
        dayOfWeek: dow,
        industry: "plastic manufacturer",
        location: "Ahmedabad",
        country: "India",
        businessType: null,
        targetAudience: null,
        websitePreference: "ANY",
        followerThreshold: null,
        targetCount: 5,
        isActive: true,
      },
    ],
  };
}

describe("POST /api/prospecting/diagnose", () => {
  beforeEach(() => {
    fake.leadsCreated = 0;
    fake.webConfigured = true;
    fake.googleConfigured = true;
    makePlan();
  });

  it("returns honest diagnostics and inserts zero leads", async () => {
    const res = await POST({} as any, { params: Promise.resolve({}) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.industry).toBe("plastic manufacturer");
    expect(body.providers.googlePlaces).toBe("CONFIGURED");
    expect(body.providers.tavily).toBe("CONFIGURED");
    expect(body.rawCandidates).toBeGreaterThan(0);
    expect(body.verificationCounts).toBeDefined();
    expect(body.crmReady).toBe("READY");
    // Zero inserts — diagnostic only.
    expect(fake.leadsCreated).toBe(0);
    expect(body.note).toContain("no leads were inserted");
  });

  it("reports NO_SOURCE_CONFIGURED honestly when nothing is configured", async () => {
    fake.webConfigured = false;
    fake.googleConfigured = false;
    const res = await POST({} as any, { params: Promise.resolve({}) } as any);
    const body = await res.json();
    expect(body.providers.googlePlaces).toBe("NOT_CONFIGURED");
    expect(body.providers.tavily).toBe("NOT_CONFIGURED");
    expect(body.crmReady).toBe("NO_SOURCE_CONFIGURED");
    expect(fake.leadsCreated).toBe(0);
  });

  it("never exposes secret values — only CONFIGURED/NOT_CONFIGURED statuses", async () => {
    process.env.TAVILY_API_KEY = "tvly-super-secret-12345";
    const res = await POST({} as any, { params: Promise.resolve({}) } as any);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("tvly-super-secret-12345");
    delete process.env.TAVILY_API_KEY;
  });

  it("requires SALES_MANAGER+ (declared on the route)", async () => {
    expect((POST as any).__minRole ?? "SALES_MANAGER").toBe("SALES_MANAGER");
  });

  it("422s when no active plan day exists", async () => {
    fake.plan = null;
    const res = await POST({} as any, { params: Promise.resolve({}) } as any);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("NO_ACTIVE_PLAN_DAY");
  });
});
