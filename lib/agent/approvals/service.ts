/**
 * Phase 7 — human approval service.
 *
 * Lifecycle: PENDING → APPROVED → EXECUTED | FAILED
 *                    → REJECTED | CANCELLED | EXPIRED (terminal, never executes)
 *
 * Security properties:
 * - organizationId ALWAYS comes from WorkspaceContext, never the client.
 * - The approval record is an immutable snapshot; only the review decision
 *   is client-controlled.
 * - PENDING → APPROVED uses an atomic conditional update — exactly one
 *   concurrent request can win and execute. Double approval never executes
 *   twice (second call returns the recorded outcome).
 * - Execution goes through the allowlisted dispatcher with the STORED
 *   snapshot re-validated against the tool's current schema.
 * - Lazy expiration: no scheduler, no new queue.
 */

import { z } from "zod";
import type { AgentApproval, Prisma } from "@prisma/client";
import type { WorkspaceContext } from "../../tenant";
import { roleAtLeast } from "../../tenant";
import { db } from "../../db";
import { audit } from "../../audit";
import { remember } from "../memory";
import { executeApprovedAction, ApprovalDispatchError } from "./dispatcher";
import {
  APPROVAL_ACTION_TYPES,
  APPROVAL_STATUSES,
  actionTypeForTool,
  type ApprovalActionType,
  type ApprovalExecutionResult,
  type ApprovalStatus,
} from "./types";

export class ApprovalError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Approvals auto-expire 72h after creation unless a custom expiresAt is set. */
export const APPROVAL_DEFAULT_TTL_MS = 72 * 3600 * 1000;

function requireReviewerRole(ctx: WorkspaceContext): void {
  if (!roleAtLeast(ctx.membership.role, "SALES_EXECUTIVE")) {
    throw new ApprovalError(
      "FORBIDDEN",
      "Reviewing approvals requires the SALES_EXECUTIVE role or above.",
      403,
    );
  }
}

async function logApprovalEvent(
  ctx: WorkspaceContext,
  event: string,
  approvalId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: event,
      resource: "approval",
      resourceId: approvalId,
      metadata,
    });
  } catch {
    // Audit failure must never break the approval lifecycle.
  }
}

/** Metadata-only summary for audit (never the draft body, never secrets). */
function approvalMeta(row: AgentApproval): Record<string, unknown> {
  const target = (row.target ?? {}) as { label?: string; channel?: string | null };
  return {
    workflowId: row.workflowId,
    stageId: row.stageId,
    actionType: row.actionType,
    targetLabel: target.label ?? null,
    channel: target.channel ?? null,
  };
}

// ─── creation ────────────────────────────────────────────────────────────────

const createApprovalSchema = z
  .object({
    workflowId: z.string().trim().min(1).max(120),
    workflowRunId: z.string().trim().min(1).max(120),
    stageId: z.string().trim().min(1).max(120),
    /** Phase-2 tool name being proposed (mapped to an action type, never stored raw). */
    toolName: z.string().trim().min(1).max(120),
    /** Exact proposed tool input — the immutable snapshot. */
    proposedInput: z.record(z.string(), z.unknown()),
    target: z
      .object({
        label: z.string().trim().min(1).max(500),
        leadId: z.string().trim().max(100).nullish(),
        channel: z.string().trim().max(40).nullish(),
      })
      .strict(),
    reason: z.string().trim().min(1).max(2000),
    workflowSnapshot: z.unknown().optional(),
    expiresAt: z.date().optional(),
  })
  .strict();

export type CreateApprovalInput = z.infer<typeof createApprovalSchema>;

