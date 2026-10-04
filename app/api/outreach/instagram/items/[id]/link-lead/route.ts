import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { linkItemToLead, findLeadCandidates } from "@/lib/outreach/instagram-service";
import { instagramItemLinkSchema } from "@/lib/validators";

/**
 * GET — candidate leads for manual linking (same workspace only).
 * POST — link to an existing lead, or create one via the existing
 * createLead flow (explicit only, duplicate-checked, never silent).
 */
export const GET = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const { id } = await params;
    try {
      const candidates = await findLeadCandidates(ctx.organization.id, id);
      return NextResponse.json({ candidates });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND")
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      throw err;
    }
  },
  { minRole: "VIEWER" },
);

export const POST = withWorkspace(
  async (req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success)
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = instagramItemLinkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    try {
      const item = await linkItemToLead(ctx.organization.id, ctx.user.id, id, parsed.data);
      return NextResponse.json({ item });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND")
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      if (err instanceof Error && err.message === "LEAD_NOT_FOUND")
        return NextResponse.json({ error: "LEAD_NOT_FOUND" }, { status: 404 });
      if (err instanceof Error && err.message === "NO_ACTION")
        return NextResponse.json({ error: "NO_ACTION" }, { status: 400 });
      throw err;
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
