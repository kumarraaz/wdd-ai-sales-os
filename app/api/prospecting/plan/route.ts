import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { prospectingPlanSchema } from "@/lib/validators";
import { getPlan, upsertPlan } from "@/lib/prospecting/instagram-plan";
import { audit } from "@/lib/audit";

/**
 * GET /api/prospecting/plan — the org's weekly Instagram prospecting plan.
 * PUT /api/prospecting/plan — create/update the plan (SALES_MANAGER+).
 * Saving an active plan syncs the daily 9:00 AM scheduler automation.
 */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const plan = await getPlan(ctx.organization.id);
  return NextResponse.json({ plan });
});

export const PUT = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = prospectingPlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    // No duplicate weekdays in a single save.
    const dows = (parsed.data.days ?? []).map((d) => d.dayOfWeek);
    if (new Set(dows).size !== dows.length) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: "Duplicate weekday in plan days." },
        { status: 400 },
      );
    }
    const plan = await upsertPlan(ctx.organization.id, ctx.user.id, parsed.data);
    return NextResponse.json({ plan });
  },
  { minRole: "SALES_MANAGER" },
);
