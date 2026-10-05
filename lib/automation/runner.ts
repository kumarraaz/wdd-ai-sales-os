/**
 * Job engine (Phase 3).
 *
 * Server-side only. Reliable execution infrastructure over the existing
 * Prisma Job model (no schema changes):
 *
 *   enqueueJob() → claimJob() → executeJob() → COMPLETED
 *                                            → RETRYING (bounded, exponential backoff)
 *                                            → FAILED (permanent or dead-lettered)
 *
 * Claiming is atomic: SELECT the oldest due candidate, then UPDATE … WHERE
 * status IN (QUEUED, RETRYING). Under read-committed isolation the second
 * worker's UPDATE matches zero rows, so two workers can never claim the
 * same job. Backoff eligibility uses updatedAt (bumped on every state
 * transition): QUEUED jobs are due immediately, RETRYING jobs wait
 * backoffMs(attempts).
 *
 * Stale RUNNING jobs (worker crash) are recovered by recoverStaleJobs():
 * jobs untouched for STALE_JOB_TIMEOUT_MS (15 min) return to RETRYING or
 * FAILED. Call it at the start of every batch.
 */
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import {
  getJobHandler,
  listJobTypes,
  isKnownJobType,
  JOB_PAYLOAD_SCHEMAS,
  assertNoSecrets,
} from "./handlers";
import {
  JobError,
  backoffMs,
  STALE_JOB_TIMEOUT_MS,
  JOB_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  MAX_ALLOWED_ATTEMPTS,
  isKillSwitchOn,
} from "./types";
import type {
  JobTypeName,
  JobContext,
  ExecuteResult,
  BatchStats,
  EngineJob,
} from "./types";

const MIN_BACKOFF_MS = backoffMs(1);
const ERROR_MAX_CHARS = 500;

function truncateError(message: string): string {
  // First line only: stack traces (line 2+) are never persisted or returned.
  const firstLine = message.split("\n")[0];
  return firstLine.length > ERROR_MAX_CHARS
    ? firstLine.slice(0, ERROR_MAX_CHARS) + "…"
    : firstLine;
}

function sanitizedMessage(err: unknown): string {
  return truncateError(err instanceof Error ? err.message : "Job handler failed.");
}

// ── Enqueue ──────────────────────────────────────────────────────────────

const enqueueInputSchema = z.object({
  /** Trusted server context — never from AI output or client input. */
  organizationId: z.string().min(1),
  type: z.string().min(1).max(80),
  payload: z.unknown().optional(),
  maxAttempts: z.number().int().min(1).max(MAX_ALLOWED_ATTEMPTS).optional(),
  /** Recorded in audit only; the Job row carries no actor column. */
  actorId: z.string().optional(),
});

export async function enqueueJob(input: unknown) {
  const parsed = enqueueInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new JobError("VALIDATION_ERROR", "Invalid enqueueJob input.", false);
  }
  const { organizationId, type, actorId } = parsed.data;
  const maxAttempts = parsed.data.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (!isKnownJobType(type)) {
    throw new JobError(
      "UNKNOWN_JOB_TYPE",
      `Unknown job type "${type}". Known types: ${listJobTypes().join(", ")}.`,
      false,
    );
  }
  assertNoSecrets(parsed.data.payload);
  const payloadSchema = JOB_PAYLOAD_SCHEMAS[type as JobTypeName];
  const payloadParsed = payloadSchema.safeParse(parsed.data.payload ?? {});
  if (!payloadParsed.success) {
    const first = payloadParsed.error.issues[0];
    throw new JobError(
      "VALIDATION_ERROR",
      first
        ? `Invalid payload for job "${type}": ${first.path.join(".") || "(root)"} — ${first.message}`
        : `Invalid payload for job "${type}".`,
      false,
    );
  }

  const job = await db.job.create({
    data: {
      organizationId,
      name: type,
      payload: payloadParsed.data as object,
      status: "QUEUED",
      maxAttempts,
    },
  });
  await audit({
    organizationId,
    actorId: actorId ?? null,
    action: "job.created",
    resource: "Job",
    resourceId: job.id,
    result: "SUCCESS",
    metadata: { type },
  });
  return job;
}

// ── Claim (atomic) ───────────────────────────────────────────────────────

export interface ClaimedJob extends EngineJob {
  status: "RUNNING";
}

