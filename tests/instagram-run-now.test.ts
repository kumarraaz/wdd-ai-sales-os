/**
 * Run Now regression tests — the manual trigger must start the prospecting
 * run immediately without the cron tick, show it in run history, and be
 * duplicate-safe. The scheduled (tick) path must keep working untouched.
 *
 * Strategy: fake db (vi.mock) + mocked discovery/research modules, then
 * drive the REAL engine path: startManualRunNow → enqueueJob →
 * executeManualJobNow (claimJobById → executeJob → job handler → pipeline).
 * The cron tick (/api/automation/tick) is never invoked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const VALID_DM =
  "Hey, came across your page while looking at local makers. The product photos look really well done, especially the close-up shots. I build simple websites for small businesses that make it easier for customers to get in touch. Happy to share a quick idea if you're open to it.";

// ── Fake DB ────────────────────────────────────────────────────────────
const fake = vi.hoisted(() => {
  let seq = 0;
  const runs: any[] = [];
  const jobs: any[] = [];
  const leads: any[] = [];
  const auditCalls: any[] = [];

  function applyData(obj: any, data: any) {
    for (const [k, v] of Object.entries<any>(data)) {
      if (v && typeof v === "object" && "increment" in v) {
        obj[k] = (obj[k] ?? 0) + (v as any).increment;
      } else {
        obj[k] = v;
      }
    }
    obj.updatedAt = new Date();
    return obj;
  }

  function matchJobWhere(j: any, where: any): boolean {
    if (!where) return true;
    if (where.id !== undefined && j.id !== where.id) return false;
    if (where.organizationId !== undefined && j.organizationId !== where.organizationId)
      return false;
    if (where.status !== undefined) {
      if (typeof where.status === "string") {
        if (j.status !== where.status) return false;
      } else {
        if (where.status.in && !where.status.in.includes(j.status)) return false;
      }
    }
    if (where.updatedAt?.lt && !(j.updatedAt < where.updatedAt.lt)) return false;
    if (where.updatedAt?.lte && !(j.updatedAt <= where.updatedAt.lte)) return false;
    if (where.OR) {
      const ok = where.OR.some((cond: any) => {
        if (cond.status && !cond.updatedAt) return j.status === cond.status;
        if (cond.status === "RETRYING" && cond.updatedAt?.lte)
          return j.status === "RETRYING" && j.updatedAt <= cond.updatedAt.lte;
        return false;
      });
      if (!ok) return false;
    }
    return true;
  }

  const db: any = {
    $transaction: vi.fn(async (fn: any) => fn(db)),

    instagramProspectingPlan: {
      findFirst: vi.fn(async () => fake.plan),
    },
    instagramProspectingDay: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    instagramProspectingRun: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where?.organizationId_runDate;
        if (!key) return runs.find((r) => r.id === where?.id) ?? null;
        return (
          runs.find(
            (r) => r.organizationId === key.organizationId && r.runDate === key.runDate,
          ) ?? null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const run = {
          id: `run-${++seq}`,
          found: 0,
          newCount: 0,
          duplicatesSkipped: 0,
          researched: 0,
          messagesGenerated: 0,
          crmImported: 0,
          failed: 0,
          error: null,
          finishedAt: null,
          startedAt: new Date(),
          ...data,
        };
        runs.push(run);
        return run;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const run = runs.find((r) => r.id === where.id);
        applyData(run, data);
        return run;
      }),
    },

    job: {
      create: vi.fn(async ({ data }: any) => {
        const job = {
          id: `job-${++seq}`,
          attempts: 0,
          maxAttempts: 3,
          status: "QUEUED",
          error: null,
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        jobs.push(job);
        return job;
      }),
      findUnique: vi.fn(async ({ where }: any) => jobs.find((j) => j.id === where.id) ?? null),
      findMany: vi.fn(async (args: any = {}) => {
        let out = jobs.filter((j) => matchJobWhere(j, args.where));
        if (args.orderBy?.updatedAt === "asc") {
          out = [...out].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
        }
        if (args.take) out = out.slice(0, args.take);
        return out;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const j of jobs) {
          if (matchJobWhere(j, where)) {
            applyData(j, data);
            count++;
          }
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const job = jobs.find((j) => j.id === where.id);
        applyData(job, data);
        return job;
      }),
    },

    lead: {
      findFirst: vi.fn(async () => null), // no duplicates in these tests
      create: vi.fn(async ({ data }: any) => {
        // Real Prisma resolves the nested organization/company connect into
        // the FK scalar; mirror that so tenant assertions are meaningful.
        const lead = {
          id: `lead-${++seq}`,
          organizationId: data.organization?.connect?.id ?? data.organizationId,
          ...data,
        };
        delete lead.organization;
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
    company: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: `co-${++seq}`, ...data })),
    },
    instagramOutreachItem: { findFirst: vi.fn(async () => null) },
    leadActivity: { create: vi.fn(async ({ data }: any) => ({ id: `act-${++seq}`, ...data })) },
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
  };

  return {
    runs,
    jobs,
    leads,
    auditCalls,
    db,
    plan: null as any,
    reset() {
      runs.length = 0;
      jobs.length = 0;
      leads.length = 0;
      auditCalls.length = 0;
      seq = 0;
      vi.clearAllMocks();
      // re-arm the plan mock (clearAllMocks wipes implementations set via mockResolvedValue? no —
      // vi.fn(async () => fake.plan) keeps its implementation; only mock history is cleared.
    },
  };
});

vi.mock("../lib/db", () => ({ db: fake.db }));

vi.mock("../lib/prospecting/instagram-discovery", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/prospecting/instagram-discovery")>();
  return { ...orig, discoverInstagramUsernames: vi.fn() };
});

vi.mock("../lib/outreach/instagram-service", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/outreach/instagram-service")>();
  return { ...orig, researchAndDraft: vi.fn() };
});

import { discoverInstagramUsernames } from "../lib/prospecting/instagram-discovery";
import { researchAndDraft } from "../lib/outreach/instagram-service";
import {
  startManualRunNow,
  executeManualJobNow,
  ManualRunError,
} from "../lib/prospecting/instagram-manual";
import { enqueueJob } from "../lib/automation/runner";
import { runBatch } from "../lib/automation/runner";

const PLAN_ID = "ckkkkkkkkkkkkkkkkkkkkkkk"; // valid cuid shape for payload validation
// Monday 2026-10-05 10:00 IST.
const MONDAY = new Date("2026-10-05T04:30:00Z");

function mockDiscovery(usernames: string[]) {
  vi.mocked(discoverInstagramUsernames).mockResolvedValue({
    usernames,
    searchesMade: 2,
  } as any);
}

function mockResearch() {
  vi.mocked(researchAndDraft).mockImplementation(async (username: string) => ({
    research: {
      username,
      profileUrl: `https://www.instagram.com/${username}/`,
      businessName: `Biz ${username}`,
      category: "jewellery",
      location: "Mumbai",
      website: null,
      observations: "Handcrafted jewellery.",
      confidence: "MEDIUM",
      websiteAnalysis: null,
    },
    decision: { angle: "NEW_WEBSITE" },
    websiteSummary: null,
    generated: { text: VALID_DM, source: "ai" as const },
  }) as any);
}

describe("manual Run Now", () => {
  beforeEach(() => {
    fake.reset();
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
    fake.plan = {
      id: PLAN_ID,
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
          targetCount: 2,
          isActive: true,
        },
      ],
    };
    mockDiscovery(["jaipur_jewels", "silver_house"]);
    mockResearch();
  });

  afterEach(() => {
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
  });

  it("creates the run row QUEUED and enqueues the job immediately (no cron tick)", async () => {
    const started = await startManualRunNow("org-1", "user-1", { now: MONDAY });

    expect(started.status).toBe("started");
    if (started.status !== "started") throw new Error("unreachable");
    expect(started.run.status).toBe("QUEUED"); // visible in run history right away
    expect(started.run.triggeredBy).toBe("MANUAL");

    // Job exists in QUEUED state through the standard engine lifecycle.
    expect(fake.jobs.length).toBe(1);
    expect(fake.jobs[0].status).toBe("QUEUED");
    expect(fake.jobs[0].name).toBe("prospecting.instagram.daily");

    // Audit trail for the manual trigger.
    expect(fake.auditCalls.map((a: any) => a.action)).toContain(
      "prospecting.instagram.manual_run_enqueued",
    );
  });

  it("executes the queued job immediately via the existing runner (no tick)", async () => {
    const started = await startManualRunNow("org-1", "user-1", { now: MONDAY });
    if (started.status !== "started") throw new Error("unreachable");

    // This is what the route does post-response via waitUntil — the same
    // claim → execute path the tick worker uses. The tick is never called.
    const exec = await executeManualJobNow("org-1", started.jobId);
    expect(exec.claimed).toBe(true);
    expect(exec.disposition).toBe("completed");

    const run = fake.runs[0];
    expect(run.status).toBe("COMPLETED");
    expect(run.triggeredBy).toBe("MANUAL");
    expect(run.crmImported).toBe(2);

    const created = fake.leads;
    expect(created.length).toBe(2);
    for (const lead of created) {
      expect(lead.sourceType).toBe("INSTAGRAM");
      expect(lead.organizationId).toBe("org-1"); // tenant isolation preserved
      expect(lead.aiMessage).toBe(VALID_DM);
    }

    expect(fake.jobs[0].status).toBe("COMPLETED");
  });

  it("rejects a duplicate Run Now while the run is QUEUED (no second job)", async () => {
    await startManualRunNow("org-1", "user-1", { now: MONDAY });

    await expect(startManualRunNow("org-1", "user-1", { now: MONDAY })).rejects.toMatchObject({
      code: "RUN_ALREADY_IN_PROGRESS",
    });
    expect(fake.jobs.length).toBe(1); // no duplicate job enqueued
    expect(fake.runs.length).toBe(1); // no duplicate run row
  });

  it("rejects a duplicate Run Now while the run is RUNNING", async () => {
    const started = await startManualRunNow("org-1", "user-1", { now: MONDAY });
    if (started.status !== "started") throw new Error("unreachable");
    // Simulate the job having started (row transitioned QUEUED → RUNNING).
    fake.runs[0].status = "RUNNING";

    await expect(startManualRunNow("org-1", "user-1", { now: MONDAY })).rejects.toMatchObject({
      code: "RUN_ALREADY_IN_PROGRESS",
    });
    expect(fake.jobs.length).toBe(1);
  });

  it("converts a P2002 race between two simultaneous presses into 409-safe rejection", async () => {
    fake.db.instagramProspectingRun.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    await expect(startManualRunNow("org-1", "user-1", { now: MONDAY })).rejects.toMatchObject({
      code: "RUN_ALREADY_IN_PROGRESS",
    });
    expect(fake.jobs.length).toBe(0); // loser enqueues nothing
  });

  it("returns already_completed when today's run finished", async () => {
    fake.runs.push({
      id: "run-done",
      organizationId: "org-1",
      planId: PLAN_ID,
      dayOfWeek: 1,
      runDate: "2026-10-05",
      targetCount: 2,
      status: "COMPLETED",
      triggeredBy: "MANUAL",
      startedAt: MONDAY,
      found: 2,
      newCount: 2,
      duplicatesSkipped: 0,
      researched: 2,
      messagesGenerated: 2,
      crmImported: 2,
      failed: 0,
    });
    const res = await startManualRunNow("org-1", "user-1", { now: MONDAY });
    expect(res.status).toBe("already_completed");
    expect(fake.jobs.length).toBe(0);
  });

  it("takes over a stale RUNNING run instead of blocking forever", async () => {
    fake.runs.push({
      id: "run-stale",
      organizationId: "org-1",
      planId: PLAN_ID,
      dayOfWeek: 1,
      runDate: "2026-10-05",
      targetCount: 2,
      status: "RUNNING",
      triggeredBy: "SCHEDULED",
      startedAt: new Date(MONDAY.getTime() - 20 * 60_000), // 20 min ago — stale
      found: 0,
      newCount: 0,
      duplicatesSkipped: 0,
      researched: 0,
      messagesGenerated: 0,
      crmImported: 0,
      failed: 0,
    });

    const started = await startManualRunNow("org-1", "user-1", { now: MONDAY });
    expect(started.status).toBe("started");
    expect(fake.runs.length).toBe(1); // row reused, not duplicated

    if (started.status !== "started") throw new Error("unreachable");
    const exec = await executeManualJobNow("org-1", started.jobId);
    expect(exec.disposition).toBe("completed");
    expect(fake.runs[0].status).toBe("COMPLETED");
    expect(
      fake.auditCalls.map((a: any) => a.action).includes("prospecting.instagram.run_takeover"),
    ).toBe(true);
  });

  it("still blocks when the RUNNING run is fresh (one-run-per-day)", async () => {
    fake.runs.push({
      id: "run-live",
      organizationId: "org-1",
      planId: PLAN_ID,
      dayOfWeek: 1,
      runDate: "2026-10-05",
      targetCount: 2,
      status: "RUNNING",
      triggeredBy: "SCHEDULED",
      startedAt: new Date(MONDAY.getTime() - 60_000), // 1 min ago — live
      found: 0,
      newCount: 0,
      duplicatesSkipped: 0,
      researched: 0,
      messagesGenerated: 0,
      crmImported: 0,
      failed: 0,
    });
    await expect(startManualRunNow("org-1", "user-1", { now: MONDAY })).rejects.toMatchObject({
      code: "RUN_ALREADY_IN_PROGRESS",
    });
  });

  it("kill switch blocks the manual trigger before anything is created", async () => {
    process.env.WDD_AUTOMATION_KILL_SWITCH = "true";
    await expect(startManualRunNow("org-1", "user-1", { now: MONDAY })).rejects.toMatchObject({
      code: "KILL_SWITCH_ACTIVE",
    });
    expect(fake.runs.length).toBe(0);
    expect(fake.jobs.length).toBe(0);
  });

  it("executeManualJobNow is a no-op when the job was already claimed elsewhere", async () => {
    const started = await startManualRunNow("org-1", "user-1", { now: MONDAY });
    if (started.status !== "started") throw new Error("unreachable");
    fake.jobs[0].status = "RUNNING"; // claimed by the tick worker in a race

    const exec = await executeManualJobNow("org-1", started.jobId);
    expect(exec.claimed).toBe(false);
  });
});

describe("scheduled path (untouched)", () => {
  beforeEach(() => {
    fake.reset();
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
    fake.plan = {
      id: PLAN_ID,
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
          targetCount: 2,
          isActive: true,
        },
      ],
    };
    mockDiscovery(["jaipur_jewels"]);
    mockResearch();
  });

  afterEach(() => {
    delete process.env.WDD_AUTOMATION_KILL_SWITCH;
  });

  it("a scheduler-enqueued job still runs through runBatch (the tick path) with SCHEDULED attribution", async () => {
    // This is exactly what evaluateAutomations + tick does: enqueue without
    // the manual flag, then runBatch claims and executes.
    await enqueueJob({
      organizationId: "org-1",
      type: "prospecting.instagram.daily",
      payload: { planId: PLAN_ID },
      actorId: "system",
    });

    const stats = await runBatch({ organizationId: "org-1", limit: 5 });

    expect(stats.claimed).toBe(1);
    expect(stats.completed).toBe(1);
    expect(fake.runs.length).toBe(1);
    expect(fake.runs[0].status).toBe("COMPLETED");
    expect(fake.runs[0].triggeredBy).toBe("SCHEDULED");
    expect(fake.runs[0].crmImported).toBe(1);
  });
});
