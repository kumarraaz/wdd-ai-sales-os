import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_COOKIE_NAME,
  isDemoModeEnabled,
  validateDemoSession,
} from "@/lib/demo";

/**
 * Demo discovery import — deterministic simulation for demo mode.
 *
 * - NEVER uses withWorkspace: there is no real user here.
 * - Performs NO database writes, NO external API calls, NO Gemini calls.
 * - Returns a deterministic summary: every selected company is "imported"
 *   with a stable synthetic lead id derived from the provider id.
 * - When demo mode is off (or the token is invalid), returns 404 —
 *   indistinguishable from a missing route.
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
  const companies = Array.isArray(body?.companies) ? body.companies : [];
  if (body?.providerId !== "google-places") {
    return NextResponse.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 });
  }

  // Deterministic: same input → same ids, every time. No duplicates are
  // simulated here because demo fixtures never exist in the real database.
  const imported = companies
    .filter((c: unknown) => c && typeof c === "object" && typeof (c as { providerId?: unknown }).providerId === "string")
    .map((c: { providerId: string; name?: string }) => ({
      providerId: c.providerId,
      name: c.name ?? "Unnamed company",
      status: "imported",
      leadId: `demo-lead-${c.providerId}`,
    }));

  return NextResponse.json({
    imported,
    alreadyExists: [],
    possibleDuplicates: [],
    skipped: [],
    failed: [],
    counts: {
      imported: imported.length,
      alreadyExists: 0,
      possibleDuplicates: 0,
      skipped: 0,
      failed: 0,
    },
    demo: true,
    simulated: true,
    notice:
      "Demo simulation — no leads were written to the database. Sign up for a real workspace to import.",
  });
}
