import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { createLeadSchema, listLeadsQuerySchema } from "@/lib/validators";
import { createLead, listLeads } from "@/lib/leads";
import { checkLeadQuota } from "@/lib/quotas";
import { audit } from "@/lib/audit";

function rateLimited(res: { remaining: number; reset: number }) {
  return NextResponse.json(
    { error: "RATE_LIMITED" },
    {
      status: 429,
      headers: {
        "X-RateLimit-Remaining": String(res.remaining),
        "X-RateLimit-Reset": String(res.reset),
      },
    },
  );
}

export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) return rateLimited(rl);

  const parsed = listLeadsQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_QUERY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = await listLeads(ctx.organization.id, parsed.data);
  return NextResponse.json(result);
});

export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) return rateLimited(rl);

    const body = await req.json().catch(() => null);
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const quota = await checkLeadQuota(ctx.organization.id);
    if (!quota.allowed) {
      return NextResponse.json(
        { error: "LEAD_QUOTA_EXCEEDED", used: quota.used, limit: quota.limit },
        { status: 403 },
      );
    }

    const { lead, duplicate } = await createLead(
      ctx.organization.id,
      ctx.user.id,
      parsed.data,
    );

    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "lead.create",
      resource: "lead",
      resourceId: lead.id,
      req,
    });

    return NextResponse.json(
      { lead, duplicate: duplicate ? { id: duplicate.id } : null },
      { status: 201 },
    );
  },
  { minRole: "SALES_EXECUTIVE" },
);
