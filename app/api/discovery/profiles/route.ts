import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { z } from "zod";
import {
  createProfile,
  deleteProfile,
  discoveryProfileConfigSchema,
  getProfile,
  listProfiles,
  updateProfile,
} from "@/lib/discovery/profiles";
import { audit } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  config: discoveryProfileConfigSchema,
});

/** GET /api/discovery/profiles — saved discovery profiles. */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const profiles = await listProfiles(ctx.organization.id);
  return NextResponse.json({ profiles });
});

/** POST /api/discovery/profiles — save a new profile. */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    try {
      const profile = await createProfile(
        ctx.organization.id,
        parsed.data.name,
        parsed.data.config,
      );
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "discovery.profile.create",
        resource: "DiscoveryProfile",
        resourceId: profile.id,
        metadata: { name: profile.name },
        req,
      });
      return NextResponse.json({ profile }, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/unique|Unique/i.test(msg)) {
        return NextResponse.json(
          { error: "PROFILE_NAME_EXISTS", message: "A profile with this name already exists." },
          { status: 409 },
        );
      }
      throw err;
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
