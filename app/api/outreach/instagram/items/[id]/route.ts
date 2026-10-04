import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import {
  getItem,
  editItemMessage,
  markItemCopied,
  markItemContacted,
  recordProfileOpened,
} from "@/lib/outreach/instagram-service";
import { instagramItemEditSchema } from "@/lib/validators";

const notFound = (err: unknown) =>
  err instanceof Error && err.message === "NOT_FOUND";

export const GET = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const { id } = await params;
    try {
      const item = await getItem(ctx.organization.id, id);
      return NextResponse.json({ item });
    } catch (err) {
      if (notFound(err)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      throw err;
    }
  },
  { minRole: "VIEWER" },
);

/**
 * PATCH /api/outreach/instagram/items/[id]
 * Body: { action: "edit", message } | { action: "copied" } |
 *       { action: "contacted" } | { action: "profile_opened" }
 *
 * All actions are user-driven review steps. Nothing sends to Instagram.
 */
export const PATCH = withWorkspace(
  async (req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success)
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

    const { id } = await params;
    const body = await req.json().catch(() => null);
    const action = body?.action as string | undefined;

    try {
      switch (action) {
        case "edit": {
          const parsed = instagramItemEditSchema.safeParse(body);
          if (!parsed.success)
            return NextResponse.json(
              { error: "INVALID_INPUT", details: parsed.error.flatten() },
              { status: 400 },
            );
          const item = await editItemMessage(ctx.organization.id, ctx.user.id, id, parsed.data.message);
          return NextResponse.json({ item });
        }
        case "copied": {
          const item = await markItemCopied(ctx.organization.id, ctx.user.id, id);
          return NextResponse.json({ item });
        }
        case "contacted": {
          const item = await markItemContacted(ctx.organization.id, ctx.user.id, id);
          return NextResponse.json({ item });
        }
        case "profile_opened": {
          await recordProfileOpened(ctx.organization.id, ctx.user.id, id);
          return NextResponse.json({ ok: true });
        }
        default:
          return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
      }
    } catch (err) {
      if (notFound(err)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      if (err instanceof Error && err.message === "INVALID_MESSAGE")
        return NextResponse.json({ error: "INVALID_MESSAGE" }, { status: 400 });
      throw err;
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
