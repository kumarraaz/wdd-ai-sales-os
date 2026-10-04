import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoSession } from "@/lib/demo-session";
import { ProspectingDashboard } from "@/components/prospecting/ProspectingDashboard";

export const dynamic = "force-dynamic";

export default async function ProspectingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  if (demo && !session?.user) redirect("/dashboard");

  const jar = await cookies();
  const cookieOrg = jar.get("wdd.org_id")?.value;
  const userId = session?.user?.id;
  if (!userId) redirect("/login");
  const memberships = await db.membership.findMany({
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
        <h1 className="text-2xl font-bold">Instagram Prospecting</h1>
        <p className="text-sm text-white/50">
          7-day weekly plan, daily automated discovery at 9:00 AM, and CRM import —
          drafts only, nothing is ever sent automatically.
        </p>
      </div>
      <ProspectingDashboard
        orgId={active.organizationId}
        canManage={active.role === "OWNER" || active.role === "SALES_MANAGER"}
        canRun={active.role !== "VIEWER"}
      />
    </div>
  );
}
