import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import {
  startManualRunNow,
  executeManualJobNow,
  ManualRunError,
} from "@/lib/prospecting/instagram-manual";

/**
 * POST /api/prospecting/run-now — manually trigger today's prospecting run.
 *
 * Flow: guards (kill switch, plan/day, quota) → today's run slot is claimed
 * up-front as a QUEUED InstagramProspectingRun row (visible in run history
 * immediately; unique per org/day so duplicate presses can't double-run) →
 * the job is enqueued through the existing engine → the exact job is then
 * claimed+executed via the existing runner (claimJobById → executeJob) in a
 * post-response waitUntil, so the run starts immediately without waiting for
 * the next daily cron tick. Same lifecycle, kill switch, audit, timeouts and
 * retries as the scheduled path — no second execution engine.
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

      // Start the queued job right away, after the response is sent. Uses the
      // existing job runner — same claim/execute path as /api/automation/tick.
      const organizationId = ctx.organization.id;
      const jobId = result.jobId;
      waitUntil(
        executeManualJobNow(organizationId, jobId).catch((err) => {
          console.error(
            "[prospecting/run-now] background job execution failed",
            err instanceof Error ? err.message : err,
          );
        }),
      );

      return NextResponse.json({
        run: result.run,
        jobId: result.jobId,
        started: true,
        message: "Run started — watch the run history for live progress.",
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
