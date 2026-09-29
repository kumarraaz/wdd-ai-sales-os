import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_ACTION_DISABLED_MESSAGE,
  DEMO_COOKIE_NAME,
  isDemoModeEnabled,
  validateDemoSession,
} from "@/lib/demo";
import { getDemoLeadDetail } from "@/lib/demo-data";

/**
 * Demo fixture API — GET returns the fictional lead detail (DEMO_DATA);
 * mutations are always disabled with "Demo Mode — Action Disabled".
 * Same 404-when-off contract as the collection route.
 */

async function demoGuard(): Promise<NextResponse | null> {
  const jar = await cookies();
  if (!isDemoModeEnabled() || !validateDemoSession(jar.get(DEMO_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return null;
}

function actionDisabled(): NextResponse {
  return NextResponse.json({ error: DEMO_ACTION_DISABLED_MESSAGE }, { status: 403 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await demoGuard();
  if (denied) return denied;
  const { id } = await params;
  const lead = getDemoLeadDetail(id);
  if (!lead) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ lead, demo: true });
}

export async function POST() {
  const denied = await demoGuard();
  return denied ?? actionDisabled();
}

export async function PUT() {
  const denied = await demoGuard();
  return denied ?? actionDisabled();
}

export async function PATCH() {
  const denied = await demoGuard();
  return denied ?? actionDisabled();
}

export async function DELETE() {
  const denied = await demoGuard();
  return denied ?? actionDisabled();
}
