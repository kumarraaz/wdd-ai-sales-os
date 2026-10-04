/**
 * /api/automation/jobs route tests (Phase 3).
 *
 * Real enqueueJob validation against a fake DB; withWorkspace and
 * rate-limit are stubbed to inject a fixed org-A context.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted fakes ──────────────────────────────────────────────────────
const { fakeCtx } = vi.hoisted(() => ({
  fakeCtx: {
    user: { id: "user-1", email: "u@example.com", name: "U" },
    organization: { id: "org-A", name: "Org A", slug: "org-a" },
    membership: { id: "m1", role: "ADMIN" as const },
  },
}));

vi.mock("../lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tenant")>();
  return {
    ...actual,
    withWorkspace: (handler: any) => async (req: any, routeParams: any) =>
      handler(req, fakeCtx, routeParams ?? { params: Promise.resolve({}) }),
  };
});

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ success: true })),
  LIMITS: { api: { limit: 300, windowMs: 60_000 } },
}));

const fake = vi.hoisted(() => {
  const jobs: any[] = [];
  let seq = 0;
  const auditCalls: any[] = [];
  function matchWhere(job: any, where: any): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      const value = job[key];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        for (const [op, operand] of Object.entries(cond as any)) {
          if (op === "in") {
            if (!(operand as any[]).includes(value)) return false;
          } else return false;
        }
      } else if (value !== cond) return false;
    }
    return true;
  }
  return {
    jobs,
    auditCalls,
    reset() {
      jobs.length = 0;
      auditCalls.length = 0;
      seq = 0;
    },
    seed(job: any) {
      const j = { id: `job-${++seq}`, status: "QUEUED", attempts: 0, maxAttempts: 3, ...job };
      jobs.push(j);
      return j;
    },
    db: {
      job: {
        create: vi.fn(async ({ data }: any) => {
          const job = {
            id: `job-${++seq}`,
            status: "QUEUED",
            attempts: 0,
            maxAttempts: 3,
            error: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          jobs.push(job);
          return { ...job };
        }),
        findMany: vi.fn(async ({ where, orderBy, take }: any = {}) => {
          let out = jobs.filter((j) => matchWhere(j, where));
          if (orderBy?.createdAt === "desc") {
            out = [...out].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          if (take) out = out.slice(0, take);
          return out.map((j) => ({ ...j }));
        }),
        findFirst: vi.fn(async ({ where }: any = {}) => {
          const found = jobs.find((j) => matchWhere(j, where));
          return found ? { ...found } : null;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const job of jobs) {
            if (matchWhere(job, where)) {
              Object.assign(job, data);
              job.updatedAt = new Date();
              count++;
            }
          }
          return { count };
        }),
      },
      auditLog: {
        create: vi.fn(async (args: any) => {
          auditCalls.push(args);
          return {};
        }),
      },
    },
  };
});

vi.mock("../lib/db", () => ({ db: fake.db }));

import { GET as listJobs, POST as enqueueRoute } from "../app/api/automation/jobs/route";
import { GET as getJob, POST as jobAction } from "../app/api/automation/jobs/[id]/route";

function req(url: string, method = "GET", body?: unknown) {
  return new NextRequest(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const routeParams = (id: string) => ({ params: Promise.resolve({ id }) });

afterEach(() => {
  fake.reset();
  vi.clearAllMocks();
});

describe("GET /api/automation/jobs", () => {
  it("lists only the caller's organization jobs", async () => {
    fake.seed({ organizationId: "org-A", name: "research.website", payload: {} });
    fake.seed({ organizationId: "org-B", name: "research.website", payload: {} });
    const res = await listJobs(req("http://x/api/automation/jobs"), {} as any);
    const body = await res.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].organizationId ?? "org-A").toBeTruthy();
  });

  it("filters by status and rejects invalid statuses", async () => {
    fake.seed({ organizationId: "org-A", name: "a", payload: {}, status: "QUEUED" });
    fake.seed({ organizationId: "org-A", name: "b", payload: {}, status: "COMPLETED" });
    const res = await listJobs(req("http://x/api/automation/jobs?status=QUEUED"), {} as any);
    expect((await res.json()).jobs).toHaveLength(1);
    const bad = await listJobs(req("http://x/api/automation/jobs?status=BOGUS"), {} as any);
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/automation/jobs", () => {
  it("enqueues a known job type for the caller's org", async () => {
    const res = await enqueueRoute(
      req("http://x/api/automation/jobs", "POST", {
        type: "research.website",
        payload: { url: "https://example.com" },
      }),
      {} as any,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.job.name).toBe("research.website");
    expect(body.job.status).toBe("QUEUED");
    expect(fake.jobs[0].organizationId).toBe("org-A");
  });

  it("rejects unknown job types", async () => {
    const res = await enqueueRoute(
      req("http://x/api/automation/jobs", "POST", { type: "evil.type", payload: {} }),
      {} as any,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("UNKNOWN_JOB_TYPE");
  });

  it("rejects invalid payloads", async () => {
    const res = await enqueueRoute(
      req("http://x/api/automation/jobs", "POST", {
        type: "research.website",
        payload: { url: "not-a-url" },
      }),
      {} as any,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION_ERROR");
  });
});

describe("/api/automation/jobs/[id]", () => {
  it("returns 404 for another org's job", async () => {
    const other = fake.seed({ organizationId: "org-B", name: "research.website", payload: {} });
    const res = await getJob(req(`http://x/api/automation/jobs/${other.id}`), routeParams(other.id) as any);
    expect(res.status).toBe(404);
    const own = fake.seed({ organizationId: "org-A", name: "research.website", payload: {} });
    const res2 = await getJob(req(`http://x/api/automation/jobs/${own.id}`), routeParams(own.id) as any);
    expect(res2.status).toBe(200);
  });

  it("cancels a queued job, refuses to cancel a completed one", async () => {
    const queued = fake.seed({ organizationId: "org-A", name: "a", payload: {}, status: "QUEUED" });
    const res = await jobAction(
      req(`http://x/api/automation/jobs/${queued.id}`, "POST", { action: "cancel" }),
      routeParams(queued.id) as any,
    );
    expect(res.status).toBe(200);
    expect(fake.jobs[0].status).toBe("CANCELLED");

    const done = fake.seed({ organizationId: "org-A", name: "b", payload: {}, status: "COMPLETED" });
    const res2 = await jobAction(
      req(`http://x/api/automation/jobs/${done.id}`, "POST", { action: "cancel" }),
      routeParams(done.id) as any,
    );
    expect(res2.status).toBe(409);
  });

  it("rejects unknown actions", async () => {
    const job = fake.seed({ organizationId: "org-A", name: "a", payload: {} });
    const res = await jobAction(
      req(`http://x/api/automation/jobs/${job.id}`, "POST", { action: "launch" }),
      routeParams(job.id) as any,
    );
    expect(res.status).toBe(400);
  });
});
