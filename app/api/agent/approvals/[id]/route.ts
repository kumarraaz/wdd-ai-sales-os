/**
 * GET /api/agent/approvals/[id] — approval detail (tenant-scoped).
 */
import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import {
  getApproval,
  toApprovalDTO,
  auditApprovalViewed,
} from "@/lib/agent/approvals/service";

export const GET = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`agent:approvals:get:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const { id } = await params;
    const approval = await getApproval(ctx, id);
    if (!approval) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    await auditApprovalViewed(ctx, approval.id);
    return NextResponse.json({ approval: toApprovalDTO(approval) });
  },
  { minRole: "VIEWER" },
);
