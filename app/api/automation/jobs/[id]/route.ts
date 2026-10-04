/**
 * /api/automation/jobs/[id] — single job detail + cancel.
 *
 * GET  — job detail, strictly scoped to the caller's organization
 *        (SALES_EXECUTIVE+).
 * POST — { "action": "cancel" } transitions QUEUED/RETRYING jobs to
 *        CANCELLED (SALES_MANAGER+). Running jobs are left alone.
 */
import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

const JOB_SELECT = {
  id: true,
  name: true,
  status: true,
  attempts: true,
  maxAttempts: true,
  error: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  finishedAt: true,
} as const;

export const GET = withWorkspace(
  async (req, ctx, { params }) => {
    const rl = await checkRateLimit(`automation:jobs:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const { id } = await params;
    const job = await db.job.findFirst({
      where: { id, organizationId: ctx.organization.id },
      select: JOB_SELECT,
    });
    if (!job) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ job });
  },
  { minRole: "SALES_EXECUTIVE" },
);

export const POST = withWorkspace(
  async (req, ctx, { params }) => {
    const rl = await checkRateLimit(`automation:jobs:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const { id } = await params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
    }
    if ((body as { action?: unknown } | null)?.action !== "cancel") {
      return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
    }
    const updated = await db.job.updateMany({
      where: {
        id,
        organizationId: ctx.organization.id,
        status: { in: ["QUEUED", "RETRYING"] },
      },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "NOT_CANCELLABLE" }, { status: 409 });
    }
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "job.cancelled",
      resource: "Job",
      resourceId: id,
      result: "SUCCESS",
    });
    return NextResponse.json({ ok: true });
  },
  { minRole: "SALES_MANAGER" },
);
