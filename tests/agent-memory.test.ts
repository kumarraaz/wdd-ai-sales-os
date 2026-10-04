/**
 * Agent memory tests (Phase 5).
 *
 * The DB is faked in-memory (repo convention: DB-gated tests are skipped
 * without DATABASE_URL; unit tests mock ../lib/db). No live services.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// ── In-memory fake ─────────────────────────────────────────────────────
const fake = vi.hoisted(() => {
  const rows: any[] = [];
  const leads: any[] = [];
  const auditCalls: any[] = [];
  let seq = 0;
  return {
    rows,
    leads,
    auditCalls,
    reset() {
      rows.length = 0;
      leads.length = 0;
      auditCalls.length = 0;
      seq = 0;
    },
    seedLead(id: string, organizationId: string) {
      leads.push({ id, organizationId });
    },
    expire(id: string) {
      const r = rows.find((x) => x.id === id);
      if (r) r.expiresAt = new Date(Date.now() - 1000);
    },
    db: {
      agentMemory: {
        findFirst: vi.fn(async ({ where }: any = {}) => {
          return (
            rows.find(
              (r) =>
                (!where.organizationId || r.organizationId === where.organizationId) &&
                (!where.scope || r.scope === where.scope) &&
                (!where.scopeId || r.scopeId === where.scopeId) &&
                (!where.key || r.key === where.key),
            ) ?? null
          );
        }),
        findMany: vi.fn(async ({ where = {}, take }: any = {}) => {
          let out = rows.filter((r) => {
            if (where.organizationId && r.organizationId !== where.organizationId) return false;
            if (where.scope && r.scope !== where.scope) return false;
            if (where.scopeId && r.scopeId !== where.scopeId) return false;
            if (where.OR) {
              const ok = where.OR.some(
                (c: any) =>
                  (c.expiresAt === null && r.expiresAt === null) ||
                  (c.expiresAt?.gt && r.expiresAt instanceof Date && r.expiresAt > c.expiresAt.gt),
              );
              if (!ok) return false;
            }
            if (where.key?.startsWith && !r.key.startsWith(where.key.startsWith)) return false;
            return true;
          });
          out = [...out].sort(
            (a, b) =>
              b.updatedAt.getTime() - a.updatedAt.getTime() || (a.key < b.key ? -1 : 1),
          );
          if (take) out = out.slice(0, take);
          return out.map((r) => ({ ...r }));
        }),
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const u = where.organizationId_scope_scopeId_key;
          let row = rows.find(
            (r) =>
              r.organizationId === u.organizationId &&
              r.scope === u.scope &&
              r.scopeId === u.scopeId &&
              r.key === u.key,
          );
          if (row) {
            Object.assign(row, update, { updatedAt: new Date() });
          } else {
            row = { id: `mem-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
            rows.push(row);
          }
          return { ...row };
        }),
        deleteMany: vi.fn(async ({ where = {} }: any = {}) => {
          let count = 0;
          for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            if (where.organizationId && r.organizationId !== where.organizationId) continue;
            if (where.scope && r.scope !== where.scope) continue;
            if (where.scopeId && r.scopeId !== where.scopeId) continue;
            if (where.expiresAt?.lte && r.expiresAt instanceof Date && r.expiresAt <= where.expiresAt.lte) {
              rows.splice(i, 1);
              count++;
            }
          }
          return { count };
        }),
      },
      lead: {
        findFirst: vi.fn(async ({ where }: any = {}) => {
          return leads.find((l) => l.id === where.id && l.organizationId === where.organizationId) ?? null;
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
import {
  remember,
  recall,
  recallRun,
  summarizeRun,
  resolveExpiresAt,
  isSecretKey,
  MemoryError,
  MEMORY_MAX_VALUE_BYTES,
  MEMORY_MAX_RECALL_ITEMS,
  MEMORY_MAX_RUN_SUMMARY_BYTES,
  MEMORY_DEFAULT_RUN_TTL_SECONDS,
  MEMORY_MIN_TTL_SECONDS,
  MEMORY_MAX_TTL_SECONDS,
} from "../lib/agent/memory";
import type { WorkspaceContext } from "../lib/tenant";
import type { AgentRunResult } from "../lib/agent/types";

function makeCtx(orgId: string): WorkspaceContext {
  return {
    user: { id: "user-1", email: "u@example.com", name: "U" },
    organization: { id: orgId, name: `Org ${orgId}`, slug: orgId },
    membership: { id: "m1", role: "SALES_MANAGER" },
  };
}
const ctxA = makeCtx("org-A");
const ctxB = makeCtx("org-B");

afterEach(() => {
  fake.reset();
  vi.clearAllMocks();
});

function completedResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    runId: "run-1",
    status: "COMPLETED",
    goal: "Find manufacturers",
    steps: [],
    toolCalls: [
      {
        seq: 1,
        tool: "discovery.search",
        status: "success",
        startedAt: new Date().toISOString(),
        durationMs: 10,
        summary: "discovery.search succeeded.",
      },
    ],
    pendingApproval: null,
    summary: "Outcome: completed.\nTool calls: 1 (1 succeeded, 0 failed).",
    budgets: { maxSteps: 20, maxToolCalls: 20, maxPlanSteps: 20, maxRuntimeMs: 120000 },
    usage: { steps: 2, toolCalls: 1, runtimeMs: 100 },
    ...overrides,
  };
}

describe("remember", () => {
  it("creates a memory record", async () => {
    const res = await remember(ctxA, {
      scope: "ORG",
      scopeId: "org-A",
      key: "icp.industries",
      value: { industries: ["Manufacturing", "Textiles"] },
      provenance: "USER PROVIDED",
    });
    expect(res).toMatchObject({ key: "icp.industries", scope: "ORG", updated: false });
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].organizationId).toBe("org-A");
    expect(fake.auditCalls.some((c) => c.data.action === "memory.created")).toBe(true);
  });

  it("upserts the same key", async () => {
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "icp.note", value: { v: 1 } });
    const res = await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "icp.note", value: { v: 2 } });
    expect(res.updated).toBe(true);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].value.data).toMatchObject({ v: 2 });
    expect(fake.auditCalls.some((c) => c.data.action === "memory.updated")).toBe(true);
  });

  it("derives organizationId from ctx, never the caller", async () => {
    // There is no organizationId field to smuggle: strict schema rejects it.
    await expect(
      remember(ctxA, {
        scope: "ORG",
        scopeId: "org-A",
        key: "k",
        value: { v: 1 },
        organizationId: "org-evil",
      } as any),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "k2", value: { v: 1 } });
    expect(fake.rows[0].organizationId).toBe("org-A");
  });

  it("rejects ORG scopeId mismatch", async () => {
    await expect(
      remember(ctxA, { scope: "ORG", scopeId: "org-B", key: "k", value: { v: 1 } }),
    ).rejects.toMatchObject({ code: "SCOPE_MISMATCH" });
  });

  it("rejects invalid scopes", async () => {
    await expect(
      remember(ctxA, { scope: "GLOBAL", scopeId: "x", key: "k", value: {} } as any),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects invalid keys", async () => {
    await expect(
      remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "has spaces", value: {} }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "$ne", value: {} }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects oversized values", async () => {
    const big = { blob: "x".repeat(MEMORY_MAX_VALUE_BYTES + 1) };
    await expect(
      remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "big", value: big }),
    ).rejects.toMatchObject({ code: "VALUE_TOO_LARGE" });
  });

  it("rejects non-JSON values", async () => {
    const circular: any = { a: 1 };
    circular.self = circular;
    await expect(
      remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "circ", value: circular }),
    ).rejects.toMatchObject({ code: "VALUE_NOT_JSON" });
  });
});

describe("secret protection", () => {
  it("rejects secret-like keys", async () => {
    for (const key of ["api_key", "apiKey", "password", "secretToken", "clientSecret", "webhook_secret", "authToken", "private_key"]) {
      await expect(
        remember(ctxA, { scope: "ORG", scopeId: "org-A", key, value: { v: 1 } }),
      ).rejects.toMatchObject({ code: "SECRET_KEY_REJECTED" });
    }
    expect(fake.rows).toHaveLength(0);
    expect(fake.auditCalls.some((c) => c.data.action === "memory.rejected")).toBe(true);
  });

  it("rejects secret-like nested value keys", async () => {
    await expect(
      remember(ctxA, {
        scope: "ORG",
        scopeId: "org-A",
        key: "notes",
        value: { contact: { password: "hunter2" } },
      }),
    ).rejects.toMatchObject({ code: "SECRET_KEY_REJECTED" });
  });

  it("rejects high-confidence credential values", async () => {
    const bad = [
      "Bearer abcdefgh12345678",
      "sk-live-abcdefgh12345678",
      "ghp_abcdefghijklmnopqrstuv",
      "AIzaSyAbcdefghijklmnopqrstuvwx",
      "xoxb-1234567890-abcdefghij",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIB",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart",
    ];
    for (const secret of bad) {
      await expect(
        remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "note", value: { text: secret } }),
      ).rejects.toMatchObject({ code: "SECRET_VALUE_REJECTED" });
    }
    expect(fake.rows).toHaveLength(0);
  });

  it("accepts normal sales data (low false positives)", async () => {
    const good = [
      { key: "contact.preference", value: { channel: "WhatsApp", note: "Prefers WhatsApp over email" } },
      { key: "company.secretary", value: { note: "Spoke to the secretary" } }, // "secretary" ≠ "secret"
      { key: "lead.phone", value: { phone: "+91-98765-43210" } },
      { key: "icp.note", value: { text: "Token of appreciation sent" } }, // "token" as English word in text
      { key: "followup.date", value: { date: "2026-10-10" } },
    ];
    for (const g of good) {
      await remember(ctxA, { scope: "ORG", scopeId: "org-A", ...g });
    }
    expect(fake.rows).toHaveLength(good.length);
  });

  it("isSecretKey unit checks", () => {
    expect(isSecretKey("apiKey")).toBe(true);
    expect(isSecretKey("webhook_secret")).toBe(true);
    expect(isSecretKey("secretary")).toBe(false);
    expect(isSecretKey("keyboard")).toBe(false);
    expect(isSecretKey("icp.industries")).toBe(false);
  });
});

describe("TTL", () => {
  it("calculates expiresAt from ttlSeconds", async () => {
    const before = Date.now();
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "k", value: {}, ttlSeconds: 3600 });
    const expiresAt = fake.rows[0].expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
  });

  it("RUN memories default to a short TTL", () => {
    const exp = resolveExpiresAt("RUN", undefined);
    expect(exp).not.toBeNull();
    const days = (exp!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
  });

  it("ORG/LEAD memories persist without explicit TTL", () => {
    expect(resolveExpiresAt("ORG", undefined)).toBeNull();
    expect(resolveExpiresAt("LEAD", undefined)).toBeNull();
  });

  it("rejects absurd TTL values", async () => {
    await expect(
      remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "k", value: {}, ttlSeconds: 10 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" }); // below minimum
    await expect(
      remember(ctxA, {
        scope: "ORG",
        scopeId: "org-A",
        key: "k",
        value: {},
        ttlSeconds: MEMORY_MAX_TTL_SECONDS + 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" }); // above maximum
    expect(resolveExpiresAt("ORG", MEMORY_MIN_TTL_SECONDS)).not.toBeNull();
  });

  it("never returns expired memory (and lazily deletes it)", async () => {
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "temp", value: { v: 1 }, ttlSeconds: 60 });
    const id = fake.rows[0].id;
    fake.expire(id);
    const out = await recall(ctxA, "ORG", "org-A");
    expect(out).toHaveLength(0);
    expect(fake.rows).toHaveLength(0); // lazily deleted
    expect(fake.auditCalls.some((c) => c.data.action === "memory.expired")).toBe(true);
  });
});

describe("recall", () => {
  it("is tenant isolated", async () => {
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "k", value: { v: "A" } });
    expect(await recall(ctxB, "ORG", "org-B")).toHaveLength(0);
    expect(await recall(ctxA, "ORG", "org-A")).toHaveLength(1);
  });

  it("rejects ORG scopeId mismatch on recall", async () => {
    await expect(recall(ctxA, "ORG", "org-B")).rejects.toMatchObject({ code: "SCOPE_MISMATCH" });
  });

  it("is bounded with a hard maximum", async () => {
    for (let i = 0; i < 25; i++) {
      await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: `k${i}`, value: { i } });
    }
    // The schema itself rejects absurd limits…
    await expect(recall(ctxA, "ORG", "org-A", { limit: 1000 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    // …and the hard cap bounds even a max-limit recall.
    const out = await recall(ctxA, "ORG", "org-A", { limit: MEMORY_MAX_RECALL_ITEMS });
    expect(out).toHaveLength(MEMORY_MAX_RECALL_ITEMS);
    const def = await recall(ctxA, "ORG", "org-A");
    expect(def.length).toBeLessThanOrEqual(5);
  });

  it("orders deterministically", async () => {
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "b", value: {} });
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "a", value: {} });
    const out = await recall(ctxA, "ORG", "org-A", { limit: 10 });
    expect(out.map((r) => r.key)).toEqual(["a", "b"]); // same updatedAt → key asc
  });

  it("supports keyPrefix filtering", async () => {
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "icp.a", value: {} });
    await remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "other.b", value: {} });
    const out = await recall(ctxA, "ORG", "org-A", { keyPrefix: "icp." });
    expect(out.map((r) => r.key)).toEqual(["icp.a"]);
  });

  it("unwraps the envelope and preserves provenance", async () => {
    await remember(ctxA, {
      scope: "ORG",
      scopeId: "org-A",
      key: "fact.website",
      value: { hasWebsite: false },
      provenance: "VERIFIED DATA",
      source: "research.website",
      sourceUrl: "https://example.com",
    });
    const [rec] = await recall(ctxA, "ORG", "org-A");
    expect(rec).toMatchObject({
      key: "fact.website",
      value: { hasWebsite: false },
      provenance: "VERIFIED DATA",
      source: "research.website",
      sourceUrl: "https://example.com",
    });
    expect(rec.observedAt).toBeTruthy();
  });
});

describe("LEAD scope", () => {
  it("verifies lead ownership on write and read", async () => {
    fake.seedLead("lead-1", "org-A");
    await remember(ctxA, {
      scope: "LEAD",
      scopeId: "lead-1",
      key: "fact.no_website",
      value: { hasWebsite: false },
      provenance: "VERIFIED DATA",
    });
    expect(await recall(ctxA, "LEAD", "lead-1")).toHaveLength(1);
    // Cross-tenant access rejected both ways.
    await expect(
      remember(ctxB, { scope: "LEAD", scopeId: "lead-1", key: "x", value: {} }),
    ).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
    await expect(recall(ctxB, "LEAD", "lead-1")).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
    await expect(
      remember(ctxA, { scope: "LEAD", scopeId: "lead-ghost", key: "x", value: {} }),
    ).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
  });
});

describe("RUN scope", () => {
  it("isolates run memories by runId", async () => {
    await remember(ctxA, { scope: "RUN", scopeId: "run-1", key: "run.summary", value: { s: 1 } });
    await remember(ctxA, { scope: "RUN", scopeId: "run-2", key: "run.summary", value: { s: 2 } });
    const out = await recallRun(ctxA, "run-1");
    expect(out).toHaveLength(1);
    expect(out[0].value).toMatchObject({ s: 1 });
    // Another org cannot read it.
    expect(await recallRun(ctxB, "run-1")).toHaveLength(0);
  });
});

describe("summarizeRun", () => {
  it("produces a bounded deterministic summary without hidden reasoning", () => {
    const summary = summarizeRun(completedResult());
    const allowed = new Set([
      "goal",
      "runId",
      "status",
      "completedAt",
      "toolCallCounts",
      "toolOutcomes",
      "deferredJobs",
      "pendingApproval",
      "notableFailures",
      "nextUsefulAction",
      "agentClosingNote",
    ]);
    for (const key of Object.keys(summary)) {
      expect(allowed.has(key)).toBe(true);
    }
    expect(summary).toMatchObject({
      goal: "Find manufacturers",
      status: "COMPLETED",
      toolCallCounts: { total: 1, succeeded: 1, failed: 0, deferred: 0 },
    });
    expect(summary.toolOutcomes).toEqual(["discovery.search: success"]);
  });

  it("marks model-generated content as AI INFERENCE", () => {
    const summary = summarizeRun(
      completedResult({
        summary: "Outcome: completed.\nAgent note (model-generated, unverified): Found 50 amazing leads!!!",
      }),
    );
    expect(summary.agentClosingNote).toMatchObject({
      text: "Found 50 amazing leads!!!",
      provenance: "AI INFERENCE",
    });
  });

  it("captures approvals, deferrals, and failures", () => {
    const summary = summarizeRun(
      completedResult({
        status: "WAITING_FOR_APPROVAL",
        pendingApproval: {
          tool: "outreach.createDraft",
          input: {},
          reason: "Need approval",
          requiresApproval: true,
        },
        toolCalls: [
          {
            seq: 1,
            tool: "discovery.search",
            status: "deferred_to_job",
            startedAt: new Date().toISOString(),
            durationMs: 5,
            summary: "deferred",
            jobId: "job-9",
          },
          {
            seq: 2,
            tool: "research.website",
            status: "failed",
            startedAt: new Date().toISOString(),
            durationMs: 5,
            summary: "research.website failed (TIMEOUT).",
          },
        ],
      }),
    );
    expect(summary.pendingApproval).toMatchObject({ tool: "outreach.createDraft" });
    expect(summary.deferredJobs).toEqual([{ tool: "discovery.search", jobId: "job-9" }]);
    expect((summary.notableFailures as unknown[])).toHaveLength(1);
    expect(summary.nextUsefulAction).toContain("outreach.createDraft");
  });

  it("stays within the byte bound", () => {
    const hugeNote = "x".repeat(20_000);
    const summary = summarizeRun(
      completedResult({
        summary: `Outcome: completed.\nAgent note (model-generated, unverified): ${hugeNote}`,
        toolCalls: Array.from({ length: 30 }, (_, i) => ({
          seq: i + 1,
          tool: `tool.${i}`,
          status: "success" as const,
          startedAt: new Date().toISOString(),
          durationMs: 1,
          summary: `${`tool.${i}`} succeeded.`,
        })),
      }),
    );
    expect(Buffer.byteLength(JSON.stringify(summary), "utf8")).toBeLessThanOrEqual(
      MEMORY_MAX_RUN_SUMMARY_BYTES,
    );
  });

  it("never persists raw tool output", () => {
    const summary = summarizeRun(completedResult());
    const json = JSON.stringify(summary);
    // toolOutcomes are "tool: status" labels only — no data payloads.
    for (const outcome of summary.toolOutcomes as string[]) {
      expect(outcome).toMatch(/^[\w.()-]+: [\w_]+( \(job [\w-]+\))?$/);
    }
    expect(json).not.toContain("chainOfThought");
    expect(json).not.toContain("prompt");
  });
});

describe("failure isolation", () => {
  it("wraps backend failures without leaking internals", async () => {
    (fake.db.agentMemory.upsert as any).mockRejectedValueOnce(new Error("connection reset by peer"));
    await expect(
      remember(ctxA, { scope: "ORG", scopeId: "org-A", key: "k", value: {} }),
    ).rejects.toMatchObject({ code: "MEMORY_BACKEND_FAILED" });
    (fake.db.agentMemory.findMany as any).mockRejectedValueOnce(new Error("boom"));
    await expect(recall(ctxA, "ORG", "org-A")).rejects.toMatchObject({
      code: "MEMORY_BACKEND_FAILED",
    });
    expect(
      fake.auditCalls.some((c) => c.data.action === "memory.failed"),
    ).toBe(true);
  });

  it("does not expose MemoryError internals beyond code+message", async () => {
    const err = await remember(ctxA, {
      scope: "ORG",
      scopeId: "org-A",
      key: "k",
      value: {},
      ttlSeconds: 5,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MemoryError);
    expect(err.code).toBe("INVALID_INPUT");
    expect(String(err.message)).not.toContain("at ");
  });
});
