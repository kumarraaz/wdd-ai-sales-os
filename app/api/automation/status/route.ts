/**
 * GET /api/automation/status — operator visibility (ADMIN+).
 *
 * Read-only: kill-switch state plus queue depth by status. The kill switch
 * itself can only be changed by the operator via environment — this
 * endpoint never mutates it.
 */
import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { db } from "@/lib/db";
import { isKillSwitchOn } from "@/lib/automation/types";

export const GET = withWorkspace(
  async (_req, ctx) => {
    const organizationId = ctx.organization.id;
    const [queued, running, retrying, failed] = await Promise.all(
      (["QUEUED", "RUNNING", "RETRYING", "FAILED"] as const).map((status) =>
        db.job.count({ where: { organizationId, status } }),
      ),
    );
    return NextResponse.json({
      killSwitch: isKillSwitchOn(),
      queue: { queued, running, retrying, failed },
    });
  },
  { minRole: "ADMIN" },
);
