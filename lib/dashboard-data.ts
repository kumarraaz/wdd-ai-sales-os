/**
 * Dashboard data layer. One function per data source: the real one reads
 * organization-scoped aggregates from Postgres, the demo one derives the same
 * shape from the DEMO_DATA fixtures (no database access, nothing mixed with real data).
 *
 * Every query below is filtered by `organizationId` — callers must pass the
 * workspace resolved from the signed-in user's memberships, never a value taken
 * from the request.
 */
import { Prisma } from "@prisma/client";
import { db } from "./db";
import {
  QUALIFIED_STATUSES,
  HOT_LEAD_SCORE,
  bucketByDay,
  buildNextMoves,
  fillDays,
  periodWindows,
  type DayPoint,
  type NextMove,
  type RangeKey,
} from "./dashboard";
import { getRecentActivity, type ActivityItem } from "./activity";
import { DEMO_LEADS, getDemoDashboard } from "./demo-data";
import { getSourceCatalog } from "./discovery/sources";
import { pendingApprovalWhere } from "./approvals-query";
import { followUpDueWhere } from "./leads";
import { getUsage } from "./quotas";

export interface UsageMeters {
  leads: { used: number; limit: number };
  aiTokens: { used: number; limit: number };
  messages: { used: number; limit: number };
}

export interface RecentRun {
  id: string;
  label: string;
  requested: number;
  discovered: number;
  contactable: number;
  imported: number;
  status: string;
  createdAt: Date;
  providerIds: unknown;
}

export interface DashboardData {
  range: { key: RangeKey; days: number; label: string };
  /** ISO time the numbers were computed (also seeds the relative times in the feed). */
  generatedAt: string;
  totalLeads: number;
  contactable: number;
  noWebsite: number;
  /** leads created today (UTC) — the last point of `points` */
  addedToday: number;
  /** all-time leads at a qualified-or-later stage */
  qualifiedTotal: number;
  period: {
    newLeads: number;
    newLeadsPrev: number;
    /** of the leads created in the window, how many are now qualified-or-later */
    qualified: number;
    qualifiedPrev: number;
    /** average lead score of the window's leads; null when the window has none */
    avgScore: number | null;
    avgScorePrev: number | null;
  };
  points: DayPoint[];
  pipeline: { status: string; count: number }[];
  pendingApprovals: number;
  oldestPendingAt: string | null;
  hotLeads: number;
  followUpsDue: number;
  moves: NextMove[];
  usage: UsageMeters;
  sources: { id: string; label: string; availability: string }[];
  recentRuns: RecentRun[];
  activity: ActivityItem[];
}

const round1 = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 10) / 10);

/**
 * Leads created per UTC day (and how many of those are now qualified-or-later).
 * Aggregated in SQL so a workspace with a million leads still returns ≤ 90 rows.
 * "createdAt" is a timestamp-without-zone column that stores UTC, so the date part
 * is already the UTC day and the cutoff is passed as a zone-less UTC literal.
 */
async function dailyLeadCounts(organizationId: string, from: Date) {
  const fromUtc = from.toISOString().slice(0, 19).replace("T", " ");
  return db.$queryRaw<Array<{ day: string; leads: number; qualified: number }>>(Prisma.sql`
    SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS leads,
           (COUNT(*) FILTER (WHERE "status"::text IN (${Prisma.join([...QUALIFIED_STATUSES])})))::int AS qualified
    FROM "Lead"
    WHERE "organizationId" = ${organizationId}
      AND "createdAt" >= ${fromUtc}::timestamp
    GROUP BY 1
    ORDER BY 1
  `);
}

export interface PeriodStats {
  points: DayPoint[];
  period: DashboardData["period"];
}

/**
 * Leads created in the selected window vs the window before it: the numbers behind the
 * dashboard KPI tiles, the momentum chart and the analytics page, so all three always agree.
 */
export async function getPeriodStats(
  organizationId: string,
  range: { days: number },
  now: Date = new Date(),
): Promise<PeriodStats> {
  const { currentStart, previousStart } = periodWindows(now, range.days);
  const previousWindow = { gte: previousStart, lt: currentStart };

  const [daily, currentAvg, previousAgg, previousQualified] = await Promise.all([
    dailyLeadCounts(organizationId, currentStart),
    db.lead.aggregate({ where: { organizationId, createdAt: { gte: currentStart } }, _avg: { leadScore: true } }),
    db.lead.aggregate({
      where: { organizationId, createdAt: previousWindow },
      _count: { _all: true },
      _avg: { leadScore: true },
    }),
    db.lead.count({ where: { organizationId, createdAt: previousWindow, status: { in: [...QUALIFIED_STATUSES] } } }),
  ]);

  const points = fillDays(daily, range.days, now);
  const newLeads = points.reduce((n, p) => n + p.leads, 0);
  const qualified = points.reduce((n, p) => n + p.qualified, 0);
  return {
    points,
    period: {
      newLeads,
      newLeadsPrev: previousAgg._count._all,
      qualified,
      qualifiedPrev: previousQualified,
      avgScore: newLeads > 0 ? round1(currentAvg._avg.leadScore) : null,
      avgScorePrev: previousAgg._count._all > 0 ? round1(previousAgg._avg.leadScore) : null,
    },
  };
}

