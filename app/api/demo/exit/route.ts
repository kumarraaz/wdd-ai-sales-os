import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DEMO_COOKIE_NAME, destroyDemoSession } from "@/lib/demo";

/**
 * POST /api/demo/exit — destroy the demo session and clear its cookie.
 * Ungated on purpose: clearing a cookie is always harmless, and exit must
 * work even if the gate state changed since entering.
 */
export async function POST() {
  const jar = await cookies();
  destroyDemoSession(jar.get(DEMO_COOKIE_NAME)?.value);
  jar.delete(DEMO_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
