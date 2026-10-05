/**
 * Multi-source agent pipeline tests.
 *
 * The full daily run against fakes: Google Places contributes verified
 * business candidates, the entity matcher merges duplicates across sources,
 * the verification gate admits only HIGH / acceptable-MEDIUM, and a run
 * completion notification is created.
 *
 * Never touches the network or a real DB (vi.mock on db, registry, web
 * search, and website analysis).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Fake DB ────────────────────────────────────────────────────────────
const fake = vi.hoisted(() => {
  const leads: any[] = [];
  const notifications: any[] = [];
  const runs: any[] = [];
  const auditCalls: any[] = [];
  const activities: any[] = [];
  let seq = 0;
  return {
    leads,
    notifications,
    runs,
    auditCalls,
    activities,
    reset() {
      leads.length = 0;
      notifications.length = 0;
      runs.length = 0;
      auditCalls.length = 0;
      activities.length = 0;
      seq = 0;
    },
    db: {
      instagramProspectingPlan: {
        findFirst: vi.fn(async ({ where }: any) => {
          const today = new Date().toLocaleString("en-US", {
            timeZone: "Asia/Kolkata",
            weekday: "short",
          });
          const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(today);
          if (where?.organizationId !== "org-1") return null;
          return {
            id: "plan-1",
            organizationId: "org-1",
            isActive: true,
            timezone: "Asia/Kolkata",
            runAtTime: "09:00",
            days: [
              {
                dayOfWeek: dow,
                industry: "manufacturers",
                location: "Ahmedabad",
                country: "India",
                businessType: null,
                targetAudience: null,
                websitePreference: "ANY",
                followerThreshold: null,
                targetCount: 2,
                isActive: true,
              },
            ],
          };
        }),
      },
      instagramProspectingDay: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
      instagramProspectingRun: {
        findUnique: vi.fn(async ({ where }: any) => {
          const key = where?.organizationId_runDate;
          if (!key) return null;
          return (
            runs.find((r) => r.organizationId === key.organizationId && r.runDate === key.runDate) ??
            null
          );
        }),
        create: vi.fn(async ({ data }: any) => {
          const run = { id: `run-${++seq}`, ...data };
          runs.push(run);
          return run;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const run = runs.find((r) => r.id === where.id);
          Object.assign(run, data);
          return run;
        }),
      },
      lead: {
        findFirst: vi.fn(async ({ where }: any) => {
          const org = where?.organizationId;
          const ors: any[] = where?.OR ?? [];
          if (org !== "org-1") return null;
          return (
            leads.find((l) => {
              if (ors.length === 0) return true;
              return ors.some((cond: any) => {
                if (cond.domain !== undefined) return l.domain === cond.domain;
                if (cond.phone?.contains) return (l.phone ?? "").includes(cond.phone.contains);
                if (cond.email?.equals)
                  return (l.email ?? "").toLowerCase() === cond.email.equals.toLowerCase();
                return false;
              });
            }) ?? null
          );
        }),
        create: vi.fn(async ({ data }: any) => {
          const lead = { id: `lead-${++seq}`, organizationId: "org-1", ...data };
          leads.push(lead);
          return lead;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const lead = leads.find((l) => l.id === where.id);
          Object.assign(lead, data);
          return lead;
        }),
        count: vi.fn(async () => leads.length),
      },
      instagramOutreachItem: { findFirst: vi.fn(async () => null) },
      company: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => ({ id: `co-${++seq}`, ...data })),
      },
      leadActivity: {
        create: vi.fn(async ({ data }: any) => {
          activities.push(data);
          return { id: `act-${++seq}`, ...data };
        }),
      },
      usageCounter: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({})),
      },
      subscription: { findUnique: vi.fn(async () => null) },
      aIUsage: { aggregate: vi.fn(async () => ({ _sum: { tokens: 0 } })) },
      message: { count: vi.fn(async () => 0) },
      auditLog: {
        create: vi.fn(async ({ data }: any) => {
          auditCalls.push(data);
          return { id: `audit-${++seq}`, ...data };
        }),
      },
      notification: {
        create: vi.fn(async ({ data }: any) => {
          const n = { id: `notif-${++seq}`, ...data };
          notifications.push(n);
          return n;
        }),
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
        count: vi.fn(async () => notifications.length),
      },
    },
  };
});

// ── Google Places fake: two manufacturers in Ahmedabad ──────────────────
const googleCompanies = [
  {
    name: "ABC Plastics Pvt Ltd",
    phone: "+91 98765 43210",
    website: "https://abcplastics.com",
    address: "GIDC Industrial Estate, Ahmedabad, Gujarat",
    city: "Ahmedabad",
    country: "India",
    category: "Plastic manufacturer",
    googleMapsUrl: "https://maps.google.com/?cid=1",
    providerId: "place-abc",
    rating: 4.5,
    sourceLabels: ["Google Places"],
  },
  {
    name: "Sharma Engineering Works",
    phone: "+91 91234 56780",
    website: null,
    address: "Naroda, Ahmedabad, Gujarat",
    city: "Ahmedabad",
    country: "India",
    category: "Industrial equipment manufacturer",
    googleMapsUrl: "https://maps.google.com/?cid=2",
    providerId: "place-sharma",
    rating: 4.2,
    sourceLabels: ["Google Places"],
  },
];

const googleSearchSpy = vi.hoisted(() => vi.fn(async () => ({ companies: googleCompanies })));

vi.mock("../lib/discovery/registry", () => ({
  getDiscoveryProvider: vi.fn(() => ({
    id: "google-places",
    isConfigured: () => true,
    search: googleSearchSpy,
  })),
  listDiscoveryProviders: vi.fn(() => []),
}));

// ── Web search returns nothing (isolates the Google source) ─────────────
vi.mock("../lib/research/search-provider", () => ({
  getWebSearchProvider: vi.fn(() => ({
    isConfigured: () => true,
    search: vi.fn(async () => []),
  })),
  TavilySearchProvider: vi.fn(),
}));

// ── Website analysis skipped (treated as unreachable) ───────────────────
vi.mock("../lib/outreach/instagram-website", () => ({
  analyzeWebsite: vi.fn(async () => null),
  summarizeWebsiteAnalysis: vi.fn(() => null),
}));

vi.mock("../lib/db", () => ({ db: fake.db }));

const { runDailyProspecting } = await import("../lib/prospecting/instagram-pipeline");

describe("multi-source agent pipeline", () => {
  beforeEach(() => {
    fake.reset();
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
  });
  afterEach(() => {
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  it("imports Google-sourced verified businesses with full provenance", async () => {
    const stats = await runDailyProspecting("org-1", "actor-1", {
      triggeredBy: "MANUAL",
      now: new Date(),
    });

    expect(stats.status).toBe("COMPLETED");
    expect(stats.crmImported).toBe(2);
    expect(stats.verified).toBe(2);
    expect(stats.sourceBreakdown["GOOGLE_BUSINESS"]).toBe(2);

    // Imported lead: real name, verification provenance, relevant status.
    const abc = fake.leads.find((l) => l.fullName === "ABC Plastics Pvt Ltd");
    expect(abc).toBeDefined();
    // MEDIUM confidence → NEW status (only HIGH becomes VERIFIED)
    expect(abc.status).toBe("NEW");
    expect(abc.verificationConfidence).toBe("MEDIUM");
    expect(abc.verificationReason).toBeTruthy();
    expect(abc.verificationSources).toBeTruthy();
    expect(abc.industryRelevance).toBeGreaterThanOrEqual(60);
    expect(abc.mergedSourceTypes).toContain("GOOGLE_BUSINESS");
    expect(abc.aiMessage).toBeTruthy();
    expect(abc.aiMessage.length).toBeLessThanOrEqual(100 * 6); // 1-2 short paragraphs

    // The no-website business also imported (websitePreference = ANY).
    const sharma = fake.leads.find((l) => l.fullName === "Sharma Engineering Works");
    expect(sharma).toBeDefined();
    expect(sharma.website).toBeNull();
  });

  it("best-first selection caps imports at the day's target count", async () => {
    const stats = await runDailyProspecting("org-1", "actor-1", {
      triggeredBy: "MANUAL",
      now: new Date(),
    });
    expect(stats.targetCount).toBe(2);
    expect(stats.crmImported).toBeLessThanOrEqual(2);
  });

  it("creates a run-completion notification", async () => {
    await runDailyProspecting("org-1", "actor-1", {
      triggeredBy: "MANUAL",
      now: new Date(),
    });
    const n = fake.notifications.find((x) => x.type === "prospecting_run_completed");
    expect(n).toBeDefined();
    expect(n.title).toContain("verified");
  });

  it("second run the same day is idempotent (no double import)", async () => {
    await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL", now: new Date() });
    const first = fake.leads.length;
    const stats = await runDailyProspecting("org-1", "actor-1", {
      triggeredBy: "MANUAL",
      now: new Date(),
    });
    expect(stats.status).toBe("COMPLETED");
    expect(fake.leads.length).toBe(first);
  });

  it("PARTIAL: Google provider failure is honest, never faked", async () => {
    googleSearchSpy.mockRejectedValueOnce(new Error("Places API down"));
    const stats = await runDailyProspecting("org-1", "actor-1", {
      triggeredBy: "MANUAL",
      now: new Date(),
    });
    // Web search contributed nothing; Google failed → no candidates at all
    // → FAILED with an honest reason (empty pool is never invented).
    expect(["FAILED", "PARTIAL"]).toContain(stats.status);
    expect(stats.crmImported).toBe(0);
  });

  it("kill switch blocks the run before any discovery", async () => {
    process.env.WDD_AUTOMATION_KILL_SWITCH = "true";
    await expect(
      runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL", now: new Date() }),
    ).rejects.toThrow("KILL_SWITCH_ACTIVE");
    expect(fake.leads).toHaveLength(0);
  });
});
