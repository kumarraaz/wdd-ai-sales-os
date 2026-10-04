/**
 * Phase 7 — human approval & action control: shared types.
 *
 * An AgentApproval is a persistent, immutable-after-creation SNAPSHOT of a
 * proposed action. Approving executes exactly the snapshot — never client
 * input, never a re-planned action.
 */

import type {
  WorkflowBudget,
  WorkflowProspect,
  WorkflowRequest,
  StageOutcome,
} from "../workflow/types";

// Prisma enums (mirrored for Zod validation without importing the client here).
export const APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "EXECUTED",
  "FAILED",
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_ACTION_TYPES = [
  "OUTREACH_DRAFT",
  "CRM_FOLLOWUP",
  "CRM_TASK",
] as const;

export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

/** Registry tool invoked for each approval action type. Never a send action. */
export const APPROVAL_ACTION_TOOL: Record<ApprovalActionType, string> = {
  OUTREACH_DRAFT: "outreach.createDraft",
  CRM_FOLLOWUP: "crm.createFollowUp",
  CRM_TASK: "crm.createTask",
};

/** Map a Phase-2 tool name to its approval action type (null = not approvable). */
export function actionTypeForTool(toolName: string): ApprovalActionType | null {
  for (const [actionType, tool] of Object.entries(APPROVAL_ACTION_TOOL)) {
    if (tool === toolName) return actionType as ApprovalActionType;
  }
  return null;
}

/** Structured target of the proposed action (JSON-safe, bounded). */
export interface ApprovalTarget {
  label: string;
  leadId?: string | null;
  channel?: string | null;
}

/**
 * Bounded checkpoint of a paused workflow, stored on the approval record so
 * the workflow can resume from the NEXT stage without re-running discovery.
 * Prospect research is stripped to bound the size.
 */
export interface WorkflowCheckpoint {
  v: 1;
  request: WorkflowRequest;
  budget: WorkflowBudget;
  budgetClampedNotes: string[];
  stages: StageOutcome[];
  prospects: Omit<WorkflowProspect, "research">[];
  leadContext: Record<string, unknown> | null;
  pausedStageId: string;
  target: number;
  memoryRecalled: number;
  startedAt: string;
}

/** Execution result recorded on the approval (metadata only — no secrets). */
export interface ApprovalExecutionResult {
  tool: string;
  ok: boolean;
  /** Opaque id returned by the tool (e.g. draft message id). */
  resultId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  executedAt: string;
}
