/**
 * Phase 6 — Sales Workflow / Orchestration layer: type system.
 *
 * A workflow is a DECLARATIVE, ordered list of stages. Stage definitions name
 * the Phase-2 registry tools they may call; they never contain executable code.
 * Execution goes through the workflow executor (executor.ts), which enforces
 * tenant isolation, kill switch, cancellation, budgets, approvals and failure
 * isolation on top of the existing safe infrastructure.
 */

import { z } from "zod";

// ─── Stage types ─────────────────────────────────────────────────────────────

export const WORKFLOW_STAGE_TYPES = [
  "DISCOVER",
  "RESEARCH",
  "QUALIFY",
  "SCORE",
  "LOAD_CONTEXT",
  "CREATE_LEAD",
  "CREATE_TASK",
  "OUTREACH_DRAFT",
  "FOLLOW_UP",
  "LOG_ACTIVITY",
  "COMPLETE",
] as const;

export type WorkflowStageType = (typeof WORKFLOW_STAGE_TYPES)[number];

// ─── Stage definition (declarative only — no code, no SQL, no shell) ──────────

export interface StageDefinition {
  /** Stable stage id, unique within the workflow (e.g. "discover-prospects"). */
  id: string;
  type: WorkflowStageType;
  description: string;
  /** Phase-2 registry tool names this stage is allowed to invoke. Empty = deterministic local logic only. */
  tools: string[];
  /** When true the executor pauses with WAITING_FOR_APPROVAL instead of invoking the tool. */
  approvalRequired: boolean;
  /** Hard cap on registry tool calls made by this stage. */
  maxToolCalls: number;
  /** When true, a stage failure is recorded and the workflow continues; otherwise the workflow fails. */
  continueOnError: boolean;
  /** Per-stage wall-clock cap in ms (clamped by the workflow runtime budget). */
  timeoutMs: number;
}

// ─── Workflow definition ─────────────────────────────────────────────────────

export interface WorkflowBudget {
  maxStages: number;
  maxToolCalls: number;
  maxLeads: number;
  maxRuntimeMs: number;
  maxAiCalls: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  goal: string;
  stages: StageDefinition[];
  defaultBudget: WorkflowBudget;
  approvalPolicy: "always" | "outreach-only" | "none";
}

// ─── Workflow request (natural-language planning output, Zod-validated) ──────

export const WORKFLOW_IDS = [
  "lead-discovery-qualification",
  "website-improvement-prospecting",
  "reengage-existing-lead",
] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export const WORKFLOW_REQUEST_SCHEMA = z
  .object({
    workflowId: z.enum(WORKFLOW_IDS),
    params: z
      .object({
        /** What to look for, e.g. "manufacturers". */
        target: z.string().trim().min(1).max(200).optional(),
        /** Where to look, e.g. "Gujarat". */
        location: z.string().trim().min(1).max(200).optional(),
        /** Requested prospect count. Clamped to safe limits by the executor — never trusted blindly. */
        desiredLeads: z.number().int().min(1).max(100_000).optional(),
        /** Website filter applied during QUALIFY. */
        websiteRequirement: z.enum(["weak", "any", "none"]).optional(),
        /** Outreach channel for OUTREACH_DRAFT stages. Draft-only; never sends. */
        outreachChannel: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN"]).optional(),
        /** CRM lead id for workflows that re-engage an existing lead. */
        leadId: z.string().cuid().optional(),
      })
      .strict()
      .default({}),
    requiresApproval: z.boolean().default(true),
  })
  .strict();

export type WorkflowRequest = z.infer<typeof WORKFLOW_REQUEST_SCHEMA>;

// ─── Budgets ─────────────────────────────────────────────────────────────────

export const WORKFLOW_BUDGET_DEFAULTS: WorkflowBudget = {
  maxStages: 10,
  maxToolCalls: 60,
  maxLeads: 50,
  maxRuntimeMs: 180_000, // 3 minutes
  maxAiCalls: 5,
};

export const WORKFLOW_BUDGET_CEILINGS: WorkflowBudget = {
  maxStages: 20,
  maxToolCalls: 200,
  maxLeads: 200,
  maxRuntimeMs: 600_000, // 10 minutes
  maxAiCalls: 10,
};

export interface ClampedBudget {
  budget: WorkflowBudget;
  /** Human-readable notes for every value that was clamped down. */
  clamped: string[];
}

