import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { getUsage } from "@/lib/quotas";
import { db } from "@/lib/db";

/** GET /api/usage — plan usage for the active workspace (dashboard usage panel + sidebar plan card). */
export const GET = withWorkspace(async (_req, ctx) => {
  const [usage, sub] = await Promise.all([
    getUsage(ctx.organization.id),
    db.subscription.findUnique({
      where: { organizationId: ctx.organization.id },
      select: { status: true, plan: { select: { name: true, tier: true } } },
    }),
  ]);
  // `plan` is additive (sidebar plan card); null until provisioning has created a subscription.
  const plan = sub ? { name: sub.plan.name, tier: sub.plan.tier, status: sub.status } : null;
  return NextResponse.json({ organizationId: ctx.organization.id, usage, plan });
});
