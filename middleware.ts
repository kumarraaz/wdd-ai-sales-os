import { NextRequest, NextResponse } from "next/server";

// Lightweight gate: if no session cookie is present, bounce to /login.
// This is NOT the security boundary — every (app) layout and every API
// route re-verifies the session against the database server-side.
const SESSION_COOKIE = "wdd.session_token";

export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // NOTE: route groups like (app) do not create URL segments, so the
  // protected pages live at /dashboard, /leads, /crm — not /app/*.
  matcher: ["/dashboard/:path*", "/leads/:path*", "/crm/:path*"],
};