/**
 * Normalize a caller-provided budget: fill defaults, clamp every value to the
 * hard ceiling. Never trust a model- or user-provided budget blindly.
 */
export function clampBudget(input?: Partial<WorkflowBudget>): ClampedBudget {
  const clamped: string[] = [];
  const out: WorkflowBudget = { ...WORKFLOW_BUDGET_DEFAULTS };
  for (const key of Object.keys(WORKFLOW_BUDGET_CEILINGS) as (keyof WorkflowBudget)[]) {
    const raw = input?.[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      const ceiling = WORKFLOW_BUDGET_CEILINGS[key];
      const value = Math.floor(raw);
      if (value > ceiling) {
        out[key] = ceiling;
        clamped.push(`${key} clamped from ${value} to ${ceiling}`);
      } else {
        out[key] = value;
      }
    }
  }
  return { budget: out, clamped };
}

/**
 * Resolve the effective prospect target from a requested count.
 * "Find 10,000 leads" becomes at most the ceiling — and the caller is told.
 */
export function resolveDesiredLeads(requested?: number): {
  target: number;
  clamped: boolean;
  requested: number | null;
} {
  if (requested == null) {
    return { target: WORKFLOW_BUDGET_DEFAULTS.maxLeads, clamped: false, requested: null };
  }
  const ceiling = WORKFLOW_BUDGET_CEILINGS.maxLeads;
  if (requested > ceiling) {
    return { target: ceiling, clamped: true, requested };
  }
  return { target: Math.max(1, Math.floor(requested)), clamped: false, requested };
}

// ─── Execution status & results ──────────────────────────────────────────────

export const WORKFLOW_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_APPROVAL",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "STOPPED",
  "BUDGET_EXCEEDED",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export type StageOutcomeStatus =
  | "completed"
  | "failed"
  | "skipped"
  | "waiting_approval"
  | "deferred";

export interface WorkflowCounts {
  requested: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  deferred: number;
}

export interface StageOutcome {
  stageId: string;
  type: WorkflowStageType;
  status: StageOutcomeStatus;
  toolCalls: number;
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  durationMs: number;
  error?: string;
  note?: string;
}

export type ProvenanceLabel =
  | "VERIFIED_DATA"
  | "AI_INFERENCE"
  | "USER_PROVIDED"
  | "DEMO_DATA";

/** A prospect flowing through DISCOVER → RESEARCH → QUALIFY → SCORE. */
export interface WorkflowProspect {
  /** Deterministic id for this run (not persisted). */
  prospectKey: string;
  name: string;
  website: string | null;
  location: string | null;
  industry: string | null;
  /** Provenance of the underlying data — never upgraded silently. */
  provenance: ProvenanceLabel;
  source: string;
  sourceUrl: string | null;
  observedAt: string;
  research: Record<string, unknown> | null;
  qualified: boolean;
  qualificationReasons: string[];
  score: number | null;
  scoreBand: string | null;
  crmLeadId: string | null;
  failed: boolean;
  failureReason: string | null;
}

/** Proposed action returned when a stage requires approval. */
export interface ApprovalProposal {
  workflowId: string;
  stageId: string;
  action: string;
  /** Tool input that WOULD be executed after approval — never executed here. */
  proposedInput: Record<string, unknown>;
  target: string;
  reason: string;
}

export interface WorkflowResult {
  status: WorkflowStatus;
  workflowId: WorkflowId;
  workflowRunId: string;
  requested: WorkflowRequest;
  effectiveBudget: WorkflowBudget;
  budgetClampedNotes: string[];
  stages: StageOutcome[];
  counts: WorkflowCounts;
  prospects: WorkflowProspect[];
  /** Set when status is WAITING_FOR_APPROVAL. */
  approval?: ApprovalProposal;
  /** Persistent approval record id (Phase 7). Set when the pause was persisted. */
  approvalId?: string;
  /** Set when this result came from resuming after an approved action. */
  resumedFromApprovalId?: string;
  /** Set when bulk work was delegated to the Phase-3 job engine. */
  deferredJobId?: string;
  memoryRecalled: number;
  memoryPersisted: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Machine-readable reason code for non-COMPLETED outcomes. */
  errorCode?: string;
  errorMessage?: string;
}
