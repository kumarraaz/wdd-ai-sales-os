import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { z } from "zod";
import { getDiscoveryProvider } from "@/lib/discovery/registry";
import { recordProviderUsage } from "@/lib/discovery/cost";
import { audit } from "@/lib/audit";

const testSchema = z.object({
  providerId: z.string().trim().min(1).max(60),
});

/**
 * POST /api/discovery/sources/test — cheap connectivity check.
 * Uses the provider's testConnection() (id-only / minimal calls).
 * Usage from the test is recorded honestly.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const body = await req.json().catch(() => null);
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const provider = getDiscoveryProvider(parsed.data.providerId);
    if (!provider) {
      return NextResponse.json({ error: "UNKNOWN_PROVIDER" }, { status: 404 });
    }
    if (!provider.testConnection) {
      return NextResponse.json({
        ok: provider.isConfigured(),
        message: provider.isConfigured()
          ? `${provider.label} is configured (no remote test available).`
          : `${provider.label} is not configured.`,
      });
    }
    const result = await provider.testConnection();
    // Record the test call honestly (1 request for most providers).
    try {
      await recordProviderUsage(ctx.organization.id, provider.id, { requests: 1, credits: 1 });
    } catch {
      /* non-fatal */
    }
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "discovery.source.test",
      resource: "Integration",
      metadata: { providerId: provider.id, ok: result.ok },
      req,
    });
    return NextResponse.json(result);
  },
  { minRole: "SALES_EXECUTIVE" },
);
