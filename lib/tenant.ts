import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { db } from "./db";
import type { Role } from "@prisma/client";

/**
 * Tenant isolation core.
 *
 * RULE: every protected API route and every server component under (app)
 * MUST resolve the request through requireWorkspace() (or requireUser() for
 * platform-level routes) and MUST include the returned organizationId in
 * every Prisma query's `where` clause. Never trust client-supplied org ids
 * or roles — membership is always re-resolved server-side from the session.
 */

export interface WorkspaceContext {
  user: { id: string; email: string; name: string | null };
  organization: { id: string; name: string; slug: string };
  membership: { id: string; role: Role };
}

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  SALES_EXECUTIVE: 1,
  SALES_MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** Authenticated user, no workspace required (e.g. workspace switcher). */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new AuthError("UNAUTHENTICATED", 401);
  return user;
}

/**
 * Resolve the workspace for a request.
 * - organizationId may come from query/header/route param, but it is ALWAYS
 *   validated against the user's memberships. An id the user is not a member
 *   of → 403 (this is what makes IDOR attempts fail).
 * - With no id supplied, the user's first (oldest) membership wins.
 */
export async function requireWorkspace(
  organizationId?: string | null,
  minimumRole: Role = "VIEWER",
): Promise<WorkspaceContext> {
  const user = await requireUser();

  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) throw new AuthError("NO_WORKSPACE", 403);

  const membership = organizationId
    ? memberships.find((m) => m.organizationId === organizationId)
    : memberships[0];

  if (!membership) throw new AuthError("WORKSPACE_ACCESS_DENIED", 403);
  if (!roleAtLeast(membership.role, minimumRole))
    throw new AuthError("INSUFFICIENT_ROLE", 403);

  return {
    user: { id: user.id, email: user.email, name: user.name },
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
    },
    membership: { id: membership.id, role: membership.role },
  };
}

export class AuthError extends Error {
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
  }
}

type Handler = (
  req: NextRequest,
  ctx: WorkspaceContext,
  routeParams: { params: Promise<Record<string, string>> },
) => Promise<NextResponse> | NextResponse;

interface GuardOptions {
  minRole?: Role;
  /** Resolve org id from route params key (default: none → default workspace). */
  orgParam?: string;
}

/**
 * Wrap a route handler with authentication + workspace + role enforcement.
 * Usage: export const GET = withWorkspace(async (req, ctx) => {...}, { minRole: "SALES_EXECUTIVE" });
 */
export function withWorkspace(handler: Handler, opts: GuardOptions = {}) {
  return async (
    req: NextRequest,
    routeParams: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      const params = await routeParams.params;
      const orgId =
        (opts.orgParam && params[opts.orgParam]) ||
        req.nextUrl.searchParams.get("orgId") ||
        req.headers.get("x-org-id");
      const ctx = await requireWorkspace(orgId, opts.minRole ?? "VIEWER");
      return await handler(req, ctx, routeParams);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("[api] unhandled error", err);
      // Never leak stack traces to clients.
      return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
    }
  };
}

/** Read the active org id on the client (set by the workspace switcher). */
export const ORG_HEADER = "x-org-id";
