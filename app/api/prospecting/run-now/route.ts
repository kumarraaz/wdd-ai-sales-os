import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { enqueueJob } from "@/lib/automation/runner";
import { isKillSwitchOn } from "@/lib/automation/types";
import { checkDiscoveryQuota } from "@/lib/quotas";
import { getTodayDay } from "@/lib/prospecting/instagram-plan";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * POST /api/prospecting/run-now — manually trigger today's prospecting run.
 *
 * Still respects: kill switch, daily quota, one-run-per-day (returns the
 * existing run instead of double-running), plan/day active flags, and the
 * pipeline's internal dedup + failure isolation. SALES_EXECUTIVE+.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`prospecting:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    if (isKillSwitchOn()) {
      return NextResponse.json({ error: "KILL_SWITCH_ACTIVE" }, { status: 503 });
    }

    const today = await getTodayDay(ctx.organization.id);
    if (!today) {
      return NextResponse.json(
        { error: "NO_ACTIVE_PLAN_DAY", message: "No active prospecting plan for today." },
        { status: 422 },
      );
    }

    const existingRun = await db.instagramProspectingRun.findUnique({
      where: {
        organizationId_runDate: {
          organizationId: ctx.organization.id,
          runDate: today.runDate,
        },
      },
    });
    if (existingRun?.status === "COMPLETED") {
      return NextResponse.json({
        run: existingRun,
        alreadyRan: true,
        message: "Today's run already completed.",
      });
    }
    if (existingRun?.status === "RUNNING") {
      return NextResponse.json(
        { error: "RUN_ALREADY_IN_PROGRESS", run: existingRun },
        { status: 409 },
      );
    }

    const quota = await checkDiscoveryQuota(ctx.organization.id, today.day.targetCount);
    if (!quota.allowed) {
      return NextResponse.json(
        { error: "QUOTA_EXCEEDED", message: quota.reason ?? "Daily discovery quota reached." },
        { status: 429 },
      );
    }

    const job = await enqueueJob({
      organizationId: ctx.organization.id,
      type: "prospecting.instagram.daily",
      payload: { planId: today.plan.id, manual: true },
      actorId: ctx.user.id,
    });

    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "prospecting.instagram.manual_run_enqueued",
      resource: "job",
      resourceId: job.id,
      metadata: { runDate: today.runDate, industry: today.day.industry },
    });

    return NextResponse.json({ jobId: job.id, runDate: today.runDate, enqueued: true });
  },
  { minRole: "SALES_EXECUTIVE" },
);
