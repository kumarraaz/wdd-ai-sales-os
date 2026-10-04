/**
 * AI Sales Mind — shared types (Phase 4).
 *
 * No database models here: the run ID is an in-memory correlation id.
 * Persistent AgentRun/AgentStep models belong to a later hardening phase.
 */

/** Hard budget limits for a single runAgentGoal invocation. */
export interface AgentBudget {
  /** Max loop iterations (plan + decide cycles). */
  maxSteps: number;
  /** Max tool executions via the registry. */
  maxToolCalls: number;
  /** Max steps the planner may propose. */
  maxPlanSteps: number;
  /** Max wall-clock runtime in milliseconds. */
  maxRuntimeMs: number;
}

export type AgentStatus =
  | "COMPLETED"
  | "WAITING_FOR_APPROVAL"
  | "BUDGET_EXCEEDED"
  | "KILL_SWITCH_ACTIVE"
  | "CANCELLED"
  | "FAILED"
  | "STOPPED";

/** A tool call the Mind proposes but must not execute without a human. */
export interface PendingApproval {
  tool: string;
  /** Input already validated against the tool's own schema. */
  input: unknown;
  reason: string;
  requiresApproval: true;
}

export type ToolCallStatus =
  | "success"
  | "failed"
  | "deferred_to_job"
  | "blocked_approval";

export interface ToolCallRecord {
  seq: number;
  tool: string;
  status: ToolCallStatus;
  startedAt: string;
  durationMs: number;
  /** Short factual line — derived from records, never model-written. */
  summary: string;
  /** Set when the work was deferred to the Phase 3 job engine. */
  jobId?: string;
}

export interface StepRecord {
  index: number;
  tool: string;
  reason: string;
  status: "completed" | "failed" | "skipped" | "deferred" | "blocked_approval";
  detail?: string;
}

export interface AgentRunUsage {
  steps: number;
  toolCalls: number;
  runtimeMs: number;
}

/**
 * Strongly typed result of runAgentGoal. Stack traces are never exposed;
 * errorMessage is a short, sanitized, operator-safe string.
 */
export interface AgentRunResult {
  runId: string;
  status: AgentStatus;
  /** The validated goal text the run pursued. */
  goal: string;
  steps: StepRecord[];
  toolCalls: ToolCallRecord[];
  pendingApproval: PendingApproval | null;
  /** Deterministic summary built from records — no model fabrication. */
  summary: string;
  errorCode?: string;
  errorMessage?: string;
  budgets: AgentBudget;
  usage: AgentRunUsage;
}
