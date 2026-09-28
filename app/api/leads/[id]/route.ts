import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { updateLeadSchema } from "@/lib/validators";
import { getLead, updateLead, deleteLead, isOrgMember } from "@/lib/leads";
import { audit } from "@/lib/audit";

export const GET = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const { id } = await params;
    const lead = await getLead(ctx.organization.id, id);
    if (!lead) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ lead });
  },
);

export const PATCH = withWorkspace(
  async (req: NextRequest, ctx, { params }) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success)
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    // Assignees must belong to this workspace — never link a lead to an
    // arbitrary user id (cross-tenant linkage).
    if (parsed.data.assignedToId) {
      const member = await isOrgMember(ctx.organization.id, parsed.data.assignedToId);
      if (!member) {
        return NextResponse.json({ error: "INVALID_ASSIGNEE" }, { status: 422 });
      }
    }
    const lead = await updateLead(ctx.organization.id, ctx.user.id, id, parsed.data);
    if (!lead) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "lead.update",
      resource: "lead",
      resourceId: id,
      metadata: { fields: Object.keys(parsed.data) },
      req,
    });
    return NextResponse.json({ lead });
  },
  { minRole: "SALES_EXECUTIVE" },
);

export const DELETE = withWorkspace(
  async (req: NextRequest, ctx, { params }) => {
    const { id } = await params;
    const ok = await deleteLead(ctx.organization.id, id);
    if (!ok) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "lead.delete",
      resource: "lead",
      resourceId: id,
      req,
    });
    return NextResponse.json({ ok: true });
  },
  { minRole: "SALES_MANAGER" },
);
