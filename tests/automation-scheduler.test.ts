/**
 * Automation scheduler tests (Phase 3).
 *
 * Real evaluateAutomations + real enqueueJob against a fake DB.
 * Handler dependencies are never executed here (only enqueued), so no
 * provider mocks are needed — but the db module is faked.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// ── Fake DB ────────────────────────────────────────────────────────────
const fake = vi.hoisted(() => {
  const jobs: any[] = [];
  const automations: any[] = [];
  const auditCalls: any[] = [];
  let seq = 0;
  function payloadMatches(payload: any, path: string[], equals: unknown) {
    return path.reduce((acc: any, k: string) => acc?.[k], payload) === equals;
  }
  return {
    jobs,
    automations,
    auditCalls,
    reset() {
      jobs.length = 0;
      automations.length = 0;
      auditCalls.length = 0;
      seq = 0;
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
        findFirst: vi.fn(async ({ where }: any = {}) => {
          const found = jobs.find((j) => {
            if (where?.payload?.path) {
              return payloadMatches(j.payload, where.payload.path, where.payload.equals);
            }
            return true;
          });
          return found ? { ...found } : null;
        }),
      },
      automation: {
        findMany: vi.fn(async ({ where }: any = {}) => {
          return automations.filter(
            (a) =>
              (!where.organizationId || a.organizationId === where.organizationId) &&
              (!where.status || a.status === where.status),
          );
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

// ── Imports under test ─────────────────────────────────────────────────
import { evaluateAutomations, evaluateCondition } from "../lib/automation/scheduler";

const LEAD_ID = "c".repeat(24);

function makeAutomation(overrides: any = {}) {
  return {
    id: "ca" + "1".repeat(22),
    organizationId: "org-A",
    name: "Test automation",
    status: "ACTIVE",
    createdById: "user-1",
    triggers: [
      { id: "ct" + "1".repeat(22), automationId: "ca" + "1".repeat(22), type: "schedule", config: { intervalMinutes: 60 } },
    ],
    conditions: [],
    actions: [
      {
        id: "cb" + "1".repeat(22),
        automationId: "ca" + "1".repeat(22),
        order: 0,
        type: "research-lead",
        config: { leadId: LEAD_ID },
        requiresApproval: false,
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  fake.reset();
  vi.clearAllMocks();
});

describe("evaluateCondition", () => {
  it("evaluates operators", () => {
    const ctx = { score: 80, status: "NEW", nested: { tag: "vip" } };
    expect(evaluateCondition("score", "gt", "50", ctx)).toBe(true);
    expect(evaluateCondition("score", "lt", "50", ctx)).toBe(false);
    expect(evaluateCondition("score", "gte", "80", ctx)).toBe(true);
    expect(evaluateCondition("score", "lte", "79", ctx)).toBe(false);
    expect(evaluateCondition("status", "eq", "NEW", ctx)).toBe(true);
    expect(evaluateCondition("status", "neq", "NEW", ctx)).toBe(false);
    expect(evaluateCondition("status", "contains", "E", ctx)).toBe(true);
    expect(evaluateCondition("nested.tag", "eq", "vip", ctx)).toBe(true);
    expect(evaluateCondition("missing.field", "eq", "x", ctx)).toBe(false);
  });

  it("fails closed on unknown operators", () => {
    expect(evaluateCondition("score", "regex", ".*", { score: 1 })).toBe(false);
  });
});

describe("evaluateAutomations", () => {
  it("enqueues mapped actions for a due schedule trigger", async () => {
    fake.automations.push(makeAutomation());
    const stats = await evaluateAutomations("org-A");
    expect(stats).toMatchObject({ evaluated: 1, fired: 1, enqueued: 1 });
    expect(fake.jobs).toHaveLength(1);
    const job = fake.jobs[0];
    expect(job.name).toBe("research.lead");
    expect(job.organizationId).toBe("org-A");
    expect(job.status).toBe("QUEUED");
    expect(job.payload.leadId).toBe(LEAD_ID);
    expect(job.payload.automationId).toBe("ca" + "1".repeat(22));
    expect(job.payload.automationActionId).toBe("cb" + "1".repeat(22));
  });

  it("does nothing for non-ACTIVE automations", async () => {
    fake.automations.push(makeAutomation({ status: "PAUSED" }));
    fake.automations.push(makeAutomation({ id: "ca" + "2".repeat(22), status: "ARCHIVED" }));
    const stats = await evaluateAutomations("org-A");
    expect(stats).toMatchObject({ evaluated: 0, fired: 0, enqueued: 0 });
    expect(fake.jobs).toHaveLength(0);
  });

  it("does not refire before the interval elapses", async () => {
    fake.automations.push(makeAutomation());
    fake.jobs.push({
      id: "job-old",
      organizationId: "org-A",
      name: "research.lead",
      payload: { automationId: "ca" + "1".repeat(22) },
      status: "COMPLETED",
      createdAt: new Date(Date.now() - 10 * 60_000), // 10 min ago, interval 60
      updatedAt: new Date(),
    });
    const stats = await evaluateAutomations("org-A");
    expect(stats.enqueued).toBe(0);
    expect(stats.evaluated).toBe(0);
  });

  it("refires after the interval elapses", async () => {
    fake.automations.push(makeAutomation());
    fake.jobs.push({
      id: "job-old",
      organizationId: "org-A",
      name: "research.lead",
      payload: { automationId: "ca" + "1".repeat(22) },
      status: "COMPLETED",
      createdAt: new Date(Date.now() - 61 * 60_000),
      updatedAt: new Date(),
    });
    const stats = await evaluateAutomations("org-A");
    expect(stats.enqueued).toBe(1);
  });

  it("skips when conditions fail", async () => {
    fake.automations.push(
      makeAutomation({
        conditions: [{ id: "cd" + "1".repeat(22), automationId: "ca" + "1".repeat(22), order: 0, field: "trigger", operator: "eq", value: "manual" }],
      }),
    );
    const stats = await evaluateAutomations("org-A");
    expect(stats).toMatchObject({ fired: 0, enqueued: 0, skipped: 1 });
  });

  it("skips unknown action types safely with an audit record", async () => {
    fake.automations.push(
      makeAutomation({
        actions: [
          { id: "cb" + "x".repeat(22), automationId: "ca" + "1".repeat(22), order: 0, type: "teleport-lead", config: {}, requiresApproval: false },
        ],
      }),
    );
    const stats = await evaluateAutomations("org-A");
    expect(stats.enqueued).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(
      fake.auditCalls.some((c) => c.data.action === "automation.action_skipped"),
    ).toBe(true);
  });

  it("refuses sending actions in Phase 3", async () => {
    for (const sendType of ["send-email", "send-whatsapp", "send-telegram"]) {
      fake.reset();
      fake.automations.push(
        makeAutomation({
          actions: [
            { id: "cb" + "s".repeat(22), automationId: "ca" + "1".repeat(22), order: 0, type: sendType, config: {}, requiresApproval: true },
          ],
        }),
      );
      const stats = await evaluateAutomations("org-A");
      expect(stats.enqueued).toBe(0);
      expect(fake.jobs).toHaveLength(0);
    }
    const skips = fake.auditCalls.filter((c) => c.data.action === "automation.action_skipped");
    expect(skips[0].data.metadata.reason).toMatch(/not implemented/);
  });

  it("skips actions whose config fails job validation", async () => {
    fake.automations.push(
      makeAutomation({
        actions: [
          // research.lead requires leadId — empty config fails validation.
          { id: "cb" + "9".repeat(22), automationId: "ca" + "1".repeat(22), order: 0, type: "research-lead", config: {}, requiresApproval: false },
        ],
      }),
    );
    const stats = await evaluateAutomations("org-A");
    expect(stats.enqueued).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(
      fake.auditCalls.some((c) => c.data.action === "automation.action_failed"),
    ).toBe(true);
  });

  it("ignores non-schedule triggers on tick", async () => {
    fake.automations.push(
      makeAutomation({
        triggers: [
          { id: "ct" + "e".repeat(22), automationId: "ca" + "1".repeat(22), type: "new-lead", config: {} },
          { id: "ct" + "m".repeat(22), automationId: "ca" + "1".repeat(22), type: "manual", config: {} },
        ],
      }),
    );
    const stats = await evaluateAutomations("org-A");
    expect(stats.evaluated).toBe(0);
    expect(fake.jobs).toHaveLength(0);
  });

  it("is scoped to the requested organization", async () => {
    fake.automations.push(makeAutomation());
    fake.automations.push(makeAutomation({ id: "ca" + "2".repeat(22), organizationId: "org-B" }));
    const stats = await evaluateAutomations("org-B");
    expect(stats.enqueued).toBe(1);
    expect(fake.jobs[0].organizationId).toBe("org-B");
  });
});
