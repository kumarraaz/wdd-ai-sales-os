/**
 * POST /api/agent/approvals/[id]/approve — human approves a pending action.
 *
 * Atomically claims the approval (PENDING → APPROVED), executes ONLY the
 * stored snapshot through the allowlisted dispatcher, records EXECUTED/FAILED,
 * then resumes the paused workflow from the next stage when possible.
 */
import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { approveApproval, ApprovalError } from "@/lib/agent/approvals/service";
import { resumeWorkflowFromCheckpoint } from "@/lib/agent/workflow/executor";

export const POST = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`agent:approvals:approve:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const { id } = await params;
    try {
      const { approval, execution, alreadyExecuted } = await approveApproval(ctx, id);

      let workflow: Record<string, unknown> | null = null;
      if (alreadyExecuted) {
        workflow = { status: "ALREADY_EXECUTED" };
      } else if (execution.ok && approval.workflowSnapshot) {
        try {
          const resumed = await resumeWorkflowFromCheckpoint({ ctx, approval });
          workflow = {
            status: resumed.status,
            workflowRunId: resumed.workflowRunId,
            counts: resumed.counts,
            resumedFromApprovalId: approval.id,
          };
        } catch (err) {
          workflow = {
            status: "RESUME_FAILED",
            error: err instanceof Error ? err.message : "Workflow resume failed.",
          };
        }
      } else if (!execution.ok) {
        workflow = { status: "NOT_RESUMED", reason: "Action execution failed; workflow not resumed." };
      }

      return NextResponse.json({
        success: true,
        approval: {
          id: approval.id,
          status: approval.status,
          actionType: approval.actionType,
        },
        execution: {
          ok: execution.ok,
          tool: execution.tool,
          resultId: execution.resultId ?? null,
          errorCode: execution.errorCode ?? null,
        },
        workflow,
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
