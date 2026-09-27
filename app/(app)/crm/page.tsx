import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Kanban } from "@/components/app/Kanban";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
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
        <h1 className="text-2xl font-bold">CRM Pipeline</h1>
        <p className="text-sm text-white/50">
          Drag cards between stages — every move is saved and logged.
        </p>
      </div>
      <Kanban orgId={active.organizationId} canWrite={active.role !== "VIEWER"} />
    </div>
  );
}
