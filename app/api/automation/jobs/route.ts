/**
 * /api/automation/jobs — tenant-scoped job queue API.
 *
 * GET  — list jobs for the caller's organization (SALES_EXECUTIVE+).
 * POST — enqueue a known job type (SALES_MANAGER+). Only registered job
 *        types are accepted; payloads are validated; organization comes
 *        from the server context, never the request body.
 */
import { NextRequest, NextResponse } from "next/server";
import { JobStatus } from "@prisma/client";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/automation/runner";
import { JobError } from "@/lib/automation/types";

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

const VALID_STATUSES = Object.values(JobStatus) as string[];

export const GET = withWorkspace(
  async (req, ctx) => {
    const rl = await checkRateLimit(`automation:jobs:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const statusParam = req.nextUrl.searchParams.get("status");
    if (statusParam && !VALID_STATUSES.includes(statusParam)) {
      return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
    }
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20,
      50,
    );
    const jobs = await db.job.findMany({
      where: {
        organizationId: ctx.organization.id,
        ...(statusParam ? { status: statusParam as JobStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: JOB_SELECT,
    });
    return NextResponse.json({ jobs });
  },
  { minRole: "SALES_EXECUTIVE" },
);

export const POST = withWorkspace(
  async (req, ctx) => {
    const rl = await checkRateLimit(`automation:jobs:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
    }
    const { type, payload, maxAttempts } = (body ?? {}) as {
      type?: unknown;
      payload?: unknown;
      maxAttempts?: unknown;
    };
    try {
      const job = await enqueueJob({
        organizationId: ctx.organization.id,
        type,
        payload,
        maxAttempts,
        actorId: ctx.user.id,
      });
      return NextResponse.json(
        {
          job: {
            id: job.id,
            name: job.name,
            status: job.status,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            createdAt: job.createdAt,
          },
        },
        { status: 201 },
      );
    } catch (err) {
      if (err instanceof JobError) {
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: 400 },
        );
      }
      throw err;
    }
  },
  { minRole: "SALES_MANAGER" },
);
