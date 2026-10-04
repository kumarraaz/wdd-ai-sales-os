/**
 * POST /api/agent/workflow — run a structured sales workflow (Phase 6).
 *
 * Accepts a natural-language sales goal (and optional structured hints),
 * plans it into a registered workflow via the workflow planner, and executes
 * it through the safe workflow executor.
 *
 * Authenticated, tenant-scoped, RBAC-gated, rate-limited. Organization ids are
 * never caller-controlled; the provider is resolved server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { planWorkflow, runWorkflow, WorkflowPlannerError, WorkflowExecutionError } from "@/lib/agent/workflow";

const workflowApiSchema = z
  .object({
    goal: z.string().trim().min(1).max(2000),
    constraints: z
      .object({
        leadId: z.string().cuid().optional(),
        outreachChannel: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN"]).optional(),
      })
      .strict()
      .optional(),
    budget: z
      .object({
        maxStages: z.number().optional(),
        maxToolCalls: z.number().optional(),
        maxLeads: z.number().optional(),
        maxRuntimeMs: z.number().optional(),
        maxAiCalls: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`agent:workflow:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = workflowApiSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      const planned = await planWorkflow({
        ctx,
        goal: parsed.data.goal,
        constraints: parsed.data.constraints,
      });

      const result = await runWorkflow({
        ctx,
        request: planned.request,
        budget: parsed.data.budget ?? undefined,
      });

      // The result is deterministic and sanitized (no secrets, no prompts).
      return NextResponse.json({
        result,
        planned: { usedFallback: planned.usedFallback },
      });
    } catch (err) {
      if (err instanceof WorkflowPlannerError || err instanceof WorkflowExecutionError) {
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: 400 },
        );
      }
      throw err;
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
