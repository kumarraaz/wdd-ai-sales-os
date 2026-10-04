/**
 * POST /api/automation/tick — protected worker endpoint.
 *
 * Server-to-server only. Requires CRON_SECRET (never exposed to the
 * browser):
 *   Authorization: Bearer <CRON_SECRET>   (preferred)
 *   x-cron-secret: <CRON_SECRET>           (alternative)
 *
 * Each invocation:
 *   1. verifies the secret (constant-time compare; 503 if unconfigured)
 *   2. evaluates due schedule-triggered automations per org (error-isolated)
 *   3. runs a bounded batch of jobs (default 5, max 20)
 *   4. returns sanitized statistics (no payloads, no secrets)
 *
 * No infinite loops: one bounded batch per request. Schedule this endpoint
 * from the platform cron (e.g. Vercel Cron) every few minutes.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runBatch } from "@/lib/automation/runner";
import { isKillSwitchOn } from "@/lib/automation/types";
import { evaluateAutomations } from "@/lib/automation/scheduler";

function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  const provided =
    bearer || req.headers.get("x-cron-secret") || "";
  if (!secretsEqual(provided, secret)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let limit = 5;
  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.min(Math.max(Math.floor(body.limit), 1), 20);
    }
  } catch {
    // ignore malformed bodies; defaults apply
  }

  const killed = isKillSwitchOn();
  const scheduler = { evaluated: 0, fired: 0, enqueued: 0, skipped: 0 };

  if (!killed) {
    // Evaluate due automations per org; one org's failure never blocks others.
    const orgs = await db.automation.findMany({
      where: { status: "ACTIVE" },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    for (const { organizationId } of orgs) {
      try {
        const s = await evaluateAutomations(organizationId);
        scheduler.evaluated += s.evaluated;
        scheduler.fired += s.fired;
        scheduler.enqueued += s.enqueued;
        scheduler.skipped += s.skipped;
      } catch (err) {
        // Isolated: continue with the next organization.
        console.error(
          "[automation/tick] scheduler failed for org",
          organizationId,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const batch = await runBatch({ limit });

  return NextResponse.json({
    killSwitch: killed || batch.killed,
    scheduler,
    jobs: {
      claimed: batch.claimed,
      completed: batch.completed,
      failed: batch.failed,
      retried: batch.retried,
    },
  });
}
