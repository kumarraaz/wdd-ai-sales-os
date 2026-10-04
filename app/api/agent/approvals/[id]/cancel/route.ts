/**
 * POST /api/agent/approvals/[id]/cancel — cancel a pending approval.
 * The proposed action is never executed.
 */
import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { cancelApproval, ApprovalError } from "@/lib/agent/approvals/service";

export const POST = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`agent:approvals:cancel:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const { id } = await params;
    try {
      const approval = await cancelApproval(ctx, id);
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