/**
 * Claim the oldest due job. Returns null when nothing is due.
 * The UPDATE … WHERE status IN (QUEUED, RETRYING) guard makes the claim
 * atomic: a racing worker's UPDATE matches zero rows.
 */
export async function claimJob(organizationId?: string): Promise<ClaimedJob | null> {
  const now = Date.now();
  const claimed = await db.$transaction(async (tx) => {
    const candidates = await tx.job.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        OR: [
          { status: "QUEUED" },
          {
            status: "RETRYING",
            updatedAt: { lte: new Date(now - MIN_BACKOFF_MS) },
          },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: 10,
    });
    const due = candidates.find((c) =>
      c.status === "QUEUED"
        ? true
        : c.updatedAt.getTime() <= now - backoffMs(c.attempts),
    );
    if (!due) return null;
    const updated = await tx.job.updateMany({
      where: { id: due.id, status: { in: ["QUEUED", "RETRYING"] } },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        startedAt: new Date(),
        error: null,
      },
    });
    if (updated.count !== 1) return null; // lost the race
    return { ...due, status: "RUNNING" as const, attempts: due.attempts + 1 };
  });
  if (claimed) {
    await audit({
      organizationId: claimed.organizationId,
      action: "job.claimed",
      resource: "Job",
      resourceId: claimed.id,
      result: "SUCCESS",
      metadata: { type: claimed.name, attempt: claimed.attempts },
    });
  }
  return claimed;
}

/**
 * Claim one specific job by id (org-scoped). Same atomic guard as claimJob:
 * the UPDATE … WHERE status IN (QUEUED, RETRYING) makes the claim safe under
 * races — a concurrent worker's UPDATE matches zero rows and this returns
 * null instead of double-executing. Used by manual "run now" triggers so the
 * just-enqueued job starts immediately instead of waiting for the next tick.
 */
export async function claimJobById(
  jobId: string,
  organizationId: string,
): Promise<ClaimedJob | null> {
  const now = Date.now();
  const claimed = await db.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId } });
    if (!job || job.organizationId !== organizationId) return null;
    if (job.status !== "QUEUED" && job.status !== "RETRYING") return null;
    if (
      job.status === "RETRYING" &&
      job.updatedAt.getTime() > now - backoffMs(job.attempts)
    ) {
      return null; // backoff not elapsed yet
    }
    const updated = await tx.job.updateMany({
      where: { id: job.id, status: { in: ["QUEUED", "RETRYING"] } },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        startedAt: new Date(),
        error: null,
      },
    });
    if (updated.count !== 1) return null; // lost the race
    return { ...job, status: "RUNNING" as const, attempts: job.attempts + 1 };
  });
  if (claimed) {
    await audit({
      organizationId: claimed.organizationId,
      action: "job.claimed",
      resource: "Job",
      resourceId: claimed.id,
      result: "SUCCESS",
      metadata: { type: claimed.name, attempt: claimed.attempts, manual: true },
    });
  }
  return claimed;
}

// ── Execute ──────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new JobError("TIMEOUT", `Job handler timed out after ${ms}ms.`, true)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function markTerminal(
  job: ClaimedJob,
  jobErr: JobError,
  disposition: "failed_permanent" | "dead_lettered",
): Promise<void> {
  await db.job.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      error: `[${jobErr.code}] ${truncateError(jobErr.message)}`,
    },
  });
  await audit({
    organizationId: job.organizationId,
    action: disposition === "failed_permanent" ? "job.failed_permanent" : "job.dead_lettered",
    resource: "Job",
    resourceId: job.id,
    result: "FAILED",
    metadata: { type: job.name, attempt: job.attempts, code: jobErr.code },
  });
}

/**
 * Execute one claimed job. Never throws — all outcomes are persisted and
 * reported via the disposition.
 */
