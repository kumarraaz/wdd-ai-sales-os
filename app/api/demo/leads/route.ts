import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  DEMO_ACTION_DISABLED_MESSAGE,
  DEMO_COOKIE_NAME,
  isDemoModeEnabled,
  validateDemoSession,
} from "@/lib/demo";
import { DEMO_LEADS } from "@/lib/demo-data";

/**
 * Demo fixture API — read-only DEMO_DATA for demo mode.
 *
 * - NEVER uses withWorkspace / requireWorkspace: there is no real user here,
 *   and demo tokens must never satisfy production auth (proven by tests).
 * - GET serves static fixtures with the same { leads, total } envelope and
 *   query params (q, status, page, pageSize, sort, order) as /api/leads.
 * - Every mutation returns 403 "Demo Mode — Action Disabled".
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

function actionDisabled(): NextResponse {
  return NextResponse.json({ error: DEMO_ACTION_DISABLED_MESSAGE }, { status: 403 });
}

export async function GET(req: NextRequest) {
  const denied = await demoGuard();
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const status = sp.get("status") ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "25", 10) || 25));
  const sort = sp.get("sort") ?? "updatedAt";
  const order = sp.get("order") ?? "desc";

  let leads = DEMO_LEADS.filter(
    (l) =>
      (!status || l.status === status) &&
      (!q ||
        [l.fullName, l.email, l.phone, l.jobTitle, l.company?.name ?? "", l.industry]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );

  leads = [...leads].sort((a, b) => {
    const av = sort === "leadScore" ? a.leadScore : a.updatedAt;
    const bv = sort === "leadScore" ? b.leadScore : b.updatedAt;
    if (av === bv) return 0;
    return order === "asc" ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });

  const total = leads.length;
  const start = (page - 1) * pageSize;
  return NextResponse.json({ leads: leads.slice(start, start + pageSize), total, demo: true });
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
