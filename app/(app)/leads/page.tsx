import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { LeadsTable } from "@/components/app/LeadsTable";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");

  const jar = await cookies();
  const cookieOrg = jar.get("wdd.org_id")?.value;
  const memberships = await db.membership.findMany({
    where: { userId: session.user.id },
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
