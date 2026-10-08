import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import {
  startManualRunNow,
  ManualRunError,
} from "@/lib/prospecting/instagram-manual";

/**
 * POST /api/prospecting/run-now — manually trigger today's prospecting run.
 *
 * Durable execution (§2): this endpoint NEVER runs the pipeline itself and
 * never depends on the HTTP request lifecycle staying alive.
 *
 *   1. Guards (kill switch, plan/day, quota) run synchronously.
 *   2. Today's run slot is claimed up-front as a QUEUED run row (visible
 *      in run history immediately; unique per org/day).
 *   3. Exactly one job is enqueued through the existing job engine.
 *   4. The response returns immediately: { queued: true, jobId, runId }.
 *   5. Best-effort: a fire-and-forget dispatch to the existing
 *      /api/automation/tick worker asks it to drain the queue now. The
 *      dispatch is best-effort — if it never lands, the job stays QUEUED
 *      (durable in the DB) and the next scheduled tick picks it up.
 *
 * The job engine (claim → execute → COMPLETED/RETRYING/FAILED, atomic
 * claims, stale recovery, max attempts, kill switch, audit) is the SOLE
 * execution mechanism. No second engine, no lifecycle bypass.
 *
 * SALES_EXECUTIVE+.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`prospecting:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    try {
      const result = await startManualRunNow(ctx.organization.id, ctx.user.id);

      if (result.status === "already_completed") {
        return NextResponse.json({
          run: result.run,
          alreadyRan: true,
          message: "Today's run already completed.",
        });
      }

      // Best-effort immediate drain through the existing tick worker.
      // waitUntil is used ONLY to dispatch this tiny fetch — the heavy
      // prospecting work runs inside the tick worker's own execution (the
      // job engine), never in this request's background. If the dispatch
      // fails or the worker is killed, the job remains QUEUED in the DB
      // and the scheduled tick drains it — nothing is lost or pretended.
      const tickUrl = `${req.nextUrl.origin}/api/automation/tick`;
      const cronSecret = process.env.CRON_SECRET;
      if (cronSecret) {
        waitUntil(
          fetch(tickUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${cronSecret}`,
            },
            body: JSON.stringify({ limit: 1, organizationId: ctx.organization.id }),
          }).catch((err) => {
            console.error(
              "[prospecting/run-now] tick dispatch failed (job stays QUEUED for the next tick)",
              err instanceof Error ? err.message : err,
            );
          }),
        );
      }

      return NextResponse.json({
        run: result.run,
        jobId: result.jobId,
        queued: true,
        message:
          "Run queued — the worker picks it up now, or at the next scheduled tick. Watch the run history for live progress.",
      });
    } catch (err) {
      if (err instanceof ManualRunError) {
        const status =
          err.code === "KILL_SWITCH_ACTIVE"
            ? 503
            : err.code === "NO_ACTIVE_PLAN_DAY"
              ? 422
              : err.code === "RUN_ALREADY_IN_PROGRESS"
                ? 409
                : 429; // QUOTA_EXCEEDED
        return NextResponse.json(
          { error: err.code, message: err.message, runId: err.runId ?? undefined },
          { status },
        );
      }
      throw err;
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
