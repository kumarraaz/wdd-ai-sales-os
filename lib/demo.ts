/**
 * SAFE DEMO MODE — development/demo environments only.
 *
 * A clearly separated, explicitly gated access path for inspecting the app
 * shell without a real account. This module is deliberately NOT part of the
 * authentication system and never will be:
 * - It never touches better-auth, its session cookies, or the database.
 * - Demo tokens are random in-memory capabilities, not credentials.
 * - Production APIs (withWorkspace / requireWorkspace) only accept
 *   better-auth sessions — a demo token can NEVER satisfy them.
 * - Everything here is inert unless DEMO_MODE=true AND NODE_ENV != "production".
 *
 * This file is edge-safe (no next/headers import) so middleware can use the
 * gate. Server components that need the request cookie use getDemoSession()
 * from ./demo-session.
 */

export const DEMO_COOKIE_NAME = "wdd_demo_session";
export const DEMO_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Exact message shown whenever an action is unavailable in demo mode. */
export const DEMO_ACTION_DISABLED_MESSAGE = "Demo Mode — Action Disabled";

/** Clearly marked demo identity — never a real user account. */
export const DEMO_USER = {
  name: "Demo User",
  email: "demo@wdd.example.com",
} as const;

/** Clearly marked demo workspace — never a real organization. */
export const DEMO_ORG = {
  id: "demo-org",
  name: "Demo Workspace",
  role: "OWNER",
} as const;

/**
 * Demo mode is ONLY available outside production, and only when explicitly
 * enabled. The NODE_ENV check is a hard gate: even DEMO_MODE=true can never
 * activate demo mode when NODE_ENV=production.
 */
export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
}

// Process-wide demo session store. Stored on globalThis (the same pattern
// Prisma clients use) because Next.js dev re-instantiates modules per route —
// a module-scoped Map would give each route its own empty store and sessions
// minted by /api/demo/enter would never validate elsewhere. Demo mode never
// runs in production, and the dev server is a single process, so a
// process-wide Map is sufficient — and it avoids introducing any signing
// secret whatsoever.
const globalForDemo = globalThis as unknown as {
  __wddDemoSessions?: Map<string, number>;
};

function sessionStore(): Map<string, number> {
  if (!globalForDemo.__wddDemoSessions) {
    globalForDemo.__wddDemoSessions = new Map<string, number>();
  }
  return globalForDemo.__wddDemoSessions;
}

function prune(): void {
  const sessions = sessionStore();
  const now = Date.now();
  for (const [token, createdAt] of sessions) {
    if (now - createdAt > DEMO_SESSION_TTL_MS) sessions.delete(token);
  }
}

/** Create a demo session token. Returns null when demo mode is disabled. */
export function createDemoSession(): string | null {
  if (!isDemoModeEnabled()) return null;
  prune();
  const token = crypto.randomUUID();
  sessionStore().set(token, Date.now());
  return token;
}

/**
 * Validate a demo session token. Always false when demo mode is disabled —
 * a token minted earlier stops working the moment the gate closes.
 */
export function validateDemoSession(token: string | undefined | null): boolean {
  if (!isDemoModeEnabled()) return false;
  if (!token) return false;
  const sessions = sessionStore();
  const createdAt = sessions.get(token);
  if (!createdAt) return false;
  if (Date.now() - createdAt > DEMO_SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** Destroy a demo session token. Safe no-op for unknown/empty tokens. */
export function destroyDemoSession(token: string | undefined | null): void {
  if (!token) return;
  sessionStore().delete(token);
}
