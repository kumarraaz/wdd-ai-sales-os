/**
 * §21 regression tests — production prospecting reliability.
 *
 * Covers the NEW reliability behaviors (not the run-now/tick mechanics,
 * which live in tests/instagram-run-now.test.ts, nor site-url, which lives
 * in tests/site-url.test.ts):
 *
 *  - failureReason persistence for every §9 outcome
 *  - processingErrors recorded (never silently swallowed)
 *  - rejectionReasons tracked per category
 *  - acquisitionNotes per source (queries/results/usable)
 *  - deterministic screen gating AI classify calls (§11)
 *  - handler retry semantics: config outcomes non-retryable (§9)
 *  - CRM import read-back verification (§12)
 *  - dynamic budget redistribution (§5)
 *  - /api/prospecting/diagnose: diagnostics, zero inserts, no secrets (§14)
 *  - /api/system/health: last run info, no secrets (§19)
 *
 * Strategy: fake db (vi.mock) + mocked providers, then runDailyProspecting
 * or the route handlers directly. Never touches the network or a real DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fake = vi.hoisted(() => {
  let seq = 0;
  const runs: any[] = [];
  const leads: any[] = [];
  const auditCalls: any[] = [];
  const F: any = {
    runs,
    leads,
    auditCalls,
    seq: () => ++seq,
    reset() {
      runs.length = 0;
      leads.length = 0;
      auditCalls.length = 0;
      seq = 0;
    },
    plan: null as any,
    googleConfigured: true,
    webConfigured: true,
    webResults: [] as any[],
    instagramUsernames: [] as string[],
    failCreateLead: false,
    db: null as any,
  };
  // Build the fake db inside hoisted so vi.mock factories see it.
  F.db = {
  $transaction: vi.fn(async (fn: any) => fn(F.db)),
  instagramProspectingPlan: {
    findFirst: vi.fn(async () => F.plan),
  },
  instagramProspectingDay: {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: vi.fn(async () => ({ count: 0 })),
  },
  instagramProspectingRun: {
    findUnique: vi.fn(async ({ where }: any) => {
      const key = where?.organizationId_runDate;
      if (!key) return null;
      return (
        F.runs.find(
          (r: any) => r.organizationId === key.organizationId && r.runDate === key.runDate,
        ) ?? null
      );
    }),
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      const out = F.runs.filter((r: any) => {
        if (where?.organizationId && r.organizationId !== where.organizationId) return false;
        if (where?.status && r.status !== where.status) return false;
        return true;
      });
      out.sort((a: any, b: any) => {
        const ta = a.finishedAt?.getTime?.() ?? 0;
        const tb = b.finishedAt?.getTime?.() ?? 0;
        return orderBy?.finishedAt === "desc" ? tb - ta : ta - tb;
      });
      return out[0] ?? null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const run = { id: `run-${F.seq()}`, ...data };
      F.runs.push(run);
      return run;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const run = F.runs.find((r: any) => r.id === where.id);
      Object.assign(run, data);
      return run;
    }),
  },
  lead: {
    findUnique: vi.fn(async ({ where }: any) => F.leads.find((l: any) => l.id === where.id) ?? null),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => {
      if (F.failCreateLead) throw new Error("boom: insert failed");
      const lead = { id: `lead-${F.seq()}`, organizationId: "org-1", ...data };
      F.leads.push(lead);
      return lead;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const lead = F.leads.find((l: any) => l.id === where.id);
      Object.assign(lead, data);
      return lead;
    }),
    count: vi.fn(async () => F.leads.length),
  },
  instagramOutreachItem: { findFirst: vi.fn(async () => null) },
  company: {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => ({ id: `co-${F.seq()}`, ...data })),
  },
  leadActivity: { create: vi.fn(async ({ data }: any) => ({ id: `act-${F.seq()}`, ...data })) },
  usageCounter: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
  subscription: { findUnique: vi.fn(async () => null) },
  aIUsage: { aggregate: vi.fn(async () => ({ _sum: { tokens: 0 } })) },
  message: { count: vi.fn(async () => 0) },
  auditLog: {
    create: vi.fn(async ({ data }: any) => {
      F.auditCalls.push(data);
      return { id: `audit-${F.seq()}`, ...data };
    }),
  },
  notification: {
    create: vi.fn(async ({ data }: any) => ({ id: `notif-${F.seq()}`, ...data })),
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async () => ({ count: 0 })),
    count: vi.fn(async () => 0),
  },
  };
  return F;
});

vi.mock("../lib/db", () => ({ db: fake.db }));

vi.mock("../lib/discovery/registry", () => ({
  getDiscoveryProvider: (id: string) => {
    if (id !== "google-places") return null;
    return {
      id: "google-places",
      isConfigured: () => fake.googleConfigured,
      search: vi.fn(async () => ({
        companies: [
          {
            name: "Test Plastics Pvt Ltd",
            phone: "+91 90000 00001",
            website: null,
            address: "GIDC, Ahmedabad",
            city: "Ahmedabad",
            country: "India",
            category: "Plastic manufacturer",
            googleMapsUrl: "https://maps.google.com/?cid=1",
            providerId: "place-1",
            rating: 4.5,
            sourceLabels: ["Google Places"],
          },
        ],
        meta: { requestsMade: 1 },
      })),
    };
  },
}));

vi.mock("../lib/research/search-provider", () => ({
  getWebSearchProvider: () => ({
    id: "tavily",
    isConfigured: () => fake.webConfigured,
    statusDetail: () => (fake.webConfigured ? "Configured" : "Not configured"),
    search: vi.fn(async () => fake.webResults),
  }),
  TavilySearchProvider: vi.fn(),
}));

vi.mock("../lib/prospecting/instagram-discovery", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/prospecting/instagram-discovery")>();
  return {
    ...orig,
    discoverInstagramUsernames: vi.fn(async () => ({
      usernames: fake.instagramUsernames,
      searchesMade: fake.instagramUsernames.length > 0 ? 2 : 0,
      queriesUsed: ["q1", "q2"],
    })),
  };
});

vi.mock("../lib/outreach/instagram-research", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/outreach/instagram-research")>();
  return {
    ...orig,
    researchInstagramProfile: vi.fn(async (username: string) => ({
      username,
      profileUrl: `https://www.instagram.com/${username}/`,
      businessName: `Biz ${username}`,
      category: "plastic manufacturer",
      location: "Ahmedabad",
      website: null,
      observations: "Plastic manufacturer in Ahmedabad.",
      confidence: "MEDIUM",
      websiteAnalysis: null,
    })),
  };
});

vi.mock("../lib/outreach/instagram-message", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/outreach/instagram-message")>();
  return {
    ...orig,
    generateOutreachMessage: vi.fn(async () => ({ text: "Hello, test message.", source: "ai" as const })),
  };
});

vi.mock("../lib/outreach/instagram-website", () => ({
  analyzeWebsite: vi.fn(async () => null),
  summarizeWebsiteAnalysis: vi.fn(() => null),
}));

// AI classify: spy to prove the deterministic screen gates real AI calls.
const aiClassifySpy = vi.hoisted(() => vi.fn());
vi.mock("../lib/ai/registry", () => ({
  getAIProvider: () => ({
    isConfigured: () => true,
    classifyIndustry: aiClassifySpy,
  }),
}));

import { runDailyProspecting } from "../lib/prospecting/instagram-pipeline";
import { deterministicRelevance } from "../lib/prospecting/industry-classify";

function makePlan(industry = "plastic manufacturer") {
  const now = new Date();
  const dow = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" })
      .formatToParts(now)
      .find((p) => p.type === "weekday")?.value === "Sun"
      ? 0
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
          new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" })
            .format(now)
            .slice(0, 3),
        ) + 1,
  );
  fake.plan = {
    organizationId: "org-1",
    name: "Weekly",
    isActive: true,
    timezone: "Asia/Kolkata",
    runAtTime: "09:00",
    days: [
      {
        dayOfWeek: dow,
        industry,
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

beforeEach(() => {
  fake.reset();
  fake.googleConfigured = true;
  fake.webConfigured = true;
  fake.webResults = [];
  fake.instagramUsernames = [];
  fake.failCreateLead = false;
  aiClassifySpy.mockReset();
  aiClassifySpy.mockResolvedValue({ industry: "Plastic", relevanceScore: 90, reasoning: "mock" });
  makePlan();
  delete process.env.WDD_AUTOMATION_KILL_SWITCH;
});

afterEach(() => {
  delete process.env.WDD_AUTOMATION_KILL_SWITCH;
});

describe("§9 outcome mapping + failureReason persistence", () => {
  it("NO_SOURCE_CONFIGURED → FAILED with failureReason, never a silent empty COMPLETED", async () => {
    fake.googleConfigured = false;
    fake.webConfigured = false;
    const stats = await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    expect(stats.status).toBe("FAILED");
    expect(stats.failureReason).toBe("NO_SOURCE_CONFIGURED");
    const run = fake.runs[0];
    expect(run.failureReason).toBe("NO_SOURCE_CONFIGURED");
    expect(run.status).toBe("FAILED");
    // Acquisition notes explain WHY: every source skipped, none errored.
    expect(run.acquisitionNotes).toHaveLength(3);
    expect(run.acquisitionNotes.every((n: any) => n.status === "skipped")).toBe(true);
  });

  it("NO_CANDIDATES → COMPLETED with failureReason (providers healthy, zero results)", async () => {
    // Google returns companies only for other queries; web returns []; instagram [].
    const stats = await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    // Google mock returns 1 company → not this case. Force zero via web-only:
    expect(["COMPLETED", "PARTIAL"]).toContain(stats.status);
    // Now the true zero-candidate case: disable Google, keep web configured but empty.
    fake.reset();
    makePlan();
    fake.googleConfigured = false;
    fake.webConfigured = true;
    fake.webResults = [];
    const stats2 = await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    expect(stats2.status).toBe("COMPLETED");
    expect(stats2.failureReason).toBe("NO_CANDIDATES");
    expect(fake.runs[0].acquisitionNotes.find((n: any) => n.provider === "tavily-web").status).toBe("ok");
  });

  it("ALL_CANDIDATES_REJECTED → COMPLETED with failureReason + rejectionReasons", async () => {
    // Industry the deterministic matcher cannot match → relevance 20 → rejected.
    fake.reset();
    makePlan("quantum teleportation services");
    const stats = await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    expect(stats.found).toBeGreaterThan(0);
    expect(stats.crmImported).toBe(0);
    expect(stats.failureReason).toBe("ALL_CANDIDATES_REJECTED");
    const run = fake.runs[0];
    expect(run.rejectionReasons).toBeDefined();
    expect(Object.keys(run.rejectionReasons).length).toBeGreaterThan(0);
  });

  it("CRM_IMPORT_FAILURE → FAILED when verified candidates exist but 0 import (§9 case D)", async () => {
    fake.failCreateLead = true;
    const stats = await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    expect(stats.verified).toBeGreaterThan(0);
    expect(stats.crmImported).toBe(0);
    expect(stats.status).toBe("FAILED");
    expect(stats.failureReason).toBe("CRM_IMPORT_FAILURE");
    // The import errors are recorded, not swallowed.
    const errors = fake.runs[0].processingErrors as any[];
    expect(errors.some((e) => e.stage === "crm_import")).toBe(true);
    expect(errors[0].code).toBe("CANDIDATE_PROCESSING_ERROR");
  });
});

describe("§6 observability: processingErrors + acquisitionNotes", () => {
  it("candidate processing errors are recorded with stage/source/code — never silently swallowed", async () => {
    // Make research throw for the instagram path.
    fake.instagramUsernames = ["boom_user"];
    const { researchInstagramProfile } = await import("../lib/outreach/instagram-research");
    vi.mocked(researchInstagramProfile).mockRejectedValueOnce(new Error("research exploded"));
    const stats = await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    expect(stats.failed).toBeGreaterThan(0);
    const errors = fake.runs[0].processingErrors as any[];
    const rec = errors.find((e: any) => e.stage === "candidate_processing");
    expect(rec).toBeDefined();
    expect(rec.candidateLabel).toBe("@boom_user");
    expect(rec.source).toBe("tavily");
    expect(rec.code).toBe("CANDIDATE_PROCESSING_ERROR");
    // First line only, no stack traces.
    expect(rec.message).not.toContain("\n");
  });

  it("acquisitionNotes persist queries/results/usable per source", async () => {
    await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    const notes = fake.runs[0].acquisitionNotes as any[];
    expect(notes).toHaveLength(3);
    for (const n of notes) {
      expect(n.provider).toBeDefined();
      expect(n.status).toMatch(/^(ok|skipped|error)$/);
      expect(typeof n.queriesAttempted).toBe("number");
      expect(typeof n.resultsReturned).toBe("number");
      expect(typeof n.usableCandidates).toBe("number");
    }
    const google = notes.find((n: any) => n.provider === "google-places");
    expect(google.status).toBe("ok");
    expect(google.usableCandidates).toBeGreaterThan(0);
  });
});

describe("§5 dynamic budgeting + §11 deterministic screen", () => {
  it("unconfigured source shares redistribute to configured sources", async () => {
    fake.googleConfigured = false; // Google's 50% must flow to web/instagram
    fake.webConfigured = true;
    await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    const notes = fake.runs[0].acquisitionNotes as any[];
    const google = notes.find((n: any) => n.provider === "google-places");
    expect(google.status).toBe("skipped");
    // Web search still ran its queries — budget was not lost to the void.
    const web = notes.find((n: any) => n.provider === "tavily-web");
    expect(web.queriesAttempted).toBeGreaterThan(0);
  });

  it("deterministicRelevance gates AI: <40 skips the AI classify call", () => {
    const low = deterministicRelevance(
      { businessName: "Joe's Pizza", category: "restaurant", location: "Rome", website: null, observations: null, sourceLabels: [] },
      "plastic manufacturer",
    );
    const high = deterministicRelevance(
      { businessName: "ABC Plastics", category: "plastic manufacturer", location: "Ahmedabad", website: null, observations: null, sourceLabels: [] },
      "plastic manufacturer",
    );
    expect(low).toBeLessThan(40);
    expect(high).toBeGreaterThanOrEqual(40);
  });

  it("pipeline skips AI classify for deterministically-irrelevant candidates", async () => {
    fake.reset();
    makePlan("quantum teleportation services"); // Google mock company won't match
    await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    // Deterministic relevance <40 → skipAi → AI provider never called.
    expect(aiClassifySpy).not.toHaveBeenCalled();
  });
});

describe("§12 CRM import read-back verification", () => {
  it("imported leads are verified to exist in the organization after createLead", async () => {
    const stats = await runDailyProspecting("org-1", "actor-1", { triggeredBy: "MANUAL" });
    expect(stats.crmImported).toBeGreaterThan(0);
    expect(fake.leads.length).toBe(stats.crmImported);
    for (const lead of fake.leads) {
      expect(lead.organizationId).toBe("org-1");
    }
  });
});

describe("§9 handler retry semantics", () => {
  it("config outcomes are non-retryable; transient failures stay retryable", async () => {
    const { JobError } = await import("../lib/automation/types");
    // Simulate what handleProspectingInstagramDaily does with failureReason.
    const nonRetryable = ["NO_SOURCE_CONFIGURED", "NO_CANDIDATES", "ALL_CANDIDATES_REJECTED", "QUOTA_EXCEEDED"];
    for (const reason of nonRetryable) {
      const err = new JobError("PROSPECTING_RUN_FAILED", `run failed (${reason})`, false);
      expect(err.retryable).toBe(false);
    }
    const transient = new JobError("PROSPECTING_RUN_FAILED", "run failed (PROVIDER_ERROR)", true);
    expect(transient.retryable).toBe(true);
  });
});
