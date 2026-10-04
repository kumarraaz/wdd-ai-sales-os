import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { regenerateItemMessage } from "@/lib/outreach/instagram-service";

/**
 * POST /api/outreach/instagram/items/[id]/regenerate — regenerate the
 * draft message with the AI provider (or template fallback).
 */
export const POST = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`outreach:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success)
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

    const { id } = await params;
    try {
      const item = await regenerateItemMessage(ctx.organization.id, ctx.user.id, id);
      return NextResponse.json({ item });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND")
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      throw err;
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
