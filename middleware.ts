import { NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE_NAME, isDemoModeEnabled } from "@/lib/demo";

// Lightweight gate: if no session cookie is present, bounce to /login.
// This is NOT the security boundary — every (app) layout and every API
// route re-verifies the session against the database server-side.
const SESSION_COOKIE = "wdd.session_token";

export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  // Demo mode (dev only): a demo cookie lets the request reach the (app)
  // layout, which performs the real demo-token validation. Cookie presence
  // alone grants nothing — a forged or expired token is bounced to /login
  // by the layout.
  const hasDemoCookie = isDemoModeEnabled() && req.cookies.has(DEMO_COOKIE_NAME);
  if (!hasSession && !hasDemoCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // NOTE: route groups like (app) do not create URL segments, so the
  // protected pages live at /dashboard, /leads, /crm, /discover — not /app/*.
  matcher: ["/dashboard/:path*", "/leads/:path*", "/crm/:path*", "/discover/:path*"],
};
