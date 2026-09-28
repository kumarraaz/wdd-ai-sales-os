import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUsage } from "@/lib/quotas";
import { DashboardCharts } from "@/components/app/DashboardCharts";
import StatCard from "@/components/ui/StatCard";
import { Users, UserCheck, Megaphone, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

// Exact shape of the membership query in resolveOrgId (select: organizationId).
type MembershipOrgId = Prisma.MembershipGetPayload<{
  select: { organizationId: true };
}>;

// Time-window helper for the DB queries below. This is an async Server
// Component, so Date.now() is request-scoped — no memoization hazard.
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400000);
}

async function resolveOrgId(userId: string): Promise<string> {
  const jar = await cookies();
  const cookieOrg = jar.get("wdd.org_id")?.value;
  const memberships: MembershipOrgId[] = await db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (memberships.length === 0) redirect("/login?error=no-workspace");
  return memberships.find((m) => m.organizationId === cookieOrg)?.organizationId ?? memberships[0].organizationId;
}

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  const orgId = await resolveOrgId(session.user.id);

  const [
    totalLeads,
    newLeads,
    qualifiedLeads,
    activeCampaigns,
    avgScore,
    byStatus,
    last30Days,
    usage,
  ] = await Promise.all([
    db.lead.count({ where: { organizationId: orgId } }),
    db.lead.count({
      where: { organizationId: orgId, createdAt: { gte: daysAgo(7) } },
    }),
    db.lead.count({
      where: { organizationId: orgId, status: { in: ["QUALIFIED", "CONTACTED", "REPLIED", "MEETING", "PROPOSAL", "NEGOTIATION"] } },
    }),
    db.campaign.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
    db.lead.aggregate({ where: { organizationId: orgId }, _avg: { leadScore: true } }),
    db.lead.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: true }),
    db.lead.groupBy({
      by: ["createdAt"],
      where: { organizationId: orgId, createdAt: { gte: daysAgo(30) } },
      _count: true,
    }),
    getUsage(orgId),
  ]);

  // Bucket last-30-days counts by day for the growth chart.
  const growthMap = new Map<string, number>();
  for (const row of last30Days) {
    const day = (row.createdAt as Date).toISOString().slice(0, 10);
    growthMap.set(day, (growthMap.get(day) ?? 0) + (row._count as number));
  }
  const growth: { day: string; leads: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = daysAgo(i).toISOString().slice(0, 10);
    growth.push({ day: d.slice(5), leads: growthMap.get(d) ?? 0 });
  }

  const pipeline = byStatus.map((s) => ({ status: s.status, count: s._count as number }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-white/50">Your sales pipeline at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Leads" value={totalLeads} dark />
        <StatCard icon={TrendingUp} label="New (7 days)" value={newLeads} dark />
        <StatCard icon={UserCheck} label="Qualified+" value={qualifiedLeads} dark />
        <StatCard icon={Megaphone} label="Active Campaigns" value={activeCampaigns} dark />
      </div>

      {totalLeads === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
          <h2 className="text-lg font-semibold">No leads yet</h2>
          <p className="mt-2 text-sm text-white/60">
            Add your first lead manually, import a CSV, or wait for Phase 2&apos;s discovery engine.
          </p>
          <a
            href="/app/leads"
            className="mt-4 inline-block rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
          >
            Go to Leads
          </a>
        </div>
      ) : (
        <DashboardCharts
          growth={growth}
          pipeline={pipeline}
          avgScore={Math.round(avgScore._avg.leadScore ?? 0)}
        />
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
          Plan usage
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["Leads", usage.leads],
              ["AI tokens (today)", usage.aiTokens],
              ["Messages (today)", usage.messages],
            ] as const
          ).map(([label, u]) => (
            <div key={label}>
              <div className="flex justify-between text-sm">
                <span className="text-white/70">{label}</span>
                <span className="text-white/50">
                  {u.used.toLocaleString()} / {u.limit.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#D4AF37]"
                  style={{ width: `${Math.min(100, (u.used / Math.max(1, u.limit)) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
