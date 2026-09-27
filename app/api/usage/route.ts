import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { getUsage } from "@/lib/quotas";

/** GET /api/usage — plan usage for the active workspace (drives the dashboard usage panel). */
export const GET = withWorkspace(async (_req, ctx) => {
  const usage = await getUsage(ctx.organization.id);
  return NextResponse.json({ organizationId: ctx.organization.id, usage });
});
