import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoSession } from "@/lib/demo-session";
import { LeadsTable } from "@/components/app/LeadsTable";

export const dynamic = "force-dynamic";

// Exact shape of the membership query below (select: organizationId, role).
type MembershipOrgRole = Prisma.MembershipGetPayload<{
  select: { organizationId: true; role: true };
}>;

export default async function LeadsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  // Demo mode: the table reads from the read-only /api/demo fixture API.
  // Mutations are blocked with "Demo Mode — Action Disabled".
  if (demo && !session?.user) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            Leads{" "}
            <span className="ml-2 rounded bg-[#D4AF37]/15 px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              DEMO_DATA
            </span>
          </h1>
          <p className="text-sm text-white/50">
            Search, filter, enrich and manage every prospect in one place.
          </p>
        </div>
        <LeadsTable orgId="demo" role="OWNER" apiBase="/api/demo" demo />
      </div>
    );
  }

  const jar = await cookies();
  const cookieOrg = jar.get("wdd.org_id")?.value;
  const userId = session?.user?.id;
  // Unreachable in practice: the guards above redirect when there is no
  // session and no demo, and the demo branch already returned.
  if (!userId) redirect("/login");
  const memberships: MembershipOrgRole[] = await db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (memberships.length === 0) redirect("/login?error=no-workspace");
  const active =
    memberships.find((m) => m.organizationId === cookieOrg) ?? memberships[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Leads</h1>
        <p className="text-sm text-white/50">
          Search, filter, enrich and manage every prospect in one place.
        </p>
      </div>
      <LeadsTable orgId={active.organizationId} role={active.role} />
    </div>
  );
}
