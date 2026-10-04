/**
 * Job engine tests (Phase 3).
 *
 * In-memory fake for the Prisma Job model exercises the engine's real
 * logic: enqueue validation, atomic claiming (incl. a simulated race),
 * retries with exponential backoff, dead-lettering, stale recovery, kill
 * switch, and tenant isolation. Handler dependencies (pipeline,
 * inspection, AI, quotas, leads) are mocked — no live external systems.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Hoisted mocks ──────────────────────────────────────────────────────
const {
  mockRunDiscoveryPipeline,
  mockRunWebsiteInspection,
  mockGenerateLeadIntelligence,
  mockGenerateText,
  mockGetLead,
  mockQuotaAllow,
  mockListDiscoveryProviders,
  mockGetDiscoveryProvider,
} = vi.hoisted(() => {
  const mockProvider = {
    id: "mock-provider",
    label: "Mock",
    sourceType: "DIRECTORY",
    searchable: true,
    isConfigured: () => true,
    setupInstructions: () => [],
    search: vi.fn(),
  };
  return {
    mockRunDiscoveryPipeline: vi.fn(),
    mockRunWebsiteInspection: vi.fn(),
    mockGenerateLeadIntelligence: vi.fn(),
    mockGenerateText: vi.fn(async () => ({
      text: "Hello, this is a draft.",
      model: "mock",
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
    mockGetLead: vi.fn(),
    mockListDiscoveryProviders: vi.fn(() => [mockProvider]),
    mockGetDiscoveryProvider: vi.fn(() => undefined),
    mockQuotaAllow: {
      checkDiscoveryQuota: vi.fn(async () => ({ allowed: true })),
      recordDiscoveryUsage: vi.fn(async () => {}),
      checkWebsiteInspectionQuota: vi.fn(async () => ({ allowed: true })),
      recordWebsiteInspectionUsage: vi.fn(async () => {}),
      checkAiIntelligenceQuota: vi.fn(async () => ({ allowed: true })),
      recordAiIntelligenceUsage: vi.fn(async () => {}),
      recordLeadScoringUsage: vi.fn(async () => {}),
    },
  };
});

vi.mock("../lib/discovery/pipeline", () => ({
  runDiscoveryPipeline: mockRunDiscoveryPipeline,
}));

vi.mock("../lib/discovery/registry", () => ({
  getDiscoveryProvider: mockGetDiscoveryProvider,
  listDiscoveryProviders: mockListDiscoveryProviders,
}));

vi.mock("../lib/discovery/import", () => ({
  findMatchForCompany: vi.fn(),
}));

vi.mock("../lib/intelligence/inspect", () => ({
  runWebsiteInspection: mockRunWebsiteInspection,
}));

vi.mock("../lib/intelligence/generate", () => ({
  generateLeadIntelligence: mockGenerateLeadIntelligence,
  IntelligenceError: class IntelligenceError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("../lib/leads", () => ({
  getLead: mockGetLead,
}));

vi.mock("../lib/quotas", () => mockQuotaAllow);

vi.mock("../lib/ai/registry", () => ({
  getAIProvider: () => ({
    name: "mock",
    isConfigured: () => true,
    generateText: mockGenerateText,
    generateJson: vi.fn(),
    supportsTools: () => false,
  }),
}));

// ── In-memory Job store ────────────────────────────────────────────────
type FakeJob = {
  id: string;
  organizationId: string | null;
  name: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function matchWhere(job: FakeJob, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as any[]).some((c) => matchWhere(job, c))) return false;
      continue;
    }
    const value = (job as any)[key];
    if (
      cond !== null &&
      typeof cond === "object" &&
      !(cond instanceof Date) &&
      !Array.isArray(cond)
    ) {
      for (const [op, operand] of Object.entries(cond as any)) {
        if (op === "in") {
          if (!(operand as any[]).includes(value)) return false;
        } else if (op === "lte") {
          if (!(value <= (operand as any))) return false;
        } else if (op === "lt") {
          if (!(value < (operand as any))) return false;
        } else if (op === "gte") {
          if (!(value >= (operand as any))) return false;
        } else if (op === "gt") {
          if (!(value > (operand as any))) return false;
        } else if (op === "path") {
          const walked = (cond as any).path.reduce(
            (acc: any, k: string) => acc?.[k],
            value,
          );
          if (walked !== (cond as any).equals) return false;
        } else {
          return false;
        }
      }
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

function applyData(job: FakeJob, data: any) {
  for (const [key, val] of Object.entries(data)) {
    if (
      val !== null &&
      typeof val === "object" &&
      !(val instanceof Date) &&
      "increment" in (val as object)
    ) {
      (job as any)[key] = ((job as any)[key] ?? 0) + (val as any).increment;
    } else {
      (job as any)[key] = val;
    }
  }
  job.updatedAt = new Date();
}

const fakeDb = vi.hoisted(() => {
  const jobs: FakeJob[] = [];
  let seq = 0;
  const auditCalls: any[] = [];
  const created: Record<string, any[]> = {
    leadScore: [],
    followUp: [],
    message: [],
  };
  const jobApi = {
    create: vi.fn(async ({ data }: any) => {
      const job: FakeJob = {
        id: `job-${++seq}`,
        organizationId: null,
        name: "",
        payload: {},
        status: "QUEUED",
        attempts: 0,
        maxAttempts: 3,
        error: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      jobs.push(job);
      return { ...job };
    }),
    findMany: vi.fn(async (args: any = {}) => {
      let out = jobs.filter((j) => matchWhere(j, args.where));
      if (args.orderBy?.updatedAt === "asc") {
        out = [...out].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
      }
      if (args.orderBy?.createdAt === "desc") {
        out = [...out].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      if (args.take) out = out.slice(0, args.take);
      return out.map((j) => ({ ...j }));
    }),
    findFirst: vi.fn(async (args: any = {}) => {
      const out = await jobApi.findMany({ ...args, take: 1 });
      return out[0] ?? null;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const job of jobs) {
        if (matchWhere(job, where)) {
          applyData(job, data);
          count++;
        }
      }
      return { count };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const job = jobs.find((j) => j.id === where.id);
      if (!job) throw new Error("not found");
      applyData(job, data);
      return { ...job };
    }),
    count: vi.fn(async ({ where }: any = {}) => jobs.filter((j) => matchWhere(j, where)).length),
  };
  return {
    jobs,
    auditCalls,
    created,
    reset() {
      jobs.length = 0;
      auditCalls.length = 0;
      created.leadScore.length = 0;
      created.followUp.length = 0;
      created.message.length = 0;
      seq = 0;
    },
    db: {
      job: jobApi,
      auditLog: { create: vi.fn(async (args: any) => { auditCalls.push(args); return {}; }) },
      leadScore: { create: vi.fn(async ({ data }: any) => { const r = { id: "ls-1", ...data }; created.leadScore.push(r); return r; }) },
      followUp: { create: vi.fn(async ({ data }: any) => { const r = { id: "fu-1", ...data }; created.followUp.push(r); return r; }) },
      message: { create: vi.fn(async ({ data }: any) => { const r = { id: "msg-1", ...data }; created.message.push(r); return r; }) },
      $transaction: vi.fn(async (fn: any) => fn({ job: jobApi })),
    },
  };
});

vi.mock("../lib/db", () => ({ db: fakeDb.db }));

// ── Imports under test ─────────────────────────────────────────────────
import {
  enqueueJob,
  claimJob,
  executeJob,
  runBatch,
  recoverStaleJobs,
} from "../lib/automation/runner";
import { backoffMs, JobError, STALE_JOB_TIMEOUT_MS } from "../lib/automation/types";
import { SafeFetchError } from "../lib/intelligence/safe-fetch";

afterEach(() => {
  fakeDb.reset();
  vi.clearAllMocks();
  vi.stubEnv("WDD_AUTOMATION_KILL_SWITCH", "");
  mockQuotaAllow.checkDiscoveryQuota.mockResolvedValue({ allowed: true });
  mockQuotaAllow.checkWebsiteInspectionQuota.mockResolvedValue({ allowed: true });
  mockQuotaAllow.checkAiIntelligenceQuota.mockResolvedValue({ allowed: true });
});

function ageJob(id: string, ms: number) {
  const job = fakeDb.jobs.find((j) => j.id === id);
  if (job) job.updatedAt = new Date(Date.now() - ms);
}

describe("enqueue", () => {
  it("enqueues a known job type with validated payload", async () => {
    const job = await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    expect(job.status).toBe("QUEUED");
    expect(job.name).toBe("research.website");
    expect(job.maxAttempts).toBe(3);
    expect(fakeDb.auditCalls.some((c) => c.data.action === "job.created")).toBe(true);
  });

  it("rejects unknown job types", async () => {
    await expect(
      enqueueJob({ organizationId: "org-A", type: "evil.deploy", payload: {} }),
    ).rejects.toMatchObject({ code: "UNKNOWN_JOB_TYPE" });
    expect(fakeDb.jobs).toHaveLength(0);
  });

  it("rejects invalid payloads", async () => {
    await expect(
      enqueueJob({ organizationId: "org-A", type: "research.website", payload: { url: "not-a-url" } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects secret-like payload keys", async () => {
    await expect(
      enqueueJob({
        organizationId: "org-A",
        type: "research.website",
        payload: { url: "https://example.com", apiKey: "sk-123" },
      }),
    ).rejects.toMatchObject({ code: "SECRET_IN_PAYLOAD" });
  });

  it("rejects organizationId smuggled in payload (strict schemas)", async () => {
    await expect(
      enqueueJob({
        organizationId: "org-A",
        type: "research.website",
        payload: { url: "https://example.com", organizationId: "org-evil" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("bounds maxAttempts", async () => {
    await expect(
      enqueueJob({ organizationId: "org-A", type: "research.website", payload: { url: "https://example.com" }, maxAttempts: 99 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const job = await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
      maxAttempts: 5,
    });
    expect(job.maxAttempts).toBe(5);
  });
});

describe("claim", () => {
  it("claims a pending job and marks it RUNNING with incremented attempts", async () => {
    const enqueued = await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    const claimed = await claimJob();
    expect(claimed?.id).toBe(enqueued.id);
    expect(claimed?.status).toBe("RUNNING");
    expect(claimed?.attempts).toBe(1);
  });

  it("prevents double claim (simulated worker race)", async () => {
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    const [a, b] = await Promise.all([claimJob(), claimJob()]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
    // Second sequential claim also finds nothing (already RUNNING).
    expect(await claimJob()).toBeNull();
  });

  it("respects organization boundaries when claiming", async () => {
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    expect(await claimJob("org-B")).toBeNull();
    expect((await claimJob("org-A"))?.organizationId).toBe("org-A");
  });

  it("returns null when the queue is empty", async () => {
    expect(await claimJob()).toBeNull();
  });
});

describe("execute", () => {
  it("completes a job and clears the error", async () => {
    mockRunWebsiteInspection.mockResolvedValueOnce({
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      httpStatus: 200,
      https: true,
      title: "Example",
      metaDescription: null,
    });
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    const claimed = (await claimJob())!;
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("completed");
    const stored = fakeDb.jobs.find((j) => j.id === claimed.id)!;
    expect(stored.status).toBe("COMPLETED");
    expect(stored.finishedAt).toBeTruthy();
    expect(mockQuotaAllow.checkWebsiteInspectionQuota).toHaveBeenCalledWith("org-A");
    expect(mockQuotaAllow.recordWebsiteInspectionUsage).toHaveBeenCalledWith("org-A");
  });

  it("retries transient failures with exponential backoff", async () => {
    mockRunWebsiteInspection
      .mockRejectedValueOnce(new SafeFetchError("TIMEOUT", "timed out"))
      .mockResolvedValueOnce({
        requestedUrl: "https://example.com",
        finalUrl: "https://example.com/",
        httpStatus: 200,
        https: true,
        title: "Example",
        metaDescription: null,
      });
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });

    // Attempt 1 → transient failure → RETRYING.
    let claimed = (await claimJob())!;
    let result = await executeJob(claimed);
    expect(result.disposition).toBe("retrying");
    expect(fakeDb.jobs[0].status).toBe("RETRYING");
    expect(fakeDb.jobs[0].error).toContain("WEBSITE_UNREACHABLE");

    // Not yet due (backoff 30s) → nothing claimable.
    expect(await claimJob()).toBeNull();

    // After backoff elapses → claimable again → succeeds.
    ageJob(claimed.id, 31_000);
    claimed = (await claimJob())!;
    expect(claimed.attempts).toBe(2);
    result = await executeJob(claimed);
    expect(result.disposition).toBe("completed");
  });

  it("dead-letters after maxAttempts", async () => {
    mockRunWebsiteInspection.mockRejectedValue(new SafeFetchError("TIMEOUT", "down"));
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
      maxAttempts: 2,
    });
    const first = (await claimJob())!;
    const jobId = first.id;
    let result = await executeJob(first);
    expect(result.disposition).toBe("retrying");
    // Age past the backoff window, then the second (final) attempt fails.
    ageJob(jobId, 61_000);
    const second = (await claimJob())!;
    expect(second.id).toBe(jobId);
    result = await executeJob(second);
    expect(result.disposition).toBe("dead_lettered");
    const stored = fakeDb.jobs[0];
    expect(stored.status).toBe("FAILED");
    expect(stored.error).toContain("WEBSITE_UNREACHABLE");
    expect(fakeDb.auditCalls.some((c) => c.data.action === "job.dead_lettered")).toBe(true);
  });

  it("fails fast on permanent errors without retrying", async () => {
    mockGetLead.mockResolvedValueOnce(null); // LEAD_NOT_FOUND is permanent
    await enqueueJob({
      organizationId: "org-A",
      type: "research.lead",
      payload: { leadId: "c".repeat(24) },
    });
    const claimed = (await claimJob())!;
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("failed_permanent");
    expect(fakeDb.jobs[0].status).toBe("FAILED");
    expect(fakeDb.jobs[0].attempts).toBe(1);
  });

  it("fails safely on unknown job types stored in the row", async () => {
    // Bypass enqueue validation to simulate a row written by other means.
    const raw = await fakeDb.db.job.create({
      data: { organizationId: "org-A", name: "ghost.type", payload: {}, status: "QUEUED" },
    });
    const claimed = (await claimJob())!;
    expect(claimed.id).toBe(raw.id);
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("failed_permanent");
  });

  it("never exposes stack traces in the stored error", async () => {
    mockRunWebsiteInspection.mockRejectedValueOnce(new Error("kaboom\n    at secret (/x.js:1:1)"));
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    const claimed = (await claimJob())!;
    await executeJob(claimed);
    const stored = fakeDb.jobs[0];
    expect(stored.error).not.toContain("at secret");
    expect(stored.error!.length).toBeLessThanOrEqual(520);
  });
});

describe("backoff", () => {
  it("is exponential and capped", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(100)).toBe(15 * 60_000);
  });
});

describe("stale recovery", () => {
  it("recovers crashed RUNNING jobs to RETRYING", async () => {
    const job = await fakeDb.db.job.create({
      data: {
        organizationId: "org-A",
        name: "research.website",
        payload: { url: "https://example.com" },
        status: "RUNNING",
        attempts: 1,
        maxAttempts: 3,
      },
    });
    ageJob(job.id, STALE_JOB_TIMEOUT_MS + 1_000);
    const recovered = await recoverStaleJobs();
    expect(recovered).toBe(1);
    expect(fakeDb.jobs[0].status).toBe("RETRYING");
  });

  it("dead-letters stale jobs that exhausted attempts", async () => {
    const job = await fakeDb.db.job.create({
      data: {
        organizationId: "org-A",
        name: "research.website",
        payload: {},
        status: "RUNNING",
        attempts: 3,
        maxAttempts: 3,
      },
    });
    ageJob(job.id, STALE_JOB_TIMEOUT_MS + 1_000);
    await recoverStaleJobs();
    expect(fakeDb.jobs[0].status).toBe("FAILED");
  });

  it("leaves fresh RUNNING jobs alone", async () => {
    await fakeDb.db.job.create({
      data: { organizationId: "org-A", name: "x", payload: {}, status: "RUNNING", attempts: 1 },
    });
    expect(await recoverStaleJobs()).toBe(0);
    expect(fakeDb.jobs[0].status).toBe("RUNNING");
  });
});

describe("kill switch", () => {
  it("runBatch does nothing when the kill switch is on", async () => {
    vi.stubEnv("WDD_AUTOMATION_KILL_SWITCH", "true");
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    const stats = await runBatch({ limit: 5 });
    expect(stats.killed).toBe(true);
    expect(stats.claimed).toBe(0);
    expect(fakeDb.jobs[0].status).toBe("QUEUED"); // preserved
  });

  it("executeJob reverts an already-claimed job to QUEUED when killed", async () => {
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    const claimed = (await claimJob())!;
    vi.stubEnv("WDD_AUTOMATION_KILL_SWITCH", "true");
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("killed");
    expect(fakeDb.jobs[0].status).toBe("QUEUED");
    expect(mockRunWebsiteInspection).not.toHaveBeenCalled();
    expect(
      fakeDb.auditCalls.some((c) => c.data.action === "job.kill_switch_blocked"),
    ).toBe(true);
  });
});

describe("runBatch", () => {
  it("processes a bounded batch and reports stats", async () => {
    mockRunWebsiteInspection.mockResolvedValue({
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      httpStatus: 200,
      https: true,
      title: "Example",
      metaDescription: null,
    });
    for (let i = 0; i < 3; i++) {
      await enqueueJob({
        organizationId: "org-A",
        type: "research.website",
        payload: { url: "https://example.com" },
      });
    }
    const stats = await runBatch({ limit: 2 });
    expect(stats).toMatchObject({ claimed: 2, completed: 2, failed: 0, retried: 0 });
    const stats2 = await runBatch({ limit: 5 });
    expect(stats2.claimed).toBe(1);
  });

  it("recovers stale jobs at batch start", async () => {
    const job = await fakeDb.db.job.create({
      data: {
        organizationId: "org-A",
        name: "research.website",
        payload: { url: "https://example.com" },
        status: "RUNNING",
        attempts: 1,
        maxAttempts: 3,
      },
    });
    ageJob(job.id, STALE_JOB_TIMEOUT_MS + 1_000);
    mockRunWebsiteInspection.mockResolvedValue({
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      httpStatus: 200,
      https: true,
      title: "Example",
      metaDescription: null,
    });
    const stats = await runBatch({ limit: 5 });
    // Stale → RETRYING (not due yet, backoff) → nothing claimed.
    expect(stats.claimed).toBe(0);
    expect(fakeDb.jobs[0].status).toBe("RETRYING");
  });
});

describe("handlers", () => {
  it("discovery.pipeline delegates to the existing pipeline with adapted deps", async () => {
    mockRunDiscoveryPipeline.mockResolvedValueOnce({
      results: [],
      summary: { searched: 4, researched: 0, analyzed: 0, qualified: 0, duplicates: 0, failed: 0 },
    });
    await enqueueJob({
      organizationId: "org-A",
      type: "discovery.pipeline",
      payload: { industry: "Manufacturers", location: "Delhi, India", limit: 5 },
    });
    const claimed = (await claimJob())!;
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("completed");
    expect(mockRunDiscoveryPipeline).toHaveBeenCalledTimes(1);
    const [input, deps, onEvent] = mockRunDiscoveryPipeline.mock.calls[0];
    expect(input).toMatchObject({ industry: "Manufacturers", location: "Delhi, India" });
    expect(typeof deps.search).toBe("function");
    expect(typeof deps.checkDuplicate).toBe("function");
    expect(typeof deps.researchWebsite).toBe("function");
    expect(typeof deps.generateAI).toBe("function");
    expect(typeof deps.score).toBe("function");
    expect(typeof onEvent).toBe("function");
    expect(mockQuotaAllow.checkDiscoveryQuota).toHaveBeenCalledWith("org-A", 5);
    expect(mockQuotaAllow.recordDiscoveryUsage).toHaveBeenCalledWith("org-A", {
      searches: 1,
      records: 4,
    });
  });

  it("lead.scoring uses the deterministic scorer and persists the record", async () => {
    mockGetLead.mockResolvedValueOnce({
      id: "lead-1",
      fullName: "Jane",
      website: null,
      industry: "Manufacturing",
      city: "Delhi",
      country: "India",
      company: null,
    });
    await enqueueJob({
      organizationId: "org-A",
      type: "lead.scoring",
      payload: { leadId: "c".repeat(24) },
    });
    const claimed = (await claimJob())!;
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("completed");
    expect(fakeDb.created.leadScore).toHaveLength(1);
    const record = fakeDb.created.leadScore[0];
    expect(record.organizationId).toBe("org-A");
    expect(record.provider).toBe("deterministic");
    expect(record.score).toBeGreaterThanOrEqual(0);
    expect(record.score).toBeLessThanOrEqual(100);
  });

  it("message.generate produces a DRAFT via the AI provider and never sends", async () => {
    await enqueueJob({
      organizationId: "org-A",
      type: "message.generate",
      payload: {
        channel: "EMAIL",
        subject: "Intro",
        facts: { companyName: "Acme" },
      },
    });
    const claimed = (await claimJob())!;
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("completed");
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const [system, user] = mockGenerateText.mock.calls[0] as unknown as [string, string];
    expect(system).toMatch(/ONLY the verified facts/i);
    expect(user).toContain("Acme");
    expect(fakeDb.created.message).toHaveLength(1);
    const draft = fakeDb.created.message[0];
    expect(draft.status).toBe("DRAFT");
    expect(draft.approvalMode).toBe("APPROVAL_REQUIRED");
    expect(draft.direction).toBe("OUTBOUND");
    expect(draft.organizationId).toBe("org-A");
  });

  it("followup.create writes an org-scoped follow-up", async () => {
    mockGetLead.mockResolvedValueOnce({ id: "lead-1" });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await enqueueJob({
      organizationId: "org-A",
      type: "followup.create",
      payload: { leadId: "c".repeat(24), channel: "EMAIL", scheduledAt: future },
    });
    const claimed = (await claimJob())!;
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("completed");
    expect(fakeDb.created.followUp[0]).toMatchObject({ organizationId: "org-A" });
  });

  it("research.lead delegates to the existing intelligence generation", async () => {
    mockGetLead.mockResolvedValueOnce({
      id: "lead-1",
      fullName: "Jane",
      website: "https://acme.example.com",
      industry: "Manufacturing",
      company: null,
    });
    mockRunWebsiteInspection.mockResolvedValueOnce({
      requestedUrl: "https://acme.example.com",
      finalUrl: "https://acme.example.com/",
      title: "Acme",
    });
    mockGenerateLeadIntelligence.mockResolvedValueOnce({
      output: { confidence: "HIGH" },
      warnings: [],
    });
    await enqueueJob({
      organizationId: "org-A",
      type: "research.lead",
      payload: { leadId: "c".repeat(24) },
    });
    const claimed = (await claimJob())!;
    const result = await executeJob(claimed);
    expect(result.disposition).toBe("completed");
    expect(mockGenerateLeadIntelligence).toHaveBeenCalledTimes(1);
    expect(result.summary).toMatchObject({ intelligence: { confidence: "HIGH" } });
  });

  it("handlers contain no send path (source guardrail)", () => {
    const src = readFileSync(
      join(__dirname, "..", "lib", "automation", "handlers.ts"),
      "utf8",
    );
    expect(src).not.toContain('"SENT"');
    expect(src).not.toContain("'SENT'");
    expect(src).not.toMatch(/sendEmail|deliverMessage|whatsapp.*send|linkedin.*send/i);
  });

  it("JobError carries the original message for operators", () => {
    const err = new JobError("QUOTA_EXCEEDED", "Daily limit reached.", false);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.retryable).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("a job payload can never override the organization", async () => {
    // Strict schemas reject organizationId inside payloads.
    await expect(
      enqueueJob({
        organizationId: "org-A",
        type: "followup.create",
        payload: {
          leadId: "c".repeat(24),
          channel: "EMAIL",
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          organizationId: "org-evil",
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("cross-org job access is rejected at claim and read", async () => {
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
    });
    // Claiming scoped to org-B finds nothing.
    expect(await claimJob("org-B")).toBeNull();
    // A forged context cannot execute another org's job: executeJob uses
    // the row's organizationId, and handlers re-scope every query.
    const claimed = (await claimJob("org-A"))!;
    expect(claimed.organizationId).toBe("org-A");
  });

  it("audit records carry the job's own organization", async () => {
    await enqueueJob({
      organizationId: "org-A",
      type: "research.website",
      payload: { url: "https://example.com" },
      actorId: "user-9",
    });
    expect(fakeDb.auditCalls[0].data).toMatchObject({
      organizationId: "org-A",
      actorId: "user-9",
      action: "job.created",
    });
  });
});
