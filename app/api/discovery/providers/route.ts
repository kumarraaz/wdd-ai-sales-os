import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { listDiscoveryProviders } from "@/lib/discovery/registry";

/**
 * GET /api/discovery/providers
 * Lists discovery providers with their configuration state. Never exposes
 * API keys — only booleans and setup instructions.
 */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const providers = listDiscoveryProviders().map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    searchable: p.searchable,
    setupInstructions: p.isConfigured() ? [] : p.setupInstructions(),
  }));

  return NextResponse.json({ providers });
});
