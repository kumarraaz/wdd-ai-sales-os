/**
 * GET /api/agent/approvals — list approval requests for the current workspace.
 * Query: ?status=&actionType=&workflowId=&page=&pageSize=
 */
import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import {
  listApprovals,
  toApprovalDTO,
  ApprovalError,
} from "@/lib/agent/approvals/service";

export const GET = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`agent:approvals:list:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    try {
      const q = req.nextUrl.searchParams;
      const result = await listApprovals(ctx, {
        status: q.get("status") ?? undefined,
        actionType: q.get("actionType") ?? undefined,
        workflowId: q.get("workflowId") ?? undefined,
        page: q.get("page") ?? undefined,
        pageSize: q.get("pageSize") ?? undefined,
      });
      return NextResponse.json({
        approvals: result.items.map(toApprovalDTO),
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      });
    } catch (err) {
      if (err instanceof ApprovalError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: err.httpStatus });
      }
      throw err;
    }
  },
  { minRole: "VIEWER" },
);
