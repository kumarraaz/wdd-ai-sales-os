/**
 * POST /api/agent/run — invoke the AI Sales Mind (Phase 4).
 *
 * Minimal server-side entry point only (no Agent UI yet). Authenticated,
 * tenant-scoped, RBAC-gated, rate-limited. The provider is resolved
 * server-side; the client cannot select or configure it.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { runAgentGoal } from "@/lib/agent/mind";

const runAgentSchema = z
  .object({
    goal: z.string().trim().min(1).max(2000),
    budget: z
      .object({
        maxSteps: z.number().optional(),
        maxToolCalls: z.number().optional(),
        maxPlanSteps: z.number().optional(),
        maxRuntimeMs: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`agent:run:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = runAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await runAgentGoal({
      ctx,
      goal: parsed.data.goal,
      budget: parsed.data.budget ?? undefined,
    });

    // The result is already sanitized (no stack traces, no secrets).
    return NextResponse.json({ result });
  },
  { minRole: "SALES_EXECUTIVE" },
);
