import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, ClipboardCheck, Download, UserPlus } from "lucide-react";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { MomentumPanel } from "@/components/dashboard/MomentumPanel";
import { DemoBadge } from "@/components/ui/Badge";
import { BarList } from "@/components/ui/BarList";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiTile } from "@/components/ui/KpiTile";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedLinks } from "@/components/ui/SegmentedLinks";
import type { Tone } from "@/components/ui/tone";
import { getAnalyticsData } from "@/lib/analytics-data";
import { stagger } from "@/lib/cn";
import { DEFAULT_RANGE, RANGE_OPTIONS, conversionRate, parseRange, trendFor } from "@/lib/dashboard";
import { sourceLabel } from "@/lib/lead-filters";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics" };

const rangeHref = (value: string) => (value === DEFAULT_RANGE ? "/analytics" : `/analytics?range=${value}`);

const WEBSITE: Record<string, { label: string; tone: Tone; href?: string }> = {
  NO_WEBSITE: { label: "No website", tone: "cyan", href: "/leads?websiteStatus=NO_WEBSITE" },
  HAS_WEBSITE: { label: "Has a website", tone: "blue", href: "/leads?websiteStatus=HAS_WEBSITE" },
  UNKNOWN: { label: "Unknown", tone: "muted", href: "/leads?websiteStatus=UNKNOWN" },
};
const BAND_TONES: Tone[] = ["muted", "muted", "amber", "cyan", "lime"];

const n = (v: number) => v.toLocaleString("en-IN");

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = parseRange((await searchParams).range);
  const ctx = await getPageContext();
  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Analytics" badge={<DemoBadge />} />
        <DemoUnavailable what="Analytics">
          Analytics are computed from your own workspace&apos;s activity. The demo dashboard shows its sample pipeline instead.
        </DemoUnavailable>
      </div>
    );
  }

  const data = await getAnalyticsData(ctx.organizationId, range);
  const { period, discovery, approvals } = data;
  const rangeLabel = range.label.toLowerCase();
  const decisions = approvals.approved + approvals.rejected;
  const qualifiedShare = conversionRate(period.newLeads, period.qualified);
  const sourceTotal = data.bySource.reduce((t, s) => t + s.count, 0);
  const websiteTotal = data.byWebsite.reduce((t, w) => t + w.count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Real counts from this workspace. Nothing is estimated or projected."
        actions={<SegmentedLinks label="Date range" options={RANGE_OPTIONS} current={range.key} hrefFor={rangeHref} />}
      />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
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
          foot={qualifiedShare === null ? `No new leads in the ${rangeLabel}` : `${qualifiedShare.toLocaleString("en-IN", { minimumFractionDigits: 1 })}% of new leads`}
        />
        <KpiTile
          index={2}
          icon={Download}
          tone="lime"
          label="Imported from discovery"
          value={discovery.imported}
          foot={`${n(discovery.runs)} ${discovery.runs === 1 ? "run" : "runs"}${discovery.failedRuns > 0 ? ` · ${discovery.failedRuns} failed` : ""}`}
        />
        <KpiTile
          index={3}
          icon={ClipboardCheck}
          tone="pink"
          label="Approval decisions"
          value={decisions}
          foot={`${n(approvals.approved)} approved · ${n(approvals.rejected)} rejected`}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.79fr)_minmax(0,1fr)]">
        <MomentumPanel points={data.points} rangeLabel={range.label} />

        <Card aria-labelledby="source-title" className="rise-in" style={stagger(4)}>
          <CardHeader id="source-title" title="New leads by source" description={`Created in the ${rangeLabel}`} />
          {data.bySource.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No leads were created in this period.</p>
          ) : (
            <div className="mt-4">
              <BarList
                total={sourceTotal}
                items={data.bySource.map((s) => ({
                  key: s.sourceType,
                  name: sourceLabel(s.sourceType),
                  label: sourceLabel(s.sourceType),
                  value: s.count,
                }))}
              />
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card aria-labelledby="score-title" className="rise-in" style={stagger(5)}>
          <CardHeader id="score-title" title="Lead score" description="All leads, by score band" />
          <div className="mt-4">
            <BarList
              total={data.totalLeads}
              items={data.scoreBuckets.map((b, i) => ({
                key: b.label,
                name: `Score ${b.label}`,
                label: b.label,
                value: b.count,
                tone: BAND_TONES[i],
                // The 80+ band is exactly what /leads?minScore=80 lists.
                href: b.from === 80 ? "/leads?minScore=80" : undefined,
              }))}
            />
          </div>
        </Card>

        <Card aria-labelledby="web-title" className="rise-in" style={stagger(6)}>
          <CardHeader id="web-title" title="Website status" description="All leads" />
          {websiteTotal === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No leads yet.</p>
          ) : (
            <div className="mt-4">
              <BarList
                total={websiteTotal}
                items={data.byWebsite
                  .slice()
                  .sort((a, b) => b.count - a.count)
                  .map((w) => {
                    const meta = WEBSITE[w.status] ?? { label: w.status, tone: "muted" as Tone };
                    return { key: w.status, name: meta.label, label: meta.label, value: w.count, tone: meta.tone, href: meta.href };
                  })}
              />
            </div>
          )}
        </Card>

        <Card aria-labelledby="ind-title" className="rise-in lg:col-span-2 xl:col-span-1" style={stagger(7)}>
          <CardHeader id="ind-title" title="Top industries" description="All leads that have an industry" />
          {data.industries.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No industry data yet.</p>
          ) : (
            <div className="mt-4">
              <BarList
                total={data.industries.reduce((t, i) => t + i.count, 0)}
                tone="violet"
                items={data.industries.map((i) => ({ key: i.industry, name: i.industry, label: i.industry, value: i.count }))}
              />
            </div>
          )}
        </Card>
      </div>

      <Card aria-labelledby="disc-title" className="rise-in" style={stagger(8)}>
        <CardHeader
          id="disc-title"
          title="Discovery results"
          description={`Runs in the ${rangeLabel}`}
          actions={
            <Link href="/discover/history" className="text-xs font-semibold text-neon-cyan hover:underline">
              Run history →
            </Link>
          }
        />
        {discovery.runs === 0 ? (
          <EmptyState
            icon={Download}
            tone="muted"
            className="mt-4 py-8"
            title="No discovery runs in this period"
            description="Run a discovery to see how many businesses were found, contactable and imported."
            action={<ButtonLink href="/discover" size="sm">Open Discover</ButtonLink>}
          />
        ) : (
          <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Runs", value: n(discovery.runs), note: discovery.failedRuns > 0 ? `${discovery.failedRuns} failed` : "none failed" },
              { label: "Found", value: n(discovery.discovered), note: "candidates across sources" },
              {
                label: "Contactable",
                value: n(discovery.contactable),
                note: discovery.discovered > 0 ? `${Math.round((discovery.contactable / discovery.discovered) * 100)}% of found` : "—",
              },
              {
                label: "Imported",
                value: n(discovery.imported),
                note: discovery.discovered > 0 ? `${Math.round((discovery.imported / discovery.discovered) * 100)}% of found` : "—",
              },
            ].map((m) => (
              <div key={m.label} className="rounded-control border border-line bg-surface-2/60 p-4">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{m.label}</dt>
                <dd className="tnum mt-1 text-2xl font-semibold text-ink">{m.value}</dd>
                <dd className="mt-0.5 text-[11px] text-ink-muted">{m.note}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
