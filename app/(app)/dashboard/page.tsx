import type { Metadata } from "next";
import { BadgeCheck, ClipboardCheck, Gauge, UserPlus } from "lucide-react";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { CopilotPanel } from "@/components/dashboard/CopilotPanel";
import { MomentumPanel } from "@/components/dashboard/MomentumPanel";
import { PipelineHealth } from "@/components/dashboard/PipelineHealth";
import { PlanUsagePanel } from "@/components/dashboard/PlanUsagePanel";
import { RecentRuns } from "@/components/dashboard/RecentRuns";
import { SignalChips } from "@/components/dashboard/SignalChips";
import { SourcesPanel } from "@/components/dashboard/SourcesPanel";
import { DemoBadge } from "@/components/ui/Badge";
import { KpiTile } from "@/components/ui/KpiTile";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedLinks } from "@/components/ui/SegmentedLinks";
import {
  DEFAULT_RANGE,
  RANGE_OPTIONS,
  conversionRate,
  parseRange,
  pipelineRows,
  pointsTrend,
  relativeTime,
  trendFor,
} from "@/lib/dashboard";
import { getDashboardData, getDemoDashboardData, type DashboardData } from "@/lib/dashboard-data";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

const rangeHref = (value: string) => (value === DEFAULT_RANGE ? "/dashboard" : `/dashboard?range=${value}`);

function firstNameOf(name: string | null): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

const n = (value: number) => value.toLocaleString("en-IN");

/** Shared presentation for real and demo data — the demo path only changes where the numbers come from. */
function DashboardView({ data, demo, firstName }: { data: DashboardData; demo: boolean; firstName: string | null }) {
  const { period, range } = data;
  const rangeLabel = range.label.toLowerCase();
  const nowMs = new Date(data.generatedAt).getTime();

  const qualifiedShare = conversionRate(period.newLeads, period.qualified);
  const scoreFoot =
    period.avgScore === null
      ? `No new leads in the ${rangeLabel}`
      : `Across ${n(period.newLeads)} new ${period.newLeads === 1 ? "lead" : "leads"}`;
  const approvalFoot = !data.oldestPendingAt
    ? "Nothing waiting on you"
    : (() => {
        const age = relativeTime(data.oldestPendingAt, nowMs);
        return `Oldest request ${age === "now" ? "just arrived" : `${age} ago`}`;
      })();

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          demo ? (
            "Demo workspace"
          ) : (
            <>
              Welcome back{firstName ? `, ${firstName}` : ""} <span aria-hidden="true" className="text-neon-cyan">✦</span>
            </>
          )
        }
        badge={demo ? <DemoBadge /> : undefined}
        description={
          demo ? "Sample pipeline data for demonstration." : "Here's what is moving in your pipeline right now."
        }
        actions={<SegmentedLinks label="Date range" options={RANGE_OPTIONS} current={range.key} hrefFor={rangeHref} />}
      />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile
          index={0}
          icon={UserPlus}
          tone="cyan"
          label="New leads"
          value={period.newLeads}
          trend={trendFor(period.newLeads, period.newLeadsPrev)}
          foot={`${n(data.totalLeads)} in workspace · ${rangeLabel}`}
        />
        <KpiTile
          index={1}
          icon={BadgeCheck}
          tone="violet"
          label="Qualified"
          value={period.qualified}
          trend={trendFor(period.qualified, period.qualifiedPrev)}
          foot={
            qualifiedShare === null
              ? `No new leads in the ${rangeLabel}`
              : `${qualifiedShare.toLocaleString("en-IN", { minimumFractionDigits: 1 })}% of new leads`
          }
        />
        <KpiTile
          index={2}
          icon={Gauge}
          tone="lime"
          label="Avg. lead score"
          value={period.avgScore === null ? "—" : period.avgScore}
          decimals={1}
          trend={pointsTrend(period.avgScore, period.avgScorePrev)}
          foot={scoreFoot}
        />
        <KpiTile
          index={3}
          icon={ClipboardCheck}
          tone="pink"
          label="Awaiting approval"
          value={data.pendingApprovals}
          foot={approvalFoot}
          href={demo ? undefined : "/approvals"}
        />
      </section>

      <SignalChips
        signals={[
          { label: "Contactable", value: data.contactable, href: demo ? undefined : "/leads?contactable=true" },
          { label: "No website", value: data.noWebsite, href: demo ? undefined : "/leads?websiteStatus=NO_WEBSITE" },
          { label: "Added today", value: data.addedToday },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.79fr)_minmax(0,1fr)]">
        <MomentumPanel points={data.points} rangeLabel={range.label} />
        <CopilotPanel moves={data.moves} />
        <PipelineHealth
          rows={pipelineRows(data.pipeline)}
          conversion={conversionRate(data.totalLeads, data.qualifiedTotal)}
          demo={demo}
        />
        <ActivityFeed initial={data.activity} generatedAt={data.generatedAt} live={!demo} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.79fr)_minmax(0,1fr)]">
        <RecentRuns runs={data.recentRuns} demo={demo} />
        <div className="space-y-4">
          <SourcesPanel sources={data.sources} demo={demo} />
          <PlanUsagePanel usage={data.usage} demo={demo} />
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-line pt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
        <p>WDD AI Sales OS • Built for momentum</p>
        <p>Human approval required before outbound messages</p>
      </footer>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = parseRange((await searchParams).range);
  const ctx = await getPageContext();

  // Demo mode: the same dashboard from clearly labelled fixtures — no database
  // access and no real user.
  if (ctx.demo) return <DashboardView data={getDemoDashboardData(range)} demo firstName={null} />;

  const data = await getDashboardData(ctx.organizationId, range);
  return <DashboardView data={data} demo={false} firstName={firstNameOf(ctx.user.name)} />;
}
