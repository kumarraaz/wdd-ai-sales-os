import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { db } from "@/lib/db";

const listQuerySchema = z.object({
  leadId: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/intelligence/website-inspections?leadId=&limit=
 * Recent website inspections for this workspace, newest first.
 */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_QUERY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const inspections = await db.websiteInspection.findMany({
    where: {
      organizationId: ctx.organization.id,
      ...(parsed.data.leadId ? { leadId: parsed.data.leadId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit,
    include: {
      lead: { select: { id: true, fullName: true, website: true } },
    },
  });

  return NextResponse.json({ inspections });
});
