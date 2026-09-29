import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_ACTION_DISABLED_MESSAGE,
  DEMO_COOKIE_NAME,
  isDemoModeEnabled,
  validateDemoSession,
} from "@/lib/demo";
import { getDemoDiscoveryResults } from "@/lib/demo-data";

/**
 * Demo discovery API — read-only DEMO_DATA for demo mode.
 *
 * - NEVER uses withWorkspace / requireWorkspace: there is no real user here,
 *   and demo tokens must never satisfy production auth.
 * - POST searches the fictional fixtures (never calls Google or any external
 *   API). No real API keys are used in demo mode.
 * - Import is disabled in demo mode with "Demo Mode — Action Disabled",
 *   consistent with every other demo write surface.
 * - When demo mode is off (or the token is invalid), every method returns 404
 *   — indistinguishable from a missing route, revealing nothing.
 */

async function demoToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(DEMO_COOKIE_NAME)?.value;
}

/** Null when the request is an authorized demo request, else a 404 response. */
async function demoGuard(): Promise<NextResponse | null> {
  if (!isDemoModeEnabled() || !validateDemoSession(await demoToken())) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const denied = await demoGuard();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const keyword = typeof body?.keyword === "string" ? body.keyword : "";
  const city = typeof body?.city === "string" ? body.city : undefined;
  const country = typeof body?.country === "string" ? body.country : undefined;
  const maxResults = Math.min(
    20,
    Math.max(1, parseInt(String(body?.maxResults ?? "20"), 10) || 20),
  );

  if (!keyword.trim()) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const companies = getDemoDiscoveryResults({ keyword, city, country, maxResults });
  return NextResponse.json({
    provider: "google-places",
    searchedAt: new Date().toISOString(),
    companies,
    demo: true,
  });
}

export async function GET() {
  const denied = await demoGuard();
  if (denied) return denied;
  // Import and every other mutation is disabled in demo mode.
  return NextResponse.json({ error: DEMO_ACTION_DISABLED_MESSAGE }, { status: 403 });
}

export async function PUT() {
  const denied = await demoGuard();
  if (denied) return denied;
  return NextResponse.json({ error: DEMO_ACTION_DISABLED_MESSAGE }, { status: 403 });
}

export async function PATCH() {
  const denied = await demoGuard();
  if (denied) return denied;
  return NextResponse.json({ error: DEMO_ACTION_DISABLED_MESSAGE }, { status: 403 });
}

export async function DELETE() {
  const denied = await demoGuard();
  if (denied) return denied;
  return NextResponse.json({ error: DEMO_ACTION_DISABLED_MESSAGE }, { status: 403 });
}
