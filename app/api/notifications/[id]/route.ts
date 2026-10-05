import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { db } from "@/lib/db";

/**
 * POST /api/notifications/[id]/read — mark one notification as read.
 */
export const POST = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const { id } = await params;
    const updated = await db.notification.updateMany({
      where: { id, organizationId: ctx.organization.id },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
);
