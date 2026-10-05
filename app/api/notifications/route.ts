import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { db } from "@/lib/db";

/**
 * GET /api/notifications — org notifications, unread first, newest first.
 * Used by the AppShell bell + the run-completion banner.
 */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
  const take = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("take") ?? "20", 10) || 20, 1),
    50,
  );
  const notifications = await db.notification.findMany({
    where: {
      organizationId: ctx.organization.id,
      ...(unreadOnly ? { readAt: null } : {}),
    },
    orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      metadata: true,
      readAt: true,
      createdAt: true,
    },
  });
  const unreadCount = await db.notification.count({
    where: { organizationId: ctx.organization.id, readAt: null },
  });
  return NextResponse.json({ notifications, unreadCount });
});

/**
 * POST /api/notifications — mark all as read.
 */
export const POST = withWorkspace(async (_req: NextRequest, ctx) => {
  await db.notification.updateMany({
    where: { organizationId: ctx.organization.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
});
