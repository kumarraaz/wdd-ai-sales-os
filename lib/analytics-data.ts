/**
 * Analytics page data. Every figure is an aggregate over this workspace's own rows
 * (organizationId on every query); nothing is estimated or projected.
 *
 * Two kinds of numbers appear, and the page labels which is which:
 *  - "in range": rows created/decided inside the selected window (7/30/90 UTC days)
 *  - "all leads": the current state of every lead in the workspace
 */
import { db } from "./db";
import { getPeriodStats, type PeriodStats } from "./dashboard-data";
import { periodWindows, type RangeKey } from "./dashboard";

export interface ScoreBucket {
  label: string;
  from: number;
  to: number;
  count: number;
}

export interface AnalyticsData extends PeriodStats {
  range: { key: RangeKey; days: number; label: string };
  totalLeads: number;
  /** leads created in range, by source */
  bySource: { sourceType: string; count: number }[];
  /** all leads, by website status (null → "unknown") */
  byWebsite: { status: string; count: number }[];
  /** all leads, by score band */
  scoreBuckets: ScoreBucket[];
  /** all leads with an industry, most common first */
  industries: { industry: string; count: number }[];
  discovery: { runs: number; failedRuns: number; discovered: number; contactable: number; imported: number };
  /** approvals a person decided inside the range */
  approvals: { approved: number; rejected: number; failed: number };
}

const SCORE_BANDS: ReadonlyArray<[number, number]> = [
  [0, 19],
  [20, 39],
  [40, 59],
  [60, 79],
  [80, 100],
];

export async function getAnalyticsData(
  organizationId: string,
  range: { key: RangeKey; days: number; label: string },
  now: Date = new Date(),
): Promise<AnalyticsData> {
  const { currentStart } = periodWindows(now, range.days);

  const [stats, totalLeads, bySource, byWebsite, bands, industries, discoveryAgg, failedRuns, decided] = await Promise.all([
    getPeriodStats(organizationId, range, now),
    db.lead.count({ where: { organizationId } }),
    db.lead.groupBy({
      by: ["sourceType"],
      where: { organizationId, createdAt: { gte: currentStart } },
      _count: { _all: true },
    }),
    db.lead.groupBy({ by: ["websiteStatus"], where: { organizationId }, _count: { _all: true } }),
    Promise.all(
      SCORE_BANDS.map(([from, to]) =>
        db.lead.count({ where: { organizationId, leadScore: { gte: from, lte: to } } }),
      ),
    ),
    db.lead.groupBy({
      by: ["industry"],
      where: { organizationId, industry: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { industry: "desc" } },
      take: 8,
    }),
    db.discoveryHistory.aggregate({
      where: { organizationId, createdAt: { gte: currentStart } },
      _count: { _all: true },
      _sum: { discovered: true, contactable: true, imported: true },
    }),
    db.discoveryHistory.count({ where: { organizationId, createdAt: { gte: currentStart }, status: "FAILED" } }),
    db.agentApproval.groupBy({
      by: ["status"],
      where: { organizationId, reviewedAt: { gte: currentStart }, status: { in: ["APPROVED", "EXECUTED", "REJECTED", "FAILED"] } },
      _count: { _all: true },
    }),
  ]);

  const decidedBy = new Map(decided.map((d) => [d.status, d._count._all] as const));

  return {
    ...stats,
    range,
    totalLeads,
    bySource: bySource.map((s) => ({ sourceType: s.sourceType, count: s._count._all })).sort((a, b) => b.count - a.count),
    byWebsite: byWebsite.map((w) => ({ status: w.websiteStatus ?? "UNKNOWN", count: w._count._all })),
    scoreBuckets: SCORE_BANDS.map(([from, to], i) => ({ label: `${from}–${to}`, from, to, count: bands[i] })),
    industries: industries
      .filter((i): i is typeof i & { industry: string } => i.industry !== null)
      .map((i) => ({ industry: i.industry, count: i._count._all })),
    discovery: {
      runs: discoveryAgg._count._all,
      failedRuns,
      discovered: discoveryAgg._sum.discovered ?? 0,
      contactable: discoveryAgg._sum.contactable ?? 0,
      imported: discoveryAgg._sum.imported ?? 0,
    },
    approvals: {
      approved: (decidedBy.get("APPROVED") ?? 0) + (decidedBy.get("EXECUTED") ?? 0) + (decidedBy.get("FAILED") ?? 0),
      rejected: decidedBy.get("REJECTED") ?? 0,
      failed: decidedBy.get("FAILED") ?? 0,
    },
  };
}
