/**
 * Instagram prospecting tests — 7-day plan, daily 9 AM schedule, discovery,
 * global dedup, pipeline, CRM fields, remarks, kill switch.
 *
 * Pure logic is tested directly; DB-touching code runs against a fake db
 * (vi.mock) so these tests never need DATABASE_URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Fake DB ────────────────────────────────────────────────────────────
const fake = vi.hoisted(() => {
  const leads: any[] = [];
  const outreachItems: any[] = [];
  const runs: any[] = [];
  const auditCalls: any[] = [];
  const activities: any[] = [];
  let seq = 0;
  return {
    leads,
    outreachItems,
    runs,
    auditCalls,
    activities,
    reset() {
      leads.length = 0;
      outreachItems.length = 0;
      runs.length = 0;
      auditCalls.length = 0;
      activities.length = 0;
      seq = 0;
    },
    db: {
      instagramProspectingPlan: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where?.id) return fake.plan ?? null;
          return fake.plan ?? null;
        }),
      },
      instagramProspectingDay: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
      instagramProspectingRun: {
        findUnique: vi.fn(async ({ where }: any) => {
          const key = where?.organizationId_runDate;
          if (!key) return null;
          return runs.find((r) => r.organizationId === key.organizationId && r.runDate === key.runDate) ?? null;
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
          return (
            leads.find((l) => {
              if (l.organizationId !== org) return false;
              if (ors.length === 0) return true;
              return ors.some((cond: any) => {
                if (cond.instagramUsername !== undefined) return l.instagramUsername === cond.instagramUsername;
                if (cond.instagramUrl?.contains)
                  return (l.instagramUrl ?? "").toLowerCase().includes(cond.instagramUrl.contains.toLowerCase());
                if (cond.domain !== undefined) return l.domain === cond.domain;
                if (cond.email?.equals)
                  return (l.email ?? "").toLowerCase() === cond.email.equals.toLowerCase();
                if (cond.phone?.contains) return (l.phone ?? "").includes(cond.phone.contains);
                return false;
              });
            }) ?? null
          );
        }),
        create: vi.fn(async ({ data }: any) => {
          // Simulate a CRM import failure for exactly one prospect to prove
          // per-item failure isolation: the run continues for the rest.
          if (data.instagramUsername === "broken_handle") throw new Error("db boom");
          const lead = { id: `lead-${++seq}`, organizationId: "org-1", domain: null, ...data };
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
      instagramOutreachItem: {
        findFirst: vi.fn(async ({ where }: any) =>
          outreachItems.find(
            (i) => i.organizationId === where.organizationId && i.username === where.username,
          ) ?? null,
        ),
      },
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
      auditLog: {
        create: vi.fn(async ({ data }: any) => {
          auditCalls.push(data);
          return { id: `audit-${++seq}`, ...data };
        }),
      },
    },
    plan: null as any,
  };
});

vi.mock("../lib/db", () => ({ db: fake.db }));

import {
  usernameFromInstagramUrl,
  buildDiscoveryQueries,
  discoverInstagramUsernames,
} from "../lib/prospecting/instagram-discovery";
import {
  runDateInTimezone,
  dayOfWeekInTimezone,
} from "../lib/prospecting/instagram-plan";
import {
  findExistingInstagramProspect,
  runDailyProspecting,
} from "../lib/prospecting/instagram-pipeline";
import { isAtTimeTriggerDue } from "../lib/automation/scheduler";
import {
  prospectingPlanSchema,
  remarkSchema,
  instagramConnectionStatusSchema,
  createLeadSchema,
} from "../lib/validators";

// ── URL → username ─────────────────────────────────────────────────────
describe("usernameFromInstagramUrl", () => {
  it("extracts a profile username", () => {
    expect(usernameFromInstagramUrl("https://www.instagram.com/jaipur_jewels/")).toBe("jaipur_jewels");
    expect(usernameFromInstagramUrl("https://instagram.com/ABC.Store")).toBe("abc.store");
  });
  it("rejects posts, reels, explore and reserved paths", () => {
    expect(usernameFromInstagramUrl("https://www.instagram.com/p/C123abc/")).toBeNull();
    expect(usernameFromInstagramUrl("https://www.instagram.com/reel/C123abc/")).toBeNull();
    expect(usernameFromInstagramUrl("https://www.instagram.com/explore/")).toBeNull();
    expect(usernameFromInstagramUrl("https://www.instagram.com/accounts/login/")).toBeNull();
    expect(usernameFromInstagramUrl("https://www.instagram.com/stories/")).toBeNull();
  });
  it("rejects non-instagram and invalid URLs", () => {
    expect(usernameFromInstagramUrl("https://example.com/jaipur_jewels")).toBeNull();
    expect(usernameFromInstagramUrl("not a url")).toBeNull();
  });
});

// ── Query building ─────────────────────────────────────────────────────
describe("buildDiscoveryQueries", () => {
  it("builds industry-first queries with location and site: variants", () => {
    const qs = buildDiscoveryQueries({
      industry: "jewellery",
      location: "Mumbai",
      country: "India",
      businessType: "manufacturer",
      targetAudience: null,
      websitePreference: "ANY",
      targetCount: 75,
    });
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs[0]).toContain("site:instagram.com");
    expect(qs[0]).toContain("jewellery");
    expect(new Set(qs).size).toBe(qs.length); // deduped
  });
  it("works without location", () => {
    const qs = buildDiscoveryQueries({
      industry: "salon",
      location: null,
      country: null,
      businessType: null,
      targetAudience: null,
      websitePreference: "ANY",
      targetCount: 75,
    });
    expect(qs.every((q) => q.includes("salon"))).toBe(true);
  });
});

// ── Discovery orchestration ────────────────────────────────────────────
describe("discoverInstagramUsernames", () => {
  const target = {
    industry: "jewellery",
    location: "Mumbai",
    country: "India",
    businessType: null,
    targetAudience: null,
    websitePreference: "ANY",
    targetCount: 75,
  };

  it("extracts, dedupes, and industry-filters usernames", async () => {
    const webSearch = vi.fn(async () => [
      { title: "Jaipur Jewels — handcrafted jewellery Mumbai", url: "https://www.instagram.com/jaipur_jewels/", snippet: "Gold and diamond jewellery store in Mumbai. DM to order." },
      { title: "Jaipur Jewels", url: "https://www.instagram.com/jaipur_jewels/", snippet: "duplicate url" },
      { title: "Pizza Place Mumbai", url: "https://www.instagram.com/mumbai_pizza/", snippet: "Best pizza in town" },
      { title: "New reel", url: "https://www.instagram.com/reel/abc123/", snippet: "jewellery reel" },
    ]);
    const result = await discoverInstagramUsernames(target, { webSearch, maxQueries: 2 });
    expect(result.usernames).toEqual(["jaipur_jewels"]); // dup + pizza + reel filtered
    expect(result.searchesMade).toBeGreaterThan(0);
  });

  it("caps results at the day's target count", async () => {
    const webSearch = vi.fn(async () =>
      Array.from({ length: 10 }, (_, i) => ({
        title: `Jewellery store ${i} Mumbai`,
        url: `https://www.instagram.com/jewels_${i}/`,
        snippet: "jewellery Mumbai",
      })),
    );
    const result = await discoverInstagramUsernames({ ...target, targetCount: 5 }, { webSearch, maxQueries: 4 });
    expect(result.usernames.length).toBeLessThanOrEqual(5);
  });

  it("never invents usernames when sources return nothing", async () => {
    const webSearch = vi.fn(async () => []);
    const result = await discoverInstagramUsernames(target, { webSearch, maxQueries: 3 });
    expect(result.usernames).toEqual([]);
    expect(result.searchesMade).toBe(3);
  });

  it("tolerates a failed search query and continues", async () => {
    const webSearch = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([
        { title: "Silver jewellery Mumbai", url: "https://www.instagram.com/silver_house/", snippet: "jewellery Mumbai" },
      ]);
    const result = await discoverInstagramUsernames(target, { webSearch, maxQueries: 3 });
    expect(result.usernames).toEqual(["silver_house"]);
  });
});

// ── Timezone helpers ───────────────────────────────────────────────────
describe("plan timezone helpers", () => {
  it("resolves the IST date and weekday for a known instant", () => {
    // 2026-10-05T03:30:00Z = 09:00 IST on Monday 2026-10-05.
    const now = new Date("2026-10-05T03:30:00Z");
    expect(runDateInTimezone(now, "Asia/Kolkata")).toBe("2026-10-05");
    expect(dayOfWeekInTimezone(now, "Asia/Kolkata")).toBe(1);
  });
  it("rolls the date over at IST midnight", () => {
    // 2026-10-04T18:30:00Z = 2026-10-05 00:00 IST.
    const now = new Date("2026-10-04T18:30:00Z");
    expect(runDateInTimezone(now, "Asia/Kolkata")).toBe("2026-10-05");
  });
});

// ── Wall-clock scheduler ───────────────────────────────────────────────
describe("isAtTimeTriggerDue (daily 9:00 AM)", () => {
  const cfg = { atTime: "09:00", timezone: "Asia/Kolkata" };
  // 08:00 IST on 2026-10-05 (Monday)
  const before = new Date("2026-10-05T02:30:00Z");
  // 10:00 IST on 2026-10-05
  const after = new Date("2026-10-05T04:30:00Z");
  // 10:00 IST on 2026-10-06
  const nextDay = new Date("2026-10-06T04:30:00Z");

  it("does not fire before 09:00", () => {
    expect(isAtTimeTriggerDue(cfg, null, before)).toBe(false);
  });
  it("fires after 09:00 when never fired", () => {
    expect(isAtTimeTriggerDue(cfg, null, after)).toBe(true);
  });
  it("does not fire twice on the same day", () => {
    const lastFire = new Date("2026-10-05T05:00:00Z"); // 10:30 IST
    expect(isAtTimeTriggerDue(cfg, lastFire, after)).toBe(false);
  });
  it("fires the next day after 09:00", () => {
    const lastFire = new Date("2026-10-05T05:00:00Z");
    expect(isAtTimeTriggerDue(cfg, lastFire, nextDay)).toBe(true);
  });
  it("respects daysOfWeek", () => {
    expect(isAtTimeTriggerDue({ ...cfg, daysOfWeek: [2] }, null, after)).toBe(false); // Monday=1
    expect(isAtTimeTriggerDue({ ...cfg, daysOfWeek: [1] }, null, after)).toBe(true);
  });
  it("fails closed on an invalid timezone", () => {
    expect(isAtTimeTriggerDue({ ...cfg, timezone: "Not/AZone" }, null, after)).toBe(false);
  });
});

// ── Validators ────────────────────────────────────────────────────────
describe("prospecting validators", () => {
  it("accepts a valid 7-day plan", () => {
    const parsed = prospectingPlanSchema.safeParse({
      name: "Test",
      runAtTime: "09:00",
      timezone: "Asia/Kolkata",
      days: [{ dayOfWeek: 1, industry: "jewellery", targetCount: 75 }],
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects an invalid weekday, empty industry, and bad time", () => {
    expect(prospectingPlanSchema.safeParse({ days: [{ dayOfWeek: 7, industry: "x" }] }).success).toBe(false);
    expect(prospectingPlanSchema.safeParse({ days: [{ dayOfWeek: 1, industry: "" }] }).success).toBe(false);
    expect(prospectingPlanSchema.safeParse({ runAtTime: "9am" }).success).toBe(false);
  });
  it("remark requires a non-empty body", () => {
    expect(remarkSchema.safeParse({ body: "Spoke with owner." }).success).toBe(true);
    expect(remarkSchema.safeParse({ body: "   " }).success).toBe(false);
  });
  it("connection status is a closed enum defaulting to UNKNOWN", () => {
    expect(instagramConnectionStatusSchema.safeParse("UNKNOWN").success).toBe(true);
    expect(instagramConnectionStatusSchema.safeParse("CONNECTED").success).toBe(true);
    expect(instagramConnectionStatusSchema.safeParse("MAYBE").success).toBe(false);
  });
  it("createLead accepts the Instagram fields", () => {
    const parsed = createLeadSchema.safeParse({
      instagramUsername: "Jaipur_Jewels",
      instagramConnectionStatus: "UNKNOWN",
      aiMessage: "Hello there",
      aiMessageSource: "ai",
      sourceType: "INSTAGRAM",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.instagramUsername).toBe("jaipur_jewels");
  });
});

// ── Global dedup ───────────────────────────────────────────────────────
describe("findExistingInstagramProspect", () => {
  beforeEach(() => {
    fake.reset();
    fake.plan = null;
  });

  it("matches an existing CRM lead by normalized username", async () => {
    fake.leads.push({ id: "l1", organizationId: "org-1", instagramUsername: "jaipur_jewels", instagramUrl: null });
    const hit = await findExistingInstagramProspect("org-1", "jaipur_jewels");
    expect(hit).toEqual({ kind: "lead", id: "l1" });
  });

  it("matches a CRM lead via the profile-URL fallback", async () => {
    fake.leads.push({
      id: "l2",
      organizationId: "org-1",
      instagramUsername: null,
      instagramUrl: "https://www.instagram.com/silver_house/",
    });
    const hit = await findExistingInstagramProspect("org-1", "silver_house");
    expect(hit).toEqual({ kind: "lead", id: "l2" });
  });

  it("matches an existing outreach batch item", async () => {
    fake.outreachItems.push({ id: "i1", organizationId: "org-1", username: "gold_palace" });
    const hit = await findExistingInstagramProspect("org-1", "gold_palace");
    expect(hit).toEqual({ kind: "outreach_item", id: "i1" });
  });

  it("returns null for a fresh username and is tenant-scoped", async () => {
    fake.leads.push({ id: "l9", organizationId: "org-2", instagramUsername: "jaipur_jewels", instagramUrl: null });
    expect(await findExistingInstagramProspect("org-1", "jaipur_jewels")).toBeNull();
    expect(await findExistingInstagramProspect("org-1", "brand_new_handle")).toBeNull();
  });
});

// ── Daily pipeline ─────────────────────────────────────────────────────
const VALID_DM =
  "Hey, came across your page while looking at local makers. The product photos look really well done, especially the close-up shots. I build simple websites for small businesses that make it easier for customers to browse and get in touch. Happy to share a quick idea if you're open to it.";

function mockAI() {
  const researchJson = JSON.stringify({
    businessName: "Jaipur Jewels",
    category: "jewellery",
    location: "Mumbai",
    website: null,
    observations: "Handcrafted jewellery, active posting.",
  });
  return {
    name: "mock",
    isConfigured: () => true,
    generateJson: vi.fn(async () => ({
      text: researchJson,
      provider: "mock",
      model: "mock",
      latencyMs: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
    })),
    generateText: vi.fn(async () => ({
      text: VALID_DM,
      provider: "mock",
      model: "mock",
      latencyMs: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
    })),
    supportsTools: () => false,
  };
}

describe("runDailyProspecting", () => {
  beforeEach(() => {
    fake.reset();
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
    // Active plan: Monday = jewellery/Mumbai, target 75.
    fake.plan = {
      id: "plan-1",
      organizationId: "org-1",
      name: "Weekly",
      isActive: true,
      timezone: "Asia/Kolkata",
      runAtTime: "09:00",
      days: [
        {
          dayOfWeek: 1,
          industry: "jewellery",
          location: "Mumbai",
          country: "India",
          businessType: null,
          targetAudience: null,
          websitePreference: "ANY",
          followerThreshold: null,
          targetCount: 75,
          isActive: true,
        },
      ],
    };
  });

  afterEach(() => {
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
  });

  // Monday 2026-10-05 10:00 IST.
  const monday = new Date("2026-10-05T04:30:00Z");

  it("imports new prospects with stats, skips duplicates, isolates failures", async () => {
    // One username already in CRM → duplicate-skipped.
    fake.leads.push({
      id: "lead-old",
      organizationId: "org-1",
      instagramUsername: "old_handle",
      instagramUrl: null,
    });

    const discoveryDeps = {
      webSearch: vi.fn(async () => [
        { title: "Jaipur Jewels jewellery Mumbai", url: "https://www.instagram.com/jaipur_jewels/", snippet: "jewellery Mumbai" },
        { title: "Old Handle jewellery Mumbai", url: "https://www.instagram.com/old_handle/", snippet: "jewellery Mumbai" },
        { title: "Broken jewellery Mumbai", url: "https://www.instagram.com/broken_handle/", snippet: "jewellery Mumbai" },
        { title: "Silver House jewellery Mumbai", url: "https://www.instagram.com/silver_house/", snippet: "jewellery Mumbai" },
      ]),
      maxQueries: 2,
    };
    const researchDeps = {
      ai: mockAI(),
      webSearch: vi.fn(async () => [
        {
          title: "Result",
          url: "https://example.com/profile",
          snippet: "jewellery Mumbai",
        },
      ]),
      fetchWebsite: vi.fn(async () => {
        throw new Error("no website");
      }),
    };

    const stats = await runDailyProspecting("org-1", "user-1", {
      triggeredBy: "MANUAL",
      now: monday,
      deps: { discoveryDeps, researchDeps },
    });

    expect(stats.status).toBe("COMPLETED");
    expect(stats.found).toBe(4);
    expect(stats.duplicatesSkipped).toBe(1); // old_handle
    expect(stats.failed).toBe(1); // broken_handle — run continued
    expect(stats.newCount).toBe(3); // 3 passed dedup+research+filter…
    expect(stats.crmImported).toBe(2); // …but only 2 actually imported
    expect(stats.messagesGenerated).toBe(2);
    expect(stats.researched).toBe(3); // 4 found − 1 duplicate-skipped

    const created = fake.leads.filter((l) => l.id !== "lead-old");
    expect(created.length).toBe(2);
    for (const lead of created) {
      expect(lead.sourceType).toBe("INSTAGRAM");
      expect(lead.instagramConnectionStatus).toBe("UNKNOWN"); // never guessed
      expect(lead.aiMessage).toBe(VALID_DM);
      expect(lead.dataLabel).toBe("AI_INFERENCE");
      expect(lead.contactable).toBe(true);
    }
    const usernames = created.map((l) => l.instagramUsername).sort();
    expect(usernames).toEqual(["jaipur_jewels", "silver_house"]);

    // Run history persisted with honest stats.
    expect(fake.runs.length).toBe(1);
    expect(fake.runs[0].status).toBe("COMPLETED");
    expect(fake.runs[0].crmImported).toBe(2);
    expect(fake.runs[0].runDate).toBe("2026-10-05");

    // Audit trail written.
    const actions = fake.auditCalls.map((a) => a.action);
    expect(actions).toContain("prospecting.instagram.run_started");
    expect(actions).toContain("prospecting.instagram.run_completed");
  });

  it("is idempotent: a completed run is returned without re-running", async () => {
    fake.runs.push({
      id: "run-done",
      organizationId: "org-1",
      planId: "plan-1",
      dayOfWeek: 1,
      runDate: "2026-10-05",
      targetCount: 75,
      found: 10,
      newCount: 8,
      duplicatesSkipped: 2,
      researched: 8,
      messagesGenerated: 8,
      crmImported: 8,
      failed: 0,
      status: "COMPLETED",
      triggeredBy: "SCHEDULED",
    });
    const webSearch = vi.fn(async () => []);
    const stats = await runDailyProspecting("org-1", "user-1", {
      now: monday,
      deps: { discoveryDeps: { webSearch } },
    });
    expect(stats.runId).toBe("run-done");
    expect(stats.status).toBe("COMPLETED");
    expect(webSearch).not.toHaveBeenCalled();
  });

  it("refuses to run when the kill switch is on", async () => {
    process.env.WDD_AUTOMATION_KILL_SWITCH = "true";
    await expect(
      runDailyProspecting("org-1", "user-1", { now: monday }),
    ).rejects.toThrow("KILL_SWITCH_ACTIVE");
  });

  it("throws when no active plan day exists", async () => {
    fake.plan = { ...fake.plan, isActive: false };
    await expect(
      runDailyProspecting("org-1", "user-1", { now: monday }),
    ).rejects.toThrow("NO_ACTIVE_PLAN_DAY");
  });
});
