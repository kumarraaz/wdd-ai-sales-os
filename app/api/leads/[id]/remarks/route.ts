import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { remarkSchema } from "@/lib/validators";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * /api/leads/[id]/remarks — universal CRM remarks (all sources).
 * Backed by the existing Note model (body + author + timestamps).
 * Tenant-scoped: a lead from another org is invisible (404).
 */

export const GET = withWorkspace(
  async (req: NextRequest, ctx, { params }) => {
    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, organizationId: ctx.organization.id },
      select: { id: true },
    });
    if (!lead) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    const notes = await db.note.findMany({
      where: { leadId: id, organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const authorIds = [...new Set(notes.map((n) => n.authorId))];
    const authors = await db.user.findMany({
      where: { id: { in: authorIds } },
      select: { id: true, name: true, email: true },
    });
    const authorById = new Map(authors.map((a) => [a.id, a.name || a.email]));
    return NextResponse.json({
      remarks: notes.map((n) => ({
        id: n.id,
        body: n.body,
        author: authorById.get(n.authorId) ?? "Unknown",
        authorId: n.authorId,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    });
  },
);

export const POST = withWorkspace(
  async (req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, organizationId: ctx.organization.id },
      select: { id: true },
    });
    if (!lead) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = remarkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const note = await db.note.create({
      data: {
        organizationId: ctx.organization.id,
        leadId: id,
        authorId: ctx.user.id,
        body: parsed.data.body,
      },
    });
    await db.leadActivity.create({
      data: {
        organizationId: ctx.organization.id,
        leadId: id,
        type: "note",
        title: "Remark added",
        detail: parsed.data.body.slice(0, 280),
        actorId: ctx.user.id,
      },
    });
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "lead.remark_added",
      resource: "lead",
      resourceId: id,
      metadata: { noteId: note.id },
    });
    return NextResponse.json({ remark: { id: note.id, body: note.body, createdAt: note.createdAt } });
  },
  { minRole: "SALES_EXECUTIVE" },
);
