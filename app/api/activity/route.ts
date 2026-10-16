/**
 * GET /api/activity — latest workspace activity for the dashboard feed
 * (any workspace member). Tenant-scoped via withWorkspace; rate limited;
 * returns only titles/details already visible to members elsewhere in the app.
 */
import { NextResponse } from "next/server";
import { getRecentActivity } from "@/lib/activity";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { withWorkspace } from "@/lib/tenant";

export const GET = withWorkspace(async (req, ctx) => {
  const rl = await checkRateLimit(`activity:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "6", 10) || 6, 20);
  const items = await getRecentActivity(ctx.organization.id, limit);
  return NextResponse.json({ items, generatedAt: new Date().toISOString() });
});