export async function createApproval(
  ctx: WorkspaceContext,
  rawInput: unknown,
): Promise<AgentApproval> {
  const parsed = createApprovalSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApprovalError(
      "INVALID_INPUT",
      `Invalid approval proposal: ${first ? `${first.path.join(".") || "(root)"} — ${first.message}` : "rejected"}.`,
    );
  }
  const input = parsed.data;
  const actionType = actionTypeForTool(input.toolName);
  if (!actionType) {
    throw new ApprovalError(
      "ACTION_NOT_APPROVABLE",
      `Tool "${input.toolName}" cannot go through the approval path.`,
    );
  }
  // Guarantee JSON-serializability of the snapshot (fail closed on weird values).
  let snapshotInput: Record<string, unknown>;
  try {
    snapshotInput = JSON.parse(JSON.stringify(input.proposedInput)) as Record<string, unknown>;
  } catch {
    throw new ApprovalError("INVALID_INPUT", "Proposed input is not JSON-serializable.");
  }

  const record = await db.agentApproval.create({
    data: {
      organizationId: ctx.organization.id,
      workflowId: input.workflowId,
      workflowRunId: input.workflowRunId,
      stageId: input.stageId,
      status: "PENDING",
      actionType,
      proposedInput: snapshotInput as unknown as Prisma.InputJsonValue,
      target: input.target,
      reason: input.reason,
      requestedByUserId: ctx.user.id,
      expiresAt: input.expiresAt ?? new Date(Date.now() + APPROVAL_DEFAULT_TTL_MS),
      workflowSnapshot:
        input.workflowSnapshot === undefined
          ? undefined
          : (input.workflowSnapshot as unknown as Prisma.InputJsonValue),
    },
  });
  await logApprovalEvent(ctx, "approval.created", record.id, approvalMeta(record));
  return record;
}

// ─── reads (tenant-scoped, lazy expiry) ──────────────────────────────────────

function orgScope(ctx: WorkspaceContext, id: string) {
  return { id, organizationId: ctx.organization.id };
}

