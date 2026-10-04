import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUsage } from "@/lib/quotas";
import { getSourceCatalog } from "@/lib/discovery/sources";
import { getDemoSession } from "@/lib/demo-session";
import { getDemoDashboard } from "@/lib/demo-data";
import { DashboardCharts } from "@/components/app/DashboardCharts";
import StatCard from "@/components/ui/StatCard";
import { Users, UserCheck, TrendingUp, Globe, BadgeCheck, Download } from "lucide-react";

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

interface DashboardStats {
  totalLeads: number;
  contactable: number;
  noWebsite: number;
  qualifiedLeads: number;
  importedToday: number;
  avgScore: number;
  growth: { day: string; leads: number }[];
  pipeline: { status: string; count: number }[];
  sources: { id: string; label: string; availability: string }[];
  recentRuns: {
    id: string;
    label: string;
    requested: number;
    discovered: number;
    contactable: number;
    imported: number;
    status: string;
    createdAt: Date;
    providerIds: unknown;
  }[];
  usage: {
    leads: { used: number; limit: number };
    aiTokens: { used: number; limit: number };
    messages: { used: number; limit: number };
  };
}

/** Shared presentation for real and demo dashboard data. */
function DashboardView({ stats, demo = false }: { stats: DashboardStats; demo?: boolean }) {
  const { totalLeads, contactable, noWebsite, qualifiedLeads, importedToday, avgScore, growth, pipeline, sources, recentRuns, usage } = stats;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Dashboard{" "}
          {demo && (
            <span className="ml-2 rounded bg-[#D4AF37]/15 px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              DEMO_DATA
            </span>
          )}
        </h1>
        <p className="text-sm text-white/50">
          {demo ? "Sample pipeline data for demonstration." : "Your sales pipeline at a glance."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Users} label="Total Leads" value={totalLeads} dark />
        <StatCard icon={UserCheck} label="Contactable" value={contactable} dark />
        <StatCard icon={Globe} label="No Website" value={noWebsite} dark />
        <StatCard icon={BadgeCheck} label="Qualified" value={qualifiedLeads} dark />
        <StatCard icon={TrendingUp} label="Avg Score" value={avgScore} dark />
        <StatCard icon={Download} label="Imported Today" value={importedToday} dark />
      </div>

      {totalLeads === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
          <h2 className="text-lg font-semibold">No leads yet</h2>
          <p className="mt-2 text-sm text-white/60">
            Run your first discovery to find real, contactable businesses.
          </p>
          <a
            href="/discover"
            className="mt-4 inline-block rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
          >
            Go to Discover
          </a>
        </div>
      ) : (
        <DashboardCharts growth={growth} pipeline={pipeline} avgScore={avgScore} />
      )}

      {/* Discovery sources */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
            Discovery sources
          </h2>
          <a href="/integrations" className="text-xs font-semibold text-[#D4AF37] hover:underline">
            Manage →
          </a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {sources.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75"
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  s.availability === "CONNECTED"
                    ? "bg-emerald-400"
                    : s.availability === "FREE_LIMIT_REACHED" || s.availability === "ERROR"
                      ? "bg-red-400"
                      : s.availability === "LIMITED"
                        ? "bg-amber-400"
                        : "bg-white/25"
                }`}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Recent discovery runs */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
            Recent discovery runs
          </h2>
          <a href="/discover/history" className="text-xs font-semibold text-[#D4AF37] hover:underline">
            View all →
          </a>
        </div>
        {recentRuns.length === 0 ? (
          <p className="mt-3 text-sm text-white/40">No discovery runs yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-white/40">
                  <th className="py-2 pr-4">Query</th>
                  <th className="py-2 pr-4">Sources</th>
                  <th className="py-2 pr-4">Req.</th>
                  <th className="py-2 pr-4">Found</th>
                  <th className="py-2 pr-4">Contactable</th>
                  <th className="py-2 pr-4">Imported</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-t border-white/5 text-white/75">
                    <td className="py-2 pr-4 font-medium text-white">{r.label}</td>
                    <td className="py-2 pr-4 text-xs text-white/50">
                      {Array.isArray(r.providerIds) ? r.providerIds.join(", ") : "—"}
                    </td>
                    <td className="py-2 pr-4">{r.requested}</td>
                    <td className="py-2 pr-4">{r.discovered}</td>
                    <td className="py-2 pr-4">{r.contactable}</td>
                    <td className="py-2 pr-4">{r.imported}</td>
                    <td className="py-2 pr-4">
                      <span className="text-xs uppercase text-white/60">{r.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="py-2 text-xs text-white/50">
                      {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  // Demo mode: render the same dashboard from clearly labeled fixtures —
  // no database access, no real user.
  if (demo && !session?.user) {
    const d = getDemoDashboard();
    return (
      <DashboardView
        stats={{
          totalLeads: d.totalLeads,
          contactable: 0,
          noWebsite: 0,
          qualifiedLeads: d.qualifiedLeads,
          importedToday: 0,
          avgScore: d.avgScore,
          growth: d.growth,
          pipeline: d.pipeline,
          sources: [],
          recentRuns: [],
          usage: d.usage,
        }}
        demo
      />
    );
  }

  const userId = session?.user?.id;
  // Unreachable in practice: the guards above redirect when there is no
  // session and no demo, and the demo branch already returned. The explicit
  // check keeps the type narrow without a non-null assertion.
  if (!userId) redirect("/login");
  const orgId = await resolveOrgId(userId);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    totalLeads,
    contactable,
    noWebsite,
    qualifiedLeads,
    importedToday,
    avgScore,
    byStatus,
    last30Days,
    usage,
    sources,
    recentRuns,
  ] = await Promise.all([
    db.lead.count({ where: { organizationId: orgId } }),
    db.lead.count({ where: { organizationId: orgId, contactable: true } }),
    db.lead.count({ where: { organizationId: orgId, websiteStatus: "NO_WEBSITE" } }),
    db.lead.count({
      where: { organizationId: orgId, status: { in: ["QUALIFIED", "CONTACTED", "REPLIED", "MEETING", "PROPOSAL", "NEGOTIATION"] } },
    }),
    db.lead.count({
      where: { organizationId: orgId, createdAt: { gte: todayStart } },
    }),
    db.lead.aggregate({ where: { organizationId: orgId }, _avg: { leadScore: true } }),
    db.lead.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: true }),
    db.lead.groupBy({
      by: ["createdAt"],
      where: { organizationId: orgId, createdAt: { gte: daysAgo(30) } },
      _count: true,
    }),
    getUsage(orgId),
    getSourceCatalog(orgId).catch(() => ({ zeroSpendMode: true, sources: [] })),
    db.discoveryHistory.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        label: true,
        requested: true,
        discovered: true,
        contactable: true,
        imported: true,
        status: true,
        createdAt: true,
        providerIds: true,
      },
    }),
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
    <DashboardView
      stats={{
        totalLeads,
        contactable,
        noWebsite,
        qualifiedLeads,
        importedToday,
        avgScore: Math.round(avgScore._avg.leadScore ?? 0),
        growth,
        pipeline,
        sources: sources.sources.map((s) => ({ id: s.id, label: s.label, availability: s.availability })),
        recentRuns,
        usage,
      }}
    />
  );
}
