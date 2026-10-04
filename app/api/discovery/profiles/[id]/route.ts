import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { z } from "zod";
import {
  deleteProfile,
  discoveryProfileConfigSchema,
  getProfile,
  updateProfile,
} from "@/lib/discovery/profiles";
import { audit } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: discoveryProfileConfigSchema.optional(),
});

/** GET /api/discovery/profiles/[id] */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const id = req.nextUrl.pathname.split("/").pop() ?? "";
  const profile = await getProfile(ctx.organization.id, id);
  if (!profile) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ profile });
});

/** PUT /api/discovery/profiles/[id] — rename / edit config. */
export const PUT = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const id = req.nextUrl.pathname.split("/").pop() ?? "";
    const body = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const res = await updateProfile(ctx.organization.id, id, parsed.data);
    if (res.count === 0) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "discovery.profile.update",
      resource: "DiscoveryProfile",
      resourceId: id,
      req,
    });
    return NextResponse.json({ ok: true });
  },
  { minRole: "SALES_EXECUTIVE" },
);

/** DELETE /api/discovery/profiles/[id] */
export const DELETE = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const id = req.nextUrl.pathname.split("/").pop() ?? "";
    const res = await deleteProfile(ctx.organization.id, id);
    if (res.count === 0) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "discovery.profile.delete",
      resource: "DiscoveryProfile",
      resourceId: id,
      req,
    });
    return NextResponse.json({ ok: true });
  },
  { minRole: "SALES_EXECUTIVE" },
);
