import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_ACTION_DISABLED_MESSAGE,
  DEMO_COOKIE_NAME,
  isDemoModeEnabled,
  validateDemoSession,
} from "@/lib/demo";
import { getDemoWebsiteInspection } from "@/lib/demo-data";

/**
 * Demo website-intelligence API — fictional DEMO_DATA fixtures.
 *
 * - NEVER uses withWorkspace / requireWorkspace: there is no real user here,
 *   and demo tokens must never satisfy production auth.
 * - POST returns a fictional inspection report for any URL — NO real
 *   external HTTP requests are ever made in demo mode.
 * - GET returns an empty inspection list (demo inspections are not persisted).
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
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const inspection = getDemoWebsiteInspection(url);
  return NextResponse.json({ inspection, demo: true });
}

export async function GET() {
  const denied = await demoGuard();
  if (denied) return denied;
  return NextResponse.json({ inspections: [], demo: true });
}

export async function PUT() {
  const denied = await demoGuard();
  if (denied) return denied;
  return NextResponse.json({ error: DEMO_ACTION_DISABLED_MESSAGE }, { status: 403 });
}

export async function DELETE() {
  const denied = await demoGuard();
  if (denied) return denied;
  return NextResponse.json({ error: DEMO_ACTION_DISABLED_MESSAGE }, { status: 403 });
}
