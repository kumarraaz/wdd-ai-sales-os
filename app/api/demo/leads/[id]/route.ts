import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_ACTION_DISABLED_MESSAGE,
  DEMO_COOKIE_NAME,
  isDemoModeEnabled,
  validateDemoSession,
} from "@/lib/demo";

/**
 * Demo fixture API — per-lead mutations are always disabled.
 * Covers the Kanban card-move PATCH and row DELETE calls, which target
 * /api/leads/:id. Same 404-when-off / 403-when-demo contract as the
 * collection route.
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

export async function GET() {
  const denied = await demoGuard();
  return denied ?? actionDisabled();
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
