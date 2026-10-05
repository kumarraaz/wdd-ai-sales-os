/**
 * Manual "Run Now" orchestration for Instagram prospecting.
 *
 * Problem it solves: POST /api/prospecting/run-now used to only enqueue a
 * job. Nothing drains the job queue except /api/automation/tick, which on
 * Vercel Hobby fires once daily — so a manual run sat QUEUED for up to 24h
 * and never appeared in run history (the run row is created by the pipeline
 * when the job executes).
 *
 * This module:
 *   1. runs the same guards as before (kill switch, plan/day, quota),
 *   2. claims today's run slot up-front by creating the
 *      InstagramProspectingRun row with status QUEUED — so the run is
 *      visible in run history immediately,
 *   3. enqueues the job through the existing engine (unchanged lifecycle),
 *   4. the route then drives claim+execute for that exact job via the
 *      existing runner (claimJobById → executeJob) in a post-response
 *      waitUntil — no second execution engine, no lifecycle bypass.
 *
 * Duplicate presses are safe: the run row is unique per org/day, a second
 * press sees QUEUED/RUNNING and gets RUN_ALREADY_IN_PROGRESS, and a racing
 * press loses on the unique constraint (P2002 → same error).
 */
import { db } from "../db";
import { audit } from "../audit";
import { enqueueJob, claimJobById, executeJob } from "../automation/runner";
import { isKillSwitchOn } from "../automation/types";
import { checkDiscoveryQuota } from "../quotas";
import { getTodayDay } from "./instagram-plan";
import { STALE_RUN_TAKEOVER_MS } from "./instagram-pipeline";

export type ManualRunCode =
  | "KILL_SWITCH_ACTIVE"
  | "NO_ACTIVE_PLAN_DAY"
  | "RUN_ALREADY_IN_PROGRESS"
  | "QUOTA_EXCEEDED";

export class ManualRunError extends Error {
  code: ManualRunCode;
  runId?: string;
  constructor(code: ManualRunCode, message: string, runId?: string) {
    super(message);
    this.name = "ManualRunError";
    this.code = code;
    this.runId = runId;
  }
}

export interface ManualRunStarted {
  status: "started";
  run: {
    id: string;
    runDate: string;
    dayOfWeek: number;
    targetCount: number;
    status: string;
    triggeredBy: string;
    startedAt: string;
  };
  jobId: string;
}

export interface ManualRunAlreadyDone {
  status: "already_completed";
  run: ManualRunStarted["run"];
}

function serializeRun(run: {
  id: string;
  runDate: string;
  dayOfWeek: number;
  targetCount: number;
  status: string;
  triggeredBy: string;
  startedAt: Date;
}): ManualRunStarted["run"] {
  return {
    id: run.id,
    runDate: run.runDate,
    dayOfWeek: run.dayOfWeek,
    targetCount: run.targetCount,
    status: run.status,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt.toISOString(),
  };
}

const isStale = (startedAt: Date, now: Date) =>
  now.getTime() - startedAt.getTime() > STALE_RUN_TAKEOVER_MS;

/**
 * Validate, claim today's run slot (QUEUED row), and enqueue the job.
 * Does NOT execute the job — the caller drives execution via
 * executeManualJobNow (route: inside waitUntil so the response is fast).
 */
export async function startManualRunNow(
  organizationId: string,
  actorId: string,
  opts: { now?: Date } = {},
): Promise<ManualRunStarted | ManualRunAlreadyDone> {
  const now = opts.now ?? new Date();

  if (isKillSwitchOn()) {
    throw new ManualRunError("KILL_SWITCH_ACTIVE", "Automation kill switch is active.");
  }

  const today = await getTodayDay(organizationId, now);
  if (!today) {
    throw new ManualRunError(
      "NO_ACTIVE_PLAN_DAY",
      "No active prospecting plan for today.",
    );
  }

  const existingRun = await db.instagramProspectingRun.findUnique({
    where: {
      organizationId_runDate: {
        organizationId,
        runDate: today.runDate,
      },
    },
  });
  if (existingRun?.status === "COMPLETED") {
    return { status: "already_completed", run: serializeRun(existingRun) };
  }
  if (existingRun?.status === "QUEUED" && !isStale(existingRun.startedAt, now)) {
    throw new ManualRunError(
      "RUN_ALREADY_IN_PROGRESS",
      "Today's run is already queued.",
      existingRun.id,
    );
  }
  if (existingRun?.status === "RUNNING" && !isStale(existingRun.startedAt, now)) {
    throw new ManualRunError(
      "RUN_ALREADY_IN_PROGRESS",
      "Today's run is already in progress.",
      existingRun.id,
    );
  }
  // QUEUED/RUNNING but stale, FAILED, or no row: proceed. The pipeline takes
  // over stale rows; FAILED rows are retried by the pipeline's reset path.

  const quota = await checkDiscoveryQuota(organizationId, today.day.targetCount);
  if (!quota.allowed) {
    throw new ManualRunError(
      "QUOTA_EXCEEDED",
      quota.reason ?? "Daily discovery quota reached.",
    );
  }

  // Claim today's slot up-front so the run is visible in history immediately
  // and a duplicate press (or race) cannot create a second run. FAILED and
  // stale rows are reused — the pipeline resets them on takeover.
  let run;
  if (!existingRun) {
    try {
      run = await db.instagramProspectingRun.create({
        data: {
          organizationId,
          planId: today.plan.id,
          dayOfWeek: today.dayOfWeek,
          runDate: today.runDate,
          targetCount: today.day.targetCount,
          status: "QUEUED",
          triggeredBy: "MANUAL",
        },
      });
    } catch (err) {
      // Lost a race with another press — today's slot is taken.
      if ((err as { code?: string })?.code === "P2002") {
        throw new ManualRunError(
          "RUN_ALREADY_IN_PROGRESS",
          "Today's run was just started by another request.",
        );
      }
      throw err;
    }
  } else {
    run = existingRun;
  }

  const job = await enqueueJob({
    organizationId,
    type: "prospecting.instagram.daily",
    payload: { planId: today.plan.id, manual: true },
    actorId,
  });

  await audit({
    organizationId,
    actorId,
    action: "prospecting.instagram.manual_run_enqueued",
    resource: "job",
    resourceId: job.id,
    metadata: {
      runId: run.id,
      runDate: today.runDate,
      industry: today.day.industry,
    },
  });

  return { status: "started", run: serializeRun(run), jobId: job.id };
}

/**
 * Immediately claim + execute one specific job through the existing engine
 * (same claim/execute/kill-switch/audit/timeout/retry path as the tick
 * worker — no second engine, no lifecycle bypass). Returns the execution
 * disposition; null when the job was already claimed elsewhere.
 */
export async function executeManualJobNow(
  organizationId: string,
  jobId: string,
): Promise<{ claimed: boolean; disposition?: string }> {
  const claimed = await claimJobById(jobId, organizationId);
  if (!claimed) {
    // Already claimed by the tick worker or another trigger — it is (or
    // will be) executing; nothing more to do here.
    return { claimed: false };
  }
  const result = await executeJob(claimed);
  return { claimed: true, disposition: result.disposition };
}
