import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { bulkUpdateSchema } from "@/lib/validators";
import { isOrgMember } from "@/lib/leads";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/** POST /api/leads/bulk — bulk status / tags / assignment. Max 200 ids. */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success)
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

    const body = await req.json().catch(() => null);
    const parsed = bulkUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { ids, status, tagsToAdd, tagsToRemove, assignedToId } = parsed.data;
    const orgId = ctx.organization.id;

    // Assignees must belong to this workspace — never link leads to an
    // arbitrary user id (cross-tenant linkage).
    if (assignedToId) {
      const member = await isOrgMember(orgId, assignedToId);
      if (!member) {
        return NextResponse.json({ error: "INVALID_ASSIGNEE" }, { status: 422 });
      }
    }

    // Verify all ids belong to this workspace (tenant guard for bulk ops).
    const owned = await db.lead.findMany({
      where: { id: { in: ids }, organizationId: orgId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      await audit({
        organizationId: orgId,
        actorId: ctx.user.id,
        action: "lead.bulk",
        resource: "lead",
        result: "DENIED",
        metadata: { reason: "cross-tenant ids in bulk request" },
        req,
      });
      return NextResponse.json({ error: "WORKSPACE_ACCESS_DENIED" }, { status: 403 });
    }
    const ownedIds = owned.map((l) => l.id);

    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (assignedToId !== undefined)
      data.assignedTo = assignedToId
        ? { connect: { id: assignedToId } }
        : { disconnect: true };

    const result = await db.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.lead.updateMany({ where: { id: { in: ownedIds } }, data });
      }
      if (tagsToAdd?.length) {
        for (const name of tagsToAdd) {
          const tag = await tx.tag.upsert({
            where: { organizationId_name: { organizationId: orgId, name } },
            update: {},
            create: { organizationId: orgId, name },
          });
          await tx.leadTag.createMany({
            data: ownedIds.map((leadId) => ({ leadId, tagId: tag.id })),
            skipDuplicates: true,
          });
        }
      }
      if (tagsToRemove?.length) {
        await tx.leadTag.deleteMany({
          where: { leadId: { in: ownedIds }, tag: { name: { in: tagsToRemove } } },
        });
      }
      return { updated: ownedIds.length };
    });

    await audit({
      organizationId: orgId,
      actorId: ctx.user.id,
      action: "lead.bulk",
      resource: "lead",
      result: "SUCCESS",
      metadata: { count: result.updated, status, tagsToAdd, tagsToRemove },
      req,
    });

    return NextResponse.json(result);
  },
  { minRole: "SALES_EXECUTIVE" },
);
