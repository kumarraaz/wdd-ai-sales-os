import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app/AppShell";

// Exact shape of the membership query below (include: organization).
type MembershipWithOrg = Prisma.MembershipGetPayload<{
  include: { organization: true };
}>;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const memberships: MembershipWithOrg[] = await db.membership.findMany({
    where: { userId: session.user.id },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) redirect("/login?error=no-workspace");

  const jar = await cookies();
  const cookieOrg = jar.get("wdd.org_id")?.value;
  const active =
    memberships.find((m) => m.organizationId === cookieOrg) ?? memberships[0];

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
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
