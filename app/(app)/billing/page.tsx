import type { Metadata } from "next";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { Tone } from "@/components/ui/tone";
import { stagger } from "@/lib/cn";
import { db } from "@/lib/db";
import { formatUtcDate } from "@/lib/format-date";
import { getPageContext } from "@/lib/page-context";
import { getPlanLimits, getUsage } from "@/lib/quotas";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plan & usage" };

const SUBSCRIPTION: Record<string, { label: string; tone: Tone }> = {
  TRIALING: { label: "Trial", tone: "cyan" },
  ACTIVE: { label: "Active", tone: "lime" },
  PAST_DUE: { label: "Past due", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
  INCOMPLETE: { label: "Incomplete", tone: "amber" },
};

function toneFor(used: number, limit: number): Tone {
  const ratio = used / Math.max(1, limit);
  return ratio >= 0.9 ? "red" : ratio >= 0.7 ? "amber" : "cyan";
}

const n = (v: number) => v.toLocaleString("en-IN");

/**
 * Read-only plan and usage. There is no payment provider wired in, so this page offers no
 * checkout, upgrade or invoice controls — it shows what is actually recorded.
 */
export default async function BillingPage() {
  const ctx = await getPageContext();
  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Plan & usage" badge={<DemoBadge />} />
        <DemoUnavailable what="Plan & usage" />
      </div>
    );
  }

  const orgId = ctx.organizationId;
  const [subscription, usage, limits, members, plans] = await Promise.all([
    db.subscription.findUnique({
      where: { organizationId: orgId },
      select: { status: true, currentPeriodEnd: true, plan: { select: { name: true, tier: true } } },
    }),
    getUsage(orgId),
    getPlanLimits(orgId),
    db.membership.count({ where: { organizationId: orgId } }),
    db.plan.findMany({ orderBy: { maxLeads: "asc" } }),
  ]);

  const sub = subscription ? (SUBSCRIPTION[subscription.status] ?? { label: subscription.status, tone: "muted" as Tone }) : null;
  const planName = subscription?.plan.name ?? "Free (default)";

  const meters = [
    { label: "Leads", note: "all time", used: usage.leads.used, limit: usage.leads.limit },
    { label: "Team members", note: "seats", used: members, limit: limits.maxUsers },
    { label: "AI tokens", note: "today", used: usage.aiTokens.used, limit: usage.aiTokens.limit },
    { label: "Messages", note: "today", used: usage.messages.used, limit: usage.messages.limit },
    { label: "Discovery searches", note: "today (UTC)", used: usage.discovery.searches.used, limit: usage.discovery.searches.limit },
    { label: "Discovery records", note: "today (UTC)", used: usage.discovery.records.used, limit: usage.discovery.records.limit },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan & usage"
        description="Your workspace's plan and how much of it you have used."
        badge={sub ? <Badge tone={sub.tone}>{sub.label}</Badge> : undefined}
      />

      <InlineAlert tone="cyan" title="Payments aren't available in the app yet">
        There is no checkout or invoicing here, and plans can&apos;t be changed from this page. This page only shows what is recorded
        for your workspace.
      </InlineAlert>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card aria-labelledby="plan-title" className="rise-in" style={stagger(1)}>
          <CardHeader id="plan-title" title="Current plan" />
          <p className="mt-4 text-3xl font-semibold text-ink">{planName}</p>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Status</dt>
              <dd className="text-ink">{sub ? sub.label : "No subscription record"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Current period ends</dt>
              <dd className="text-ink">{subscription?.currentPeriodEnd ? formatUtcDate(subscription.currentPeriodEnd) : "Not recorded"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Your role</dt>
              <dd className="text-ink">{ctx.role.replace(/_/g, " ").toLowerCase()}</dd>
            </div>
          </dl>
        </Card>

        <Card aria-labelledby="usage-title" className="rise-in" style={stagger(2)}>
          <CardHeader id="usage-title" title="Usage against your limits" description="Bars turn amber at 70% and red at 90%" />
          <ul className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {meters.map((m) => (
              <li key={m.label}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-medium text-ink">
                    {m.label} <span className="font-normal text-ink-muted">· {m.note}</span>
                  </span>
                  <span className="tnum text-ink-muted">
                    {n(m.used)} / {n(m.limit)}
                  </span>
                </div>
                <ProgressBar
                  className="mt-1.5"
                  value={m.used}
                  max={m.limit}
                  tone={toneFor(m.used, m.limit)}
                  label={`${m.label} (${m.note}): ${m.used} of ${m.limit}`}
                />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card aria-labelledby="plans-title" className="rise-in" style={stagger(3)}>
        <CardHeader id="plans-title" title="Plans and their limits" description="Read-only comparison of the plans defined for this product" />
        <div className="-mx-5 mt-4 overflow-x-auto px-5" role="region" aria-label="Plans (scrolls sideways on small screens)" tabIndex={0}>
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <caption className="sr-only">Plan limits</caption>
            <thead>
              <tr className="border-b border-line text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                <th scope="col" className="px-3 py-2">Plan</th>
                <th scope="col" className="px-3 py-2 text-right">Leads</th>
                <th scope="col" className="px-3 py-2 text-right">Members</th>
                <th scope="col" className="px-3 py-2 text-right">AI tokens / day</th>
                <th scope="col" className="px-3 py-2 text-right">Messages / day</th>
                <th scope="col" className="px-3 py-2 text-right">Discovery searches / day</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const current = subscription?.plan.tier === p.tier;
                return (
                  <tr key={p.id} className={`border-b border-line/60 last:border-0 ${current ? "bg-neon-cyan/5" : ""}`}>
                    <th scope="row" className="px-3 py-2.5 text-left font-semibold text-ink">
                      {p.name} {current && <Badge tone="cyan">Current</Badge>}
                    </th>
                    <td className="tnum px-3 py-2.5 text-right text-ink">{n(p.maxLeads)}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink">{n(p.maxUsers)}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink">{n(p.aiTokensPerDay)}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink">{n(p.messagesPerDay)}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink">{n(p.discoverySearchesPerDay)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
