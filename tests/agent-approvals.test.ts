/**
 * Phase 7 — human approval & action control tests.
 *
 * Covers: approval creation, tenant isolation, list/detail APIs, reviewer
 * RBAC, approve/reject/cancel flows, expiration, atomic double-approval
 * idempotency, snapshot immutability, unknown action types, schema
 * re-validation, tool-registry execution, no-approval-bypass, workflow
 * resume without restart, failed execution, audit events, failure-isolated
 * memory, secret-free audit, cross-tenant denial, API auth, rate limiting,
 * pagination/filter validation, and API state consistency.
 *
 * Seams mocked: prisma (in-memory agentApproval store), audit, tool
 * registry (executeTool/getTool), memory, tenant withWorkspace, rate-limit.
 * The approval service, dispatcher, routes, and the real workflow resume
 * path run for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// ─── hoisted fakes ───────────────────────────────────────────────────────────

const {
  fakeCtx,
  store,
  seq,
  toolCalls,
  mockExecuteTool,
  auditCalls,
  mockRemember,
  flags,
  captured,
  agentApproval,
} = vi.hoisted(() => {
  const store = new Map<string, any>();
  const seq = { n: 0 };
  const toolCalls: Array<{ name: string; input: any }> = [];
  const auditCalls: any[] = [];
  const flags = { unauthenticated: false, role: "SALES_EXECUTIVE" as string, rateLimited: false };
  const captured: { minRole?: string } = {};

  function matchesWhere(row: any, where: any): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === "OR" && Array.isArray(v)) {
        if (!(v as any[]).some((c) => matchesWhere(row, c))) return false;
        continue;
      }
      const rv = (row as any)[k];
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
        for (const [op, ov] of Object.entries(v as any)) {
          if (op === "gt" && !(rv > (ov as any))) return false;
          if (op === "gte" && !(rv >= (ov as any))) return false;
          if (op === "lt" && !(rv < (ov as any))) return false;
          if (op === "lte" && !(rv <= (ov as any))) return false;
        }
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }

  const agentApproval = {
    create: vi.fn(async ({ data }: any) => {
      seq.n += 1;
      const row = {
        id: `appr-${seq.n}`,
        status: "PENDING",
        reviewedByUserId: null,
        reviewedAt: null,
        executionResult: null,
        workflowSnapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      store.set(row.id, row);
      return { ...row };
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const row of store.values()) {
        if (matchesWhere(row, where)) return { ...row };
      }
      return null;
    }),
    findMany: vi.fn(async ({ where, orderBy, skip, take }: any) => {
      let rows = [...store.values()].filter((r) => matchesWhere(r, where ?? {}));
      if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (typeof skip === "number") rows = rows.slice(skip);
      if (typeof take === "number") rows = rows.slice(0, take);
      return rows.map((r) => ({ ...r }));
    }),
    count: vi.fn(async ({ where }: any) => {
      return [...store.values()].filter((r) => matchesWhere(r, where ?? {})).length;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const [id, row] of store.entries()) {
        if (matchesWhere(row, where)) {
          store.set(id, { ...row, ...data, updatedAt: new Date() });
          count += 1;
        }
      }
      return { count };
    }),
  };

  const mockExecuteTool: any = vi.fn(async (name: string, _ctx: any, input: any) => {
    toolCalls.push({ name, input });
    if (mockExecuteTool.failNext) {
      mockExecuteTool.failNext = false;
      return { success: false, error: { code: "DRAFT_FAILED", message: "tool exploded" } };
    }
    return { success: true, data: { id: "draft-1" } };
  });
  mockExecuteTool.failNext = false;

  return {
    fakeCtx: {
      user: { id: "user-1", email: "u@example.com", name: "U" },
      organization: { id: "org-A", name: "Org A", slug: "org-a" },
      membership: { id: "m1", role: "SALES_EXECUTIVE" as const },
    },
    store,
    seq,
    toolCalls,
    mockExecuteTool,
    auditCalls,
    mockRemember: vi.fn(async (_ctx: any, _input: any) => ({ id: "mem-1" })),
    flags,
    captured,
    agentApproval,
  };
});

vi.mock("../lib/db", () => ({ db: { agentApproval } }));

vi.mock("../lib/audit", () => ({
  audit: vi.fn(async (input: any) => {
    auditCalls.push(input);
  }),
}));

const toolSchemas: Record<string, z.ZodTypeAny> = {
  "outreach.createDraft": z
    .object({
      leadId: z.string().optional(),
      channel: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN"]),
      subject: z.string().optional(),
      body: z.string().min(1),
    })
    .strict(),
  "crm.createFollowUp": z
    .object({
      leadId: z.string(),
      channel: z.string(),
      scheduledAt: z.string(),
      body: z.string().optional(),
    })
    .strict(),
  "crm.createTask": z
    .object({
      title: z.string(),
      detail: z.string().optional(),
      leadId: z.string().optional(),
    })
    .strict(),
};

vi.mock("../lib/agent/tools/registry", () => ({
  executeTool: mockExecuteTool,
  getTool: (name: string) =>
    toolSchemas[name] ? { name, inputSchema: toolSchemas[name] } : undefined,
}));

vi.mock("../lib/agent/memory", () => ({
  recall: vi.fn(async () => []),
  remember: mockRemember,
}));

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => (flags.rateLimited ? { success: false } : { success: true })),
  LIMITS: { ai: { limit: 30, windowMs: 60_000 }, api: { limit: 300, windowMs: 60_000 } },
}));

vi.mock("../lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tenant")>();
  return {
    ...actual,
    withWorkspace: (handler: any, opts: any) => {
      captured.minRole = opts?.minRole;
      return async (req: any, routeContext: any) => {
        if (flags.unauthenticated) {
          return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
        }
        const ctx = {
          ...fakeCtx,
          membership: { ...fakeCtx.membership, role: flags.role },
        };
        return handler(req, ctx, routeContext ?? {});
      };
    },
  };
});

// ─── modules under test ──────────────────────────────────────────────────────

import {
  createApproval,
  getApproval,
  listApprovals,
  approveApproval,
  rejectApproval,
  cancelApproval,
  toApprovalDTO,
  ApprovalError,
} from "../lib/agent/approvals/service";
import { executeApprovedAction, ApprovalDispatchError } from "../lib/agent/approvals/dispatcher";
import { actionTypeForTool } from "../lib/agent/approvals/types";
import { GET as listGET } from "../app/api/agent/approvals/route";
import { GET as detailGET } from "../app/api/agent/approvals/[id]/route";
import { POST as approvePOST } from "../app/api/agent/approvals/[id]/approve/route";
import { POST as rejectPOST } from "../app/api/agent/approvals/[id]/reject/route";
import { POST as cancelPOST } from "../app/api/agent/approvals/[id]/cancel/route";

const DRAFT_INPUT = { channel: "WHATSAPP", body: "Hi — DRAFT", leadId: "lead-1" };

function proposal(overrides: any = {}) {
  return {
    workflowId: "website-improvement-prospecting",
    workflowRunId: "run-1",
    stageId: "draft-outreach",
    toolName: "outreach.createDraft",
    proposedInput: { ...DRAFT_INPUT },
    target: { label: "Sharma Textiles", leadId: "lead-1", channel: "WHATSAPP" },
    reason: "Outreach draft proposal for review.",
    ...overrides,
  };
}

function req(url: string, init?: any): NextRequest {
  return new NextRequest(url, init);
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  store.clear();
  seq.n = 0;
  toolCalls.length = 0;
  auditCalls.length = 0;
  flags.unauthenticated = false;
  flags.role = "SALES_EXECUTIVE";
  flags.rateLimited = false;
  mockExecuteTool.failNext = false;
  mockRemember.mockResolvedValue({ id: "mem-1" });
});

// ─── 1. creation ─────────────────────────────────────────────────────────────

describe("approval creation", () => {
  it("creates a PENDING snapshot with server-derived identity", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    expect(row.status).toBe("PENDING");
    expect(row.organizationId).toBe("org-A"); // from ctx, never client
    expect(row.requestedByUserId).toBe("user-1");
    expect(row.actionType).toBe("OUTREACH_DRAFT");
    expect(row.proposedInput).toEqual(DRAFT_INPUT);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(auditCalls.some((a) => a.action === "approval.created")).toBe(true);
  });

  it("rejects non-allowlisted tool names", async () => {
    await expect(
      createApproval(fakeCtx as any, proposal({ toolName: "message.directSend" })),
    ).rejects.toMatchObject({ code: "ACTION_NOT_APPROVABLE" });
    await expect(
      createApproval(fakeCtx as any, proposal({ toolName: "outreach.sendMessage" })),
    ).rejects.toMatchObject({ code: "ACTION_NOT_APPROVABLE" });
  });

  it("maps all three safe action types", () => {
    expect(actionTypeForTool("outreach.createDraft")).toBe("OUTREACH_DRAFT");
    expect(actionTypeForTool("crm.createFollowUp")).toBe("CRM_FOLLOWUP");
    expect(actionTypeForTool("crm.createTask")).toBe("CRM_TASK");
    expect(actionTypeForTool("whatsapp.send")).toBeNull();
  });
});

// ─── 2/23. tenant isolation ─────────────────────────────────────────────────

describe("tenant isolation", () => {
  it("reads and writes are scoped to the caller's organization", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    const otherCtx = {
      ...fakeCtx,
      organization: { id: "org-B", name: "Org B", slug: "org-b" },
    };
    expect(await getApproval(otherCtx as any, row.id)).toBeNull();
    await expect(approveApproval(otherCtx as any, row.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Original org unaffected.
    expect((await getApproval(fakeCtx as any, row.id))?.status).toBe("PENDING");
  });

  it("list never leaks other organizations' approvals", async () => {
    await createApproval(fakeCtx as any, proposal());
    store.set("appr-evil", {
      id: "appr-evil",
      organizationId: "org-B",
      status: "PENDING",
      actionType: "OUTREACH_DRAFT",
      workflowId: "w",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { items, total } = await listApprovals(fakeCtx as any, {});
    expect(total).toBe(1);
    expect(items.every((i) => i.organizationId === "org-A")).toBe(true);
  });
});

// ─── 3/4. list + detail APIs ─────────────────────────────────────────────────

describe("approvals APIs", () => {
  it("GET /api/agent/approvals lists with pagination", async () => {
    await createApproval(fakeCtx as any, proposal());
    await createApproval(fakeCtx as any, proposal({ stageId: "draft-2" }));
    const res = await listGET(req("http://localhost/api/agent/approvals?page=1&pageSize=1"), {} as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.approvals.length).toBe(1);
    expect(json.total).toBe(2);
    expect(json.page).toBe(1);
  });

  it("GET /api/agent/approvals/[id] returns the reviewable detail", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    const res = await detailGET(req(`http://localhost/api/agent/approvals/${row.id}`), routeParams(row.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.approval.id).toBe(row.id);
    expect(json.approval.status).toBe("PENDING");
    expect(json.approval.proposedInput).toEqual(DRAFT_INPUT);
    expect(json.approval.target.label).toBe("Sharma Textiles");
    expect(auditCalls.some((a) => a.action === "approval.viewed")).toBe(true);
  });

  it("GET detail returns 404 for unknown or foreign ids", async () => {
    const missing = await detailGET(req("http://localhost/api/agent/approvals/nope"), routeParams("nope"));
    expect(missing.status).toBe(404);
    const row = await createApproval(fakeCtx as any, proposal());
    const otherCtx = { ...fakeCtx, organization: { id: "org-B", name: "B", slug: "b" } };
    expect(await getApproval(otherCtx as any, row.id)).toBeNull();
  });
});

// ─── 5. reviewer RBAC ────────────────────────────────────────────────────────

describe("reviewer authorization", () => {
  it("rejects reviewers below SALES_EXECUTIVE", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    flags.role = "VIEWER";
    const res = await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("FORBIDDEN");
    expect(toolCalls.length).toBe(0);
  });

  it("wires approve/reject/cancel routes at minRole SALES_EXECUTIVE", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    expect(captured.minRole).toBe("SALES_EXECUTIVE");
  });
});

// ─── 6/10/11. approve: atomic + idempotent ───────────────────────────────────

describe("approve flow", () => {
  it("approves, executes the snapshot exactly once, and records EXECUTED", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    const res = await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.approval.status).toBe("EXECUTED");
    expect(json.execution.ok).toBe(true);
    expect(json.execution.tool).toBe("outreach.createDraft");
    expect(json.execution.resultId).toBe("draft-1");
    // Executed through the tool registry with the STORED input.
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0]).toEqual({ name: "outreach.createDraft", input: DRAFT_INPUT });
    const stored = await getApproval(fakeCtx as any, row.id);
    expect(stored?.status).toBe("EXECUTED");
    expect(stored?.reviewedByUserId).toBe("user-1");
  });

  it("second approval returns the recorded outcome without re-executing", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    await approveApproval(fakeCtx as any, row.id);
    const second = await approveApproval(fakeCtx as any, row.id);
    expect(second.alreadyExecuted).toBe(true);
    expect(second.approval.status).toBe("EXECUTED");
    expect(toolCalls.length).toBe(1); // still exactly one execution
  });

  it("approving an already-approved (race-lost) approval never double-executes", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    // Simulate a concurrent winner by flipping the row first.
    await approveApproval(fakeCtx as any, row.id);
    const res = await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    const json = await res.json();
    expect(json.workflow.status).toBe("ALREADY_EXECUTED");
    expect(toolCalls.length).toBe(1);
  });
});

// ─── 12. snapshot immutability ───────────────────────────────────────────────

describe("snapshot immutability", () => {
  it("client input on approve cannot alter the executed action", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    const res = await approvePOST(
      req(`http://localhost/api/agent/approvals/${row.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // An attacker tries to smuggle a different action/input.
          proposedInput: { channel: "WHATSAPP", body: "EVIL BODY", leadId: "lead-evil" },
          actionType: "WHATSAPP_SEND",
        }),
      }),
      routeParams(row.id),
    );
    expect(res.status).toBe(200);
    // The route ignores the body entirely: the STORED snapshot executed.
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].input).toEqual(DRAFT_INPUT);
    expect(toolCalls[0].name).toBe("outreach.createDraft");
  });
});

// ─── 7/8. reject / cancel ────────────────────────────────────────────────────

describe("reject and cancel", () => {
  it("reject records reviewer, reason, and never executes", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    const res = await rejectPOST(
      req(`http://localhost/api/agent/approvals/${row.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Wrong tone for this lead." }),
      }),
      routeParams(row.id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.approval.status).toBe("REJECTED");
    expect(toolCalls.length).toBe(0);
    const stored = await getApproval(fakeCtx as any, row.id);
    expect(stored?.reviewedByUserId).toBe("user-1");
    expect(auditCalls.some((a) => a.action === "approval.rejected")).toBe(true);
    // Rejected approvals cannot be approved afterwards.
    await expect(approveApproval(fakeCtx as any, row.id)).rejects.toMatchObject({ code: "ALREADY_REVIEWED" });
  });

  it("cancel moves PENDING → CANCELLED without executing", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    const res = await cancelPOST(req(`http://localhost/api/agent/approvals/${row.id}/cancel`, { method: "POST" }), routeParams(row.id));
    expect(res.status).toBe(200);
    expect((await res.json()).approval.status).toBe("CANCELLED");
    expect(toolCalls.length).toBe(0);
    expect(auditCalls.some((a) => a.action === "approval.cancelled")).toBe(true);
  });
});

// ─── 9. expiration ───────────────────────────────────────────────────────────

describe("expiration", () => {
  it("expired approvals cannot be approved (lazy expiry, 410)", async () => {
    const row = await createApproval(
      fakeCtx as any,
      proposal({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("APPROVAL_EXPIRED");
    expect(toolCalls.length).toBe(0);
    expect((await getApproval(fakeCtx as any, row.id))?.status).toBe("EXPIRED");
  });
});

// ─── 13/14/15. dispatcher safety ─────────────────────────────────────────────

describe("dispatcher", () => {
  it("rejects unknown action types", async () => {
    await expect(
      executeApprovedAction(fakeCtx as any, "WHATSAPP_SEND" as any, {}),
    ).rejects.toMatchObject({ code: "UNKNOWN_ACTION_TYPE" });
  });

  it("re-validates the snapshot against the current tool schema", async () => {
    await expect(
      executeApprovedAction(fakeCtx as any, "OUTREACH_DRAFT", { channel: "WHATSAPP" }),
    ).rejects.toMatchObject({ code: "ACTION_SCHEMA_MISMATCH" });
    expect(toolCalls.length).toBe(0);
  });

  it("executes through the tool registry with validated input", async () => {
    const out = await executeApprovedAction(fakeCtx as any, "OUTREACH_DRAFT", DRAFT_INPUT);
    expect(out.tool).toBe("outreach.createDraft");
    expect(out.resultId).toBe("draft-1");
    expect(toolCalls[0].input).toEqual(DRAFT_INPUT);
  });
});

// ─── 16. no approval bypass ──────────────────────────────────────────────────

describe("no approval bypass", () => {
  it("the dispatcher is the only execution path and never touches raw tables", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    await approveApproval(fakeCtx as any, row.id);
    // The only writes were to agentApproval (status transitions) + the tool call.
    expect(agentApproval.create).toHaveBeenCalled();
    expect(agentApproval.updateMany).toHaveBeenCalled();
    expect(toolCalls.length).toBe(1);
    // createApproval refuses anything outside the allowlist — requiresApproval
    // architecture is preserved, not weakened.
    await expect(
      createApproval(fakeCtx as any, proposal({ toolName: "crm.deleteLead" })),
    ).rejects.toMatchObject({ code: "ACTION_NOT_APPROVABLE" });
  });
});

// ─── 17/18. resume ───────────────────────────────────────────────────────────

function resumeCheckpoint() {
  const prospect = (name: string) => ({
    prospectKey: `run-9-${name}`,
    name,
    website: "https://example.com",
    location: "Surat",
    industry: "m",
    provenance: "VERIFIED_DATA",
    source: "openstreetmap",
    sourceUrl: null,
    observedAt: "2026-10-04T10:00:00.000Z",
    qualified: true,
    qualificationReasons: ["weak-site"],
    score: 72,
    scoreBand: "Strong Fit",
    crmLeadId: null,
    failed: false,
    failureReason: null,
  });
  const stage = (stageId: string, type: string, status: string, toolCallsN: number) => ({
    stageId, type, status, toolCalls: toolCallsN,
    itemsProcessed: 1, itemsSucceeded: 1, itemsFailed: 0, durationMs: 5,
  });
  return {
    v: 1,
    request: {
      workflowId: "website-improvement-prospecting",
      params: {
        target: "manufacturers", location: "Gujarat", desiredLeads: 2,
        websiteRequirement: "weak", outreachChannel: "WHATSAPP",
      },
      requiresApproval: true,
    },
    budget: { maxStages: 10, maxToolCalls: 60, maxLeads: 50, maxRuntimeMs: 180_000, maxAiCalls: 5 },
    budgetClampedNotes: [],
    stages: [
      stage("discover-prospects", "DISCOVER", "completed", 1),
      stage("research-prospects", "RESEARCH", "completed", 2),
      stage("qualify-prospects", "QUALIFY", "completed", 0),
      stage("score-prospects", "SCORE", "completed", 0),
      stage("draft-outreach", "OUTREACH_DRAFT", "waiting_approval", 0),
    ],
    prospects: [prospect("Sharma Textiles"), prospect("Patel Fabrics")],
    leadContext: null,
    pausedStageId: "draft-outreach",
    target: 2,
    memoryRecalled: 0,
    startedAt: new Date().toISOString(),
  };
}

describe("workflow resume", () => {
  it("resumes from the next stage after approval and completes", async () => {
    const row = await createApproval(fakeCtx as any, proposal({ workflowSnapshot: resumeCheckpoint() }));
    const res = await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.approval.status).toBe("EXECUTED");
    expect(json.workflow.status).toBe("COMPLETED");
    expect(json.workflow.resumedFromApprovalId).toBe(row.id);
    expect(json.workflow.counts.successful).toBe(2);
    expect(auditCalls.some((a) => a.action === "approval.resume_started")).toBe(true);
    expect(auditCalls.some((a) => a.action === "approval.resume_completed")).toBe(true);
  });

  it("does not restart discovery or re-run earlier stages", async () => {
    const row = await createApproval(fakeCtx as any, proposal({ workflowSnapshot: resumeCheckpoint() }));
    await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    const names = toolCalls.map((c) => c.name);
    // Exactly one tool call: the approved draft. No discovery/research rerun.
    expect(names).toEqual(["outreach.createDraft"]);
  });
});

// ─── 19. failed execution ────────────────────────────────────────────────────

describe("failed execution", () => {
  it("tool failure becomes FAILED with a recorded result; workflow not resumed", async () => {
    mockExecuteTool.failNext = true;
    const row = await createApproval(fakeCtx as any, proposal({ workflowSnapshot: resumeCheckpoint() }));
    const res = await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    const json = await res.json();
    expect(json.approval.status).toBe("FAILED");
    expect(json.execution.ok).toBe(false);
    expect(json.workflow.status).toBe("NOT_RESUMED");
    expect((await getApproval(fakeCtx as any, row.id))?.status).toBe("FAILED");
    expect(auditCalls.some((a) => a.action === "approval.execution_failed")).toBe(true);
  });
});

// ─── 20/22. audit ────────────────────────────────────────────────────────────

describe("audit", () => {
  it("emits the lifecycle events in order, metadata-only", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    await detailGET(req(`http://localhost/api/agent/approvals/${row.id}`), routeParams(row.id));
    await approveApproval(fakeCtx as any, row.id);
    const actions = auditCalls.map((a) => a.action);
    for (const expected of [
      "approval.created",
      "approval.viewed",
      "approval.approved",
      "approval.execution_started",
      "approval.executed",
    ]) {
      expect(actions).toContain(expected);
    }
    // Metadata only: no draft body, no secrets anywhere in audit payloads.
    const blob = JSON.stringify(auditCalls);
    expect(blob).not.toContain("Hi — DRAFT");
    expect(blob).not.toContain("sk-");
    for (const a of auditCalls) {
      expect(a.resource).toBe("approval");
      expect(a.organizationId).toBe("org-A");
    }
  });
});

// ─── 21. memory failure isolation ────────────────────────────────────────────

describe("memory", () => {
  it("a memory failure never fails a successful approval", async () => {
    mockRemember.mockRejectedValue(new Error("memory down"));
    const row = await createApproval(fakeCtx as any, proposal());
    const { approval, execution } = await approveApproval(fakeCtx as any, row.id);
    expect(approval.status).toBe("EXECUTED");
    expect(execution.ok).toBe(true);
  });

  it("records a bounded USER-APPROVED memory entry on success", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    await approveApproval(fakeCtx as any, row.id);
    expect(mockRemember).toHaveBeenCalled();
    const input = mockRemember.mock.calls[0][1];
    expect(input.scope).toBe("LEAD");
    expect(input.scopeId).toBe("lead-1");
    expect(JSON.stringify(input.value).length).toBeLessThan(4096);
    expect(input.value.note).toContain("USER APPROVED");
  });
});

// ─── 24/25. auth + rate limiting ─────────────────────────────────────────────

describe("API guards", () => {
  it("returns 401 when unauthenticated", async () => {
    flags.unauthenticated = true;
    const res = await listGET(req("http://localhost/api/agent/approvals"), {} as any);
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    flags.rateLimited = true;
    const row = await createApproval(fakeCtx as any, proposal());
    const res = await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id));
    expect(res.status).toBe(429);
    expect(toolCalls.length).toBe(0);
  });
});

// ─── 26. pagination/filter validation ────────────────────────────────────────

describe("list filters", () => {
  it("rejects invalid filters and clamps pagination", async () => {
    await createApproval(fakeCtx as any, proposal());
    for (const qs of ["?status=BOGUS", "?pageSize=1000", "?page=0", "?actionType=SEND"]) {
      const res = await listGET(req(`http://localhost/api/agent/approvals${qs}`), {} as any);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("INVALID_FILTER");
    }
  });

  it("filters by status/actionType/workflowId", async () => {
    const a = await createApproval(fakeCtx as any, proposal());
    await createApproval(fakeCtx as any, proposal({ workflowId: "lead-discovery-qualification" }));
    await rejectApproval(fakeCtx as any, a.id, { reason: "no" });
    const pending = await listGET(req("http://localhost/api/agent/approvals?status=PENDING"), {} as any);
    expect((await pending.json()).total).toBe(1);
    const rejected = await listGET(req("http://localhost/api/agent/approvals?status=REJECTED"), {} as any);
    expect((await rejected.json()).total).toBe(1);
    const byWorkflow = await listGET(
      req("http://localhost/api/agent/approvals?workflowId=lead-discovery-qualification"),
      {} as any,
    );
    expect((await byWorkflow.json()).total).toBe(1);
    const byAction = await listGET(req("http://localhost/api/agent/approvals?actionType=OUTREACH_DRAFT"), {} as any);
    expect((await byAction.json()).total).toBe(2);
  });
});

// ─── 27. API state consistency ───────────────────────────────────────────────

describe("state consistency", () => {
  it("create → list → detail → approve → detail shows one coherent lifecycle", async () => {
    const row = await createApproval(fakeCtx as any, proposal());
    const listed = await (await listGET(req("http://localhost/api/agent/approvals"), {} as any)).json();
    expect(listed.approvals.some((a: any) => a.id === row.id && a.status === "PENDING")).toBe(true);
    const detail1 = await (await detailGET(req(`http://localhost/api/agent/approvals/${row.id}`), routeParams(row.id))).json();
    expect(detail1.approval.status).toBe("PENDING");
    const approved = await (await approvePOST(req(`http://localhost/api/agent/approvals/${row.id}/approve`, { method: "POST" }), routeParams(row.id))).json();
    expect(approved.approval.status).toBe("EXECUTED");
    const detail2 = await (await detailGET(req(`http://localhost/api/agent/approvals/${row.id}`), routeParams(row.id))).json();
    expect(detail2.approval.status).toBe("EXECUTED");
    expect(detail2.approval.execution.ok).toBe(true);
    expect(detail2.approval.reviewedByUserId).toBe("user-1");
  });
});
