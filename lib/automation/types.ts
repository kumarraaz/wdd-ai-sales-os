/**
 * Job + Automation Engine — shared types (Phase 3).
 *
 * Server-side only. The future AI Sales Mind will enqueue jobs here;
 * nothing in this phase parses natural language or makes autonomous
 * decisions.
 */
import type { JobStatus } from "@prisma/client";

/** Job types supported in Phase 3. Unknown types are rejected at enqueue. */
export type JobTypeName =
  | "discovery.pipeline"
  | "research.website"
  | "research.lead"
  | "lead.scoring"
  | "followup.create"
  | "message.generate"
  | "prospecting.instagram.daily";

/** Trusted execution context for a job. organizationId comes from the job
 *  row (written at enqueue from server context) — never from the payload. */
export interface JobContext {
  organizationId: string;
  /** "system" for worker execution; the enqueuing user is recorded in audit. */
  actorId: string;
  jobId: string;
  /** 1-based attempt number (incremented atomically at claim). */
  attempt: number;
}

/**
 * Typed job error. `retryable=false` marks permanent failures that must not
 * be retried (validation, unknown types, quota exhaustion, missing data).
 */
export class JobError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = true) {
    super(message);
    this.name = "JobError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type JobDisposition =
  | "completed"
  | "retrying"
  | "failed_permanent"
  | "dead_lettered"
  | "killed";

export interface ExecuteResult {
  disposition: JobDisposition;
  /** Handler-defined summary. Not persisted to the Job row in Phase 3
   *  (the schema has no result column); surfaced to callers and audit. */
  summary?: unknown;
}

export interface BatchStats {
  claimed: number;
  completed: number;
  /** Permanent failures + dead-lettered. */
  failed: number;
  retried: number;
  killed: boolean;
}

/** Minimal job shape used by the engine (subset of the Prisma Job model). */
export interface EngineJob {
  id: string;
  organizationId: string | null;
  name: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  updatedAt: Date;
}

// ── Retry policy ─────────────────────────────────────────────────────────

/** Base delay for exponential backoff between attempts. */
export const BACKOFF_BASE_MS = 30_000;
/** Backoff never exceeds this, no matter the attempt number. */
export const BACKOFF_CAP_MS = 15 * 60_000;
/** Default attempts when the caller does not specify. */
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Hard ceiling — callers cannot request unbounded retries. */
export const MAX_ALLOWED_ATTEMPTS = 10;
/**
 * A RUNNING job whose updatedAt is older than this is considered stale
 * (worker crashed) and is recovered to RETRYING/FAILED. Documented timeout:
 * 15 minutes.
 */
export const STALE_JOB_TIMEOUT_MS = 15 * 60_000;
/** Per-execution wall-clock cap for a single job handler. */
export const JOB_TIMEOUT_MS = 5 * 60_000;

/** Exponential backoff: 30s, 60s, 120s, … capped at 15 min. */
export function backoffMs(attempt: number): number {
  const exp = Math.max(0, attempt - 1);
  return Math.min(BACKOFF_BASE_MS * 2 ** exp, BACKOFF_CAP_MS);
}

// ── Kill switch ──────────────────────────────────────────────────────────

/**
 * Global kill switch, operator-controlled via environment only.
 * WDD_AUTOMATION_KILL_SWITCH=true → no job handler executes. Queued jobs
 * are preserved; execution attempts revert to QUEUED. There is no public
 * endpoint that can toggle this.
 */
export function isKillSwitchOn(): boolean {
  return process.env.WDD_AUTOMATION_KILL_SWITCH === "true";
}
