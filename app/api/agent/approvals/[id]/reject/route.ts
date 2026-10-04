/**
 * POST /api/agent/approvals/[id]/reject — human rejects a pending action.
 * Body: { "reason"?: "optional rejection reason" }
 */
import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { rejectApproval, ApprovalError } from "@/lib/agent/approvals/service";

export const POST = withWorkspace(
  async (req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`agent:approvals:reject:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const { id } = await params;
    try {
      const body = await req.json().catch(() => null);
      const approval = await rejectApproval(ctx, id, body);
      return NextResponse.json({
        success: true,
        approval: {
          id: approval.id,
          status: approval.status,
          actionType: approval.actionType,
        },
      });
    } catch (err) {
      if (err instanceof ApprovalError) {
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: err.httpStatus },
        );
      }
      throw err;
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