export async function executeJob(
  job: ClaimedJob,
  opts: { timeoutMs?: number } = {},
): Promise<ExecuteResult> {
  const organizationId = job.organizationId;
  if (!organizationId) {
    await markTerminal(
      job,
      new JobError("NO_ORGANIZATION", "Job has no organization; Phase 3 requires org-scoped jobs.", false),
      "failed_permanent",
    );
    return { disposition: "failed_permanent" };
  }

  if (isKillSwitchOn()) {
    // Preserve the job: revert to QUEUED without running the handler.
    await db.job.update({ where: { id: job.id }, data: { status: "QUEUED" } });
    await audit({
      organizationId,
      action: "job.kill_switch_blocked",
      resource: "Job",
      resourceId: job.id,
      result: "DENIED",
      metadata: { type: job.name },
    });
    return { disposition: "killed" };
  }

  const handler = getJobHandler(job.name);
  if (!handler) {
    await markTerminal(
      job,
      new JobError("UNKNOWN_JOB_TYPE", `Unknown job type "${job.name}".`, false),
      "failed_permanent",
    );
    return { disposition: "failed_permanent" };
  }

  const ctx: JobContext = {
    organizationId,
    actorId: "system",
    jobId: job.id,
    attempt: job.attempts,
  };
  try {
    const raw = await withTimeout(
      handler(ctx, job.payload),
      opts.timeoutMs ?? JOB_TIMEOUT_MS,
    );
    const summary = (raw as { summary?: unknown } | null)?.summary ?? raw ?? undefined;
    await db.job.update({
      where: { id: job.id },
      data: { status: "COMPLETED", finishedAt: new Date(), error: null },
    });
    await audit({
      organizationId,
      action: "job.completed",
      resource: "Job",
      resourceId: job.id,
      result: "SUCCESS",
      metadata: { type: job.name, attempt: job.attempts },
    });
    return { disposition: "completed", summary };
  } catch (err) {
    const jobErr =
      err instanceof JobError
        ? err
        : new JobError("HANDLER_ERROR", sanitizedMessage(err), true);
    const exhausted = job.attempts >= job.maxAttempts;
    if (!jobErr.retryable || exhausted) {
      await markTerminal(job, jobErr, !jobErr.retryable ? "failed_permanent" : "dead_lettered");
      return { disposition: !jobErr.retryable ? "failed_permanent" : "dead_lettered" };
    }
    await db.job.update({
      where: { id: job.id },
      data: { status: "RETRYING", error: `[${jobErr.code}] ${truncateError(jobErr.message)}` },
    });
    await audit({
      organizationId,
      action: "job.retrying",
      resource: "Job",
      resourceId: job.id,
      result: "FAILED",
      metadata: {
        type: job.name,
        attempt: job.attempts,
        code: jobErr.code,
        nextRetryInMs: backoffMs(job.attempts),
      },
    });
    return { disposition: "retrying" };
  }
}

// ── Stale recovery ───────────────────────────────────────────────────────

export async function recoverStaleJobs(
  olderThanMs: number = STALE_JOB_TIMEOUT_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db.job.findMany({
    where: { status: "RUNNING", updatedAt: { lt: cutoff } },
    select: { id: true, organizationId: true, name: true, attempts: true, maxAttempts: true },
  });
  let recovered = 0;
  for (const job of stale) {
    const canRetry = job.attempts < job.maxAttempts;
    // Guarded update: only recover if still RUNNING (another worker may
    // have finished it between the find and the update).
    const updated = await db.job.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: canRetry
        ? { status: "RETRYING", error: "Recovered from stale RUNNING state (worker may have crashed)." }
        : {
            status: "FAILED",
            finishedAt: new Date(),
            error: "Stale RUNNING job exceeded max attempts.",
          },
    });
    if (updated.count === 1) {
      recovered++;
      await audit({
        organizationId: job.organizationId,
        action: "job.stale_recovered",
        resource: "Job",
        resourceId: job.id,
        result: canRetry ? "SUCCESS" : "FAILED",
        metadata: { type: job.name, attempt: job.attempts },
      });
    }
  }
  return recovered;
}

// ── Bounded batch ────────────────────────────────────────────────────────

export async function runBatch(
  opts: { limit?: number; organizationId?: string } = {},
): Promise<BatchStats> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const stats: BatchStats = {
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    killed: false,
  };
  if (isKillSwitchOn()) {
    stats.killed = true;
    return stats;
  }
  await recoverStaleJobs();
  for (let i = 0; i < limit; i++) {
    const job = await claimJob(opts.organizationId);
    if (!job) break;
    stats.claimed++;
    const result = await executeJob(job);
    switch (result.disposition) {
      case "completed":
        stats.completed++;
        break;
      case "retrying":
        stats.retried++;
        break;
      case "failed_permanent":
      case "dead_lettered":
        stats.failed++;
        break;
      case "killed":
        stats.killed = true;
        break;
    }
    if (result.disposition === "killed") break;
  }
  return stats;
}
