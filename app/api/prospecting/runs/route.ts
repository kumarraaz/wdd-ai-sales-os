import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { listRuns } from "@/lib/prospecting/instagram-plan";

/**
 * GET /api/prospecting/runs — daily run history (newest first).
 * Shows what each day's automation actually did: target, found, new,
 * duplicates skipped, researched, messages, CRM imports, failures.
 */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const take = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("take") ?? "30", 10) || 30, 1),
    100,
  );
  const runs = await listRuns(ctx.organization.id, take);
  return NextResponse.json({ runs });
});
