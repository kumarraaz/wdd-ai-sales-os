import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_ORG, DEMO_USER } from "@/lib/demo";
import { getDemoSession } from "@/lib/demo-session";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { AppShell } from "@/components/app/AppShell";

// Exact shape of the membership query below (include: organization).
type MembershipWithOrg = Prisma.MembershipGetPayload<{
  include: { organization: true };
}>;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  // Demo mode: clearly marked demo identity + fixture-only data path.
  // Production auth is untouched — a demo session can never satisfy
  // withWorkspace/requireWorkspace, so all real APIs stay protected.
  if (demo && !session?.user) {
    return (
      <>
        <DemoBanner />
        <AppShell
          user={{ name: DEMO_USER.name, email: DEMO_USER.email }}
          orgs={[{ id: DEMO_ORG.id, name: `${DEMO_ORG.name} (DEMO_DATA)`, role: DEMO_ORG.role }]}
          activeOrgId={DEMO_ORG.id}
          demo
        >
          {children}
        </AppShell>
      </>
    );
  }

  const userId = session?.user?.id;
  // Unreachable in practice: the guards above redirect when there is no
  // session and no demo, and the demo branch already returned.
  if (!userId) redirect("/login");

  const memberships: MembershipWithOrg[] = await db.membership.findMany({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) redirect("/login?error=no-workspace");

  const jar = await cookies();
  const cookieOrg = jar.get("wdd.org_id")?.value;
  const active =
    memberships.find((m) => m.organizationId === cookieOrg) ?? memberships[0];

  const user = session?.user;
  if (!user) redirect("/login");

  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      orgs={memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      }))}
      activeOrgId={active.organization.id}
    >
      {children}
    </AppShell>
  );
}
