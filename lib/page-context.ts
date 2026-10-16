/**
 * Request context for server-rendered (app) pages.
 *
 * Resolves who is looking and which workspace they are looking at, the same way
 * the (app) layout does: the `wdd.org_id` cookie only *selects among* the user's
 * own memberships — an id the user is not a member of is ignored, never trusted.
 * Unauthenticated visitors are redirected to /login; DEMO_MODE visitors (no real
 * session) get `{ demo: true }` and must render fixtures only.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "./auth";
import { db } from "./db";
import { getDemoSession } from "./demo-session";
import { roleAtLeast } from "./tenant";

export type PageContext =
  | { demo: true }
  | {
      demo: false;
      user: { id: string; name: string | null; email: string };
      organizationId: string;
      organizationName: string;
      role: Role;
    };

export async function getPageContext(): Promise<PageContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;
  if (!user) {
    if (await getDemoSession()) return { demo: true };
    redirect("/login");
  }

  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true, organization: { select: { name: true } } },
  });
  if (memberships.length === 0) redirect("/login?error=no-workspace");

  const cookieOrg = (await cookies()).get("wdd.org_id")?.value;
  const active = memberships.find((m) => m.organizationId === cookieOrg) ?? memberships[0];

  return {
    demo: false,
    user: { id: user.id, name: user.name ?? null, email: user.email },
    organizationId: active.organizationId,
    organizationName: active.organization.name,
    role: active.role,
  };
}

/** True when the page context is a signed-in member holding at least `minimum`. */
export function hasRole(ctx: PageContext, minimum: Role): boolean {
  return !ctx.demo && roleAtLeast(ctx.role, minimum);
}