async function applyLazyExpiry(ctx: WorkspaceContext, row: AgentApproval): Promise<AgentApproval> {
  if (row.status === "PENDING" && row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    const res = await db.agentApproval.updateMany({
      where: { ...orgScope(ctx, row.id), status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (res.count === 1) {
      await logApprovalEvent(ctx, "approval.expired", row.id, approvalMeta(row));
      return { ...row, status: "EXPIRED" };
    }
    const fresh = await db.agentApproval.findFirst({ where: orgScope(ctx, row.id) });
    return fresh ?? row;
  }
  return row;
}

/** Tenant-scoped read. Returns null when the id is unknown or belongs to another org. */
export async function getApproval(ctx: WorkspaceContext, id: string): Promise<AgentApproval | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 100) return null;
  const row = await db.agentApproval.findFirst({ where: orgScope(ctx, id) });
  if (!row) return null;
  return applyLazyExpiry(ctx, row);
}

const listFilterSchema = z
  .object({
    status: z.enum(APPROVAL_STATUSES).optional(),
    actionType: z.enum(APPROVAL_ACTION_TYPES).optional(),
    workflowId: z.string().trim().min(1).max(120).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export interface ApprovalListResult {
  items: AgentApproval[];
  page: number;
  pageSize: number;
  total: number;
}

export async function listApprovals(
  ctx: WorkspaceContext,
  rawFilters: unknown,
): Promise<ApprovalListResult> {
  const parsed = listFilterSchema.safeParse(rawFilters ?? {});
  if (!parsed.success) {
    throw new ApprovalError("INVALID_FILTER", "Invalid list filters.");
  }
  const { status, actionType, workflowId, page, pageSize } = parsed.data;
  const where = {
    organizationId: ctx.organization.id,
    ...(status ? { status } : {}),
    ...(actionType ? { actionType } : {}),
    ...(workflowId ? { workflowId } : {}),
  };
  const [items, total] = await Promise.all([
    db.agentApproval.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.agentApproval.count({ where }),
  ]);
  // Surface lazy expiry on listed rows without an extra write storm: expire in
  // memory for the response; the stored row flips on next direct access.
  const now = Date.now();
  const withExpiry = items.map((r) =>
    r.status === "PENDING" && r.expiresAt && r.expiresAt.getTime() <= now
      ? { ...r, status: "EXPIRED" as const }
      : r,
  );
  return { items: withExpiry, page, pageSize, total };
}

// ─── review helpers ──────────────────────────────────────────────────────────

function notExpiredClause() {
  const now = new Date();
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

async function loadPendingForReview(ctx: WorkspaceContext, id: string): Promise<AgentApproval> {
  requireReviewerRole(ctx);
  const row = await getApproval(ctx, id);
  if (!row) throw new ApprovalError("NOT_FOUND", "Approval not found.", 404);
  if (row.status === "EXPIRED") {
    throw new ApprovalError("APPROVAL_EXPIRED", "This approval has expired and can no longer be reviewed.", 410);
  }
  if (row.status !== "PENDING") {
    throw new ApprovalError(
      "ALREADY_REVIEWED",
      `Approval is already ${row.status}; only PENDING approvals can be reviewed.`,
      409,
    );
  }
  return row;
}

// ─── approve → execute (atomic, idempotent) ───────────────────────────────────

export interface ApproveResult {
  approval: AgentApproval;
  execution: ApprovalExecutionResult;
  /** True when the approval was already executed and the recorded outcome is returned. */
  alreadyExecuted: boolean;
}

export async function approveApproval(ctx: WorkspaceContext, id: string): Promise<ApproveResult> {
  requireReviewerRole(ctx);
  const row = await getApproval(ctx, id);
  if (!row) {
    throw new ApprovalError("NOT_FOUND", "Approval not found.", 404);
  }
  if (row.status === "EXPIRED") {
    throw new ApprovalError(
      "APPROVAL_EXPIRED",
      "This approval has expired and can no longer be reviewed.",
      410,
    );
  }
  // Idempotent read path: an already-executed approval returns its recorded
  // outcome — it is NEVER executed twice.
  if (row.status === "EXECUTED" || row.status === "FAILED") {
    const execution = (row.executionResult as ApprovalExecutionResult | null) ?? {
      tool: "unknown",
      ok: row.status === "EXECUTED",
      executedAt: row.updatedAt.toISOString(),
    };
    return { approval: row, execution, alreadyExecuted: true };
  }
  if (row.status !== "PENDING") {
    throw new ApprovalError(
      "ALREADY_REVIEWED",
      `Approval is already ${row.status}; only PENDING approvals can be approved.`,
      409,
    );
  }

  // Atomic claim: exactly one concurrent request transitions PENDING → APPROVED.
  const claimed = await db.agentApproval.updateMany({
    where: { ...orgScope(ctx, row.id), status: "PENDING", ...notExpiredClause() },
    data: { status: "APPROVED", reviewedByUserId: ctx.user.id, reviewedAt: new Date() },
  });
  if (claimed.count !== 1) {
    const fresh = await getApproval(ctx, id);
    throw new ApprovalError(
      "APPROVAL_RACE_LOST",
      `Approval is no longer pending (now ${fresh?.status ?? "unknown"}). Nothing was executed twice.`,
      409,
    );
  }
  await logApprovalEvent(ctx, "approval.approved", row.id, approvalMeta(row));

  // Execute ONLY the stored snapshot — never client input, never re-planned.
  await logApprovalEvent(ctx, "approval.execution_started", row.id, approvalMeta(row));
  let execution: ApprovalExecutionResult;
  try {
    const dispatched = await executeApprovedAction(ctx, row.actionType, row.proposedInput);
    execution = {
      tool: dispatched.tool,
      ok: true,
      resultId: dispatched.resultId,
      executedAt: new Date().toISOString(),
    };
  } catch (err) {
    const code = err instanceof ApprovalDispatchError ? err.code : "EXECUTION_FAILED";
    execution = {
      tool: "unknown",
      ok: false,
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : "Action execution failed.",
      executedAt: new Date().toISOString(),
    };
  }

  const finalStatus: ApprovalStatus = execution.ok ? "EXECUTED" : "FAILED";
  await db.agentApproval.updateMany({
    where: { ...orgScope(ctx, row.id), status: "APPROVED" },
    data: { status: finalStatus, executionResult: execution as object },
  });
  await logApprovalEvent(
    ctx,
    execution.ok ? "approval.executed" : "approval.execution_failed",
    row.id,
    { ...approvalMeta(row), resultId: execution.resultId ?? null, errorCode: execution.errorCode ?? null },
  );

  // Memory update is failure-isolated: it must never fail a successful approval.
  try {
    await rememberApprovalMemory(ctx, row, execution);
  } catch {
    // ignore
  }

  const updated =
    (await db.agentApproval.findFirst({ where: orgScope(ctx, row.id) })) ??
    ({ ...row, status: finalStatus } as AgentApproval);
  return { approval: updated, execution, alreadyExecuted: false };
}

async function rememberApprovalMemory(
  ctx: WorkspaceContext,
  row: AgentApproval,
  execution: ApprovalExecutionResult,
): Promise<void> {
  const target = (row.target ?? {}) as { label?: string; leadId?: string | null };
  const value = {
    v: 1,
    actionType: row.actionType,
    outcome: execution.ok ? "EXECUTED" : "FAILED",
    approvedByUserId: ctx.user.id,
    approvedAt: new Date().toISOString(),
    targetLabel: target.label ?? null,
    resultId: execution.resultId ?? null,
    note: `USER APPROVED ${row.actionType} for ${target.label ?? "target"}`,
  };
  if (target.leadId) {
    await remember(ctx, { scope: "LEAD", scopeId: target.leadId, key: `approval.${row.id}`, value });
  } else {
    await remember(ctx, {
      scope: "ORG",
      scopeId: ctx.organization.id,
      key: `approval.${row.id}`,
      value,
    });
  }
}

// ─── reject / cancel ─────────────────────────────────────────────────────────

async function transitionPending(
  ctx: WorkspaceContext,
  row: AgentApproval,
  to: "REJECTED" | "CANCELLED",
  event: string,
  extraMeta: Record<string, unknown> = {},
): Promise<AgentApproval> {
  const res = await db.agentApproval.updateMany({
    where: { ...orgScope(ctx, row.id), status: "PENDING", ...notExpiredClause() },
    data: {
      status: to,
      reviewedByUserId: ctx.user.id,
      reviewedAt: new Date(),
      ...(Object.keys(extraMeta).length > 0 ? { executionResult: extraMeta as object } : {}),
    },
  });
  if (res.count !== 1) {
    const fresh = await getApproval(ctx, row.id);
    throw new ApprovalError(
      "ALREADY_REVIEWED",
      `Approval is no longer pending (now ${fresh?.status ?? "unknown"}).`,
      409,
    );
  }
  await logApprovalEvent(ctx, event, row.id, approvalMeta(row));
  const updated = await db.agentApproval.findFirst({ where: orgScope(ctx, row.id) });
  return updated ?? ({ ...row, status: to } as AgentApproval);
}

const rejectSchema = z
  .object({ reason: z.string().trim().max(2000).optional() })
  .strict();

export async function rejectApproval(
  ctx: WorkspaceContext,
  id: string,
  rawBody: unknown,
): Promise<AgentApproval> {
  const row = await loadPendingForReview(ctx, id);
  const parsed = rejectSchema.safeParse(rawBody ?? {});
  const reason = parsed.success ? (parsed.data.reason ?? "") : "";
  return transitionPending(ctx, row, "REJECTED", "approval.rejected", {
    ok: false,
    rejected: true,
    reason,
  });
}

export async function cancelApproval(ctx: WorkspaceContext, id: string): Promise<AgentApproval> {
  const row = await loadPendingForReview(ctx, id);
  return transitionPending(ctx, row, "CANCELLED", "approval.cancelled", {
    ok: false,
    cancelled: true,
  });
}

// ─── response shaping ────────────────────────────────────────────────────────

/** Audit a detail view (failure-isolated by the shared helper). */
export async function auditApprovalViewed(ctx: WorkspaceContext, id: string): Promise<void> {
  await logApprovalEvent(ctx, "approval.viewed", id, {});
}

/** Public shape for API responses (includes the proposed action for review). */
export function toApprovalDTO(row: AgentApproval) {
  const execution = (row.executionResult ?? null) as ApprovalExecutionResult | null;
  return {
    id: row.id,
    status: row.status,
    actionType: row.actionType,
    workflowId: row.workflowId,
    workflowRunId: row.workflowRunId,
    stageId: row.stageId,
    target: row.target,
    proposedInput: row.proposedInput,
    reason: row.reason,
    requestedByUserId: row.requestedByUserId,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    execution,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type { ApprovalActionType, ApprovalStatus };