export async function getDashboardData(
  organizationId: string,
  range: { key: RangeKey; days: number; label: string },
  now: Date = new Date(),
): Promise<DashboardData> {
  const [
    stats,
    byStatus,
    contactable,
    noWebsite,
    pending,
    hotLeads,
    followUpsDue,
    usage,
    catalog,
    recentRuns,
    activity,
  ] = await Promise.all([
    getPeriodStats(organizationId, range, now),
    db.lead.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    db.lead.count({ where: { organizationId, contactable: true } }),
    db.lead.count({ where: { organizationId, websiteStatus: "NO_WEBSITE" } }),
    db.agentApproval.aggregate({
      where: pendingApprovalWhere(organizationId, now),
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    db.lead.count({ where: { organizationId, status: "NEW", leadScore: { gte: HOT_LEAD_SCORE } } }),
    db.lead.count({ where: { organizationId, AND: [followUpDueWhere(now)] } }),
    getUsage(organizationId),
    getSourceCatalog(organizationId).catch(() => ({ zeroSpendMode: true, sources: [] })),
    db.discoveryHistory.findMany({
      where: { organizationId },
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
    getRecentActivity(organizationId, 6),
  ]);

  const { points, period } = stats;
  const pipeline = byStatus.map((s) => ({ status: s.status, count: s._count._all }));
  const totalLeads = pipeline.reduce((n, s) => n + s.count, 0);
  const qualifiedSet = new Set<string>(QUALIFIED_STATUSES);
  const qualifiedTotal = pipeline.filter((s) => qualifiedSet.has(s.status)).reduce((n, s) => n + s.count, 0);
  const pendingApprovals = pending._count._all;

  return {
    range,
    generatedAt: now.toISOString(),
    totalLeads,
    contactable,
    noWebsite,
    addedToday: points[points.length - 1]?.leads ?? 0,
    qualifiedTotal,
    period,
    points,
    pipeline,
    pendingApprovals,
    oldestPendingAt: pending._min.createdAt?.toISOString() ?? null,
    hotLeads,
    followUpsDue,
    moves: buildNextMoves({ totalLeads, hotLeads, pendingApprovals, followUpsDue }),
    usage: { leads: usage.leads, aiTokens: usage.aiTokens, messages: usage.messages },
    sources: catalog.sources.map((s) => ({ id: s.id, label: s.label, availability: s.availability })),
    recentRuns,
    activity,
  };
}

/** Same shape as getDashboardData, computed from the DEMO_DATA fixtures. No database access. */
export function getDemoDashboardData(
  range: { key: RangeKey; days: number; label: string },
  now: Date = new Date(),
): DashboardData {
  const { currentStart, previousStart } = periodWindows(now, range.days);
  const qualifiedSet = new Set<string>(QUALIFIED_STATUSES);
  const leads = DEMO_LEADS.map((l) => ({
    createdAt: new Date(l.createdAt),
    status: l.status,
    leadScore: l.leadScore,
    contactable: Boolean(l.email || l.phone),
    hasWebsite: Boolean(l.website),
  }));

  const inCurrent = leads.filter((l) => l.createdAt >= currentStart);
  const inPrevious = leads.filter((l) => l.createdAt >= previousStart && l.createdAt < currentStart);
  const avg = (rows: typeof leads) =>
    rows.length === 0 ? null : round1(rows.reduce((n, l) => n + l.leadScore, 0) / rows.length);

  const points = bucketByDay(inCurrent, range.days, now);
  const byStatus = new Map<string, number>();
  for (const l of leads) byStatus.set(l.status, (byStatus.get(l.status) ?? 0) + 1);
  const pipeline = [...byStatus.entries()].map(([status, count]) => ({ status, count }));
  const hotLeads = leads.filter((l) => l.status === "NEW" && l.leadScore >= HOT_LEAD_SCORE).length;

  return {
    range,
    generatedAt: now.toISOString(),
    totalLeads: leads.length,
    contactable: leads.filter((l) => l.contactable).length,
    noWebsite: leads.filter((l) => !l.hasWebsite).length,
    addedToday: points[points.length - 1]?.leads ?? 0,
    qualifiedTotal: leads.filter((l) => qualifiedSet.has(l.status)).length,
    period: {
      newLeads: inCurrent.length,
      newLeadsPrev: inPrevious.length,
      qualified: inCurrent.filter((l) => qualifiedSet.has(l.status)).length,
      qualifiedPrev: inPrevious.filter((l) => qualifiedSet.has(l.status)).length,
      avgScore: avg(inCurrent),
      avgScorePrev: avg(inPrevious),
    },
    points,
    pipeline,
    pendingApprovals: 0,
    oldestPendingAt: null,
    hotLeads,
    followUpsDue: 0,
    moves: buildNextMoves({ totalLeads: leads.length, hotLeads, pendingApprovals: 0, followUpsDue: 0 }),
    usage: getDemoDashboard().usage,
    sources: [],
    recentRuns: [],
    activity: [],
  };
}
