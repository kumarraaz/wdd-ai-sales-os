import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoSession } from "@/lib/demo-session";
import { Kanban } from "@/components/app/Kanban";

export const dynamic = "force-dynamic";

// Exact shape of the membership query below (select: organizationId, role).
// Typed explicitly so a missing/ungenerated Prisma client can never silently
// degrade `memberships` to `any` and break the tenant-resolution callbacks.
type MembershipOrgRole = Prisma.MembershipGetPayload<{
  select: { organizationId: true; role: true };
}>;

export default async function CrmPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  // Demo mode: the board reads from the read-only /api/demo fixture API.
  // Card moves are blocked with "Demo Mode — Action Disabled".
  if (demo && !session?.user) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            CRM Pipeline{" "}
            <span className="ml-2 rounded bg-[#D4AF37]/15 px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              DEMO_DATA
            </span>
          </h1>
          <p className="text-sm text-white/50">
            Drag cards between stages — every move is saved and logged.
          </p>
        </div>
        <Kanban orgId="demo" canWrite apiBase="/api/demo" demo />
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
        <h1 className="text-2xl font-bold">CRM Pipeline</h1>
        <p className="text-sm text-white/50">
          Drag cards between stages — every move is saved and logged.
        </p>
      </div>
      <Kanban orgId={active.organizationId} canWrite={active.role !== "VIEWER"} />
    </div>
  );
}
