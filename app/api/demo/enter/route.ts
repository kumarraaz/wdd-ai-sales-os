import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_COOKIE_NAME,
  DEMO_SESSION_TTL_MS,
  createDemoSession,
  isDemoModeEnabled,
} from "@/lib/demo";

/**
 * POST /api/demo/enter — mint a demo session (demo mode only).
 * Hard-gated by isDemoModeEnabled(): returns 404 unless DEMO_MODE=true and
 * NODE_ENV != "production". The response body carries no secrets.
 */
export async function POST() {
  if (!isDemoModeEnabled()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const token = createDemoSession();
  if (!token) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const jar = await cookies();
  jar.set(DEMO_COOKIE_NAME, token, {
    httpOnly: true, // never readable by client-side JS
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(DEMO_SESSION_TTL_MS / 1000),
  });
  return NextResponse.json({ ok: true, demo: true });
}
