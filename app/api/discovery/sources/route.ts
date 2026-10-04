import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { getSourceCatalog } from "@/lib/discovery/sources";

/**
 * GET /api/discovery/sources — source catalog with live availability.
 * Never exposes secret values — only configured/not-configured booleans,
 * usage counters, and setup instructions.
 */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const catalog = await getSourceCatalog(ctx.organization.id);
  return NextResponse.json(catalog);
});
