import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_ACTION_DISABLED_MESSAGE,
  DEMO_COOKIE_NAME,
  isDemoModeEnabled,
  validateDemoSession,
} from "@/lib/demo";
import { getDemoLeadScore } from "@/lib/demo-data";

/**
 * Demo lead-scoring API — deterministic fictional DEMO_DATA fixtures.
 *
 * - NEVER uses withWorkspace: no real user exists here and demo tokens must
 *   never satisfy production auth.
 * - NEVER calls Gemini, NEVER writes to the database, NEVER touches real
 *   lead data. The fixture is derived deterministically from the leadId.
 * - When demo mode is off or the token is invalid: 404, like a missing route.
 */

async function demoToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(DEMO_COOKIE_NAME)?.value;
}

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
  const leadId = typeof body?.leadId === "string" ? body.leadId : "";
  if (!leadId) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  return NextResponse.json({ score: getDemoLeadScore(leadId), demo: true });
}

export async function GET(req: NextRequest) {
  const denied = await demoGuard();
  if (denied) return denied;

  const leadId = req.nextUrl.searchParams.get("leadId") ?? "demo-lead";
  return NextResponse.json({ score: getDemoLeadScore(leadId), demo: true });
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
