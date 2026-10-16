import type { Metadata } from "next";
import Link from "next/link";
import { LockKeyhole, ShieldAlert, ShieldCheck } from "lucide-react";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { KpiTile } from "@/components/ui/KpiTile";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedLinks } from "@/components/ui/SegmentedLinks";
import type { Tone } from "@/components/ui/tone";
import { isKillSwitchOn } from "@/lib/automation/types";
import { stagger } from "@/lib/cn";
import { db } from "@/lib/db";
import { formatUtcDateTime } from "@/lib/format-date";
import { getPageContext } from "@/lib/page-context";
import { roleAtLeast } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Security" };

const DAY = 86_400_000;
const VIEWS = [
  { value: "all", label: "All events" },
  { value: "issues", label: "Denied or failed" },
] as const;

const RESULT: Record<string, Tone> = { SUCCESS: "lime", DENIED: "amber", FAILED: "red" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getPageContext();
  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Security" badge={<DemoBadge />} />
        <DemoUnavailable what="The audit trail" />
      </div>
    );
  }

  if (!roleAtLeast(ctx.role, "ADMIN")) {
    return (
      <div className="space-y-5">
        <PageHeader title="Security" description="Audit trail and safeguards for this workspace." />
        <InlineAlert tone="amber" title="Only owners and admins can see the audit trail">
          Your role is {ctx.role.replace(/_/g, " ").toLowerCase()}. Ask a workspace owner or admin if you need to review activity.
        </InlineAlert>
      </div>
    );
  }

  const rawView = (await searchParams).view;
  const view = VIEWS.find((v) => v.value === (Array.isArray(rawView) ? rawView[0] : rawView))?.value ?? "all";
  const orgId = ctx.organizationId;
  // Request-scoped clock (this is an async server component, not a memoised render).
  const now = new Date().getTime();

  const [events24h, issues7d, rows] = await Promise.all([
    db.auditLog.count({ where: { organizationId: orgId, createdAt: { gte: new Date(now - DAY) } } }),
    db.auditLog.count({
      where: { organizationId: orgId, result: { not: "SUCCESS" }, createdAt: { gte: new Date(now - 7 * DAY) } },
    }),
    db.auditLog.findMany({
      where: { organizationId: orgId, ...(view === "issues" ? { result: { not: "SUCCESS" } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        action: true,
        resource: true,
        resourceId: true,
        result: true,
        ip: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
      },
    }),
  ]);

  const killSwitch = isKillSwitchOn();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="Who did what in this workspace, and the safeguards that are always in force."
        actions={
          <SegmentedLinks
            label="Show events"
            options={VIEWS.map((v) => ({ value: v.value, label: v.label }))}
            current={view}
            hrefFor={(v) => (v === "all" ? "/security" : `/security?view=${v}`)}
          />
        }
      />

      <section aria-label="Security summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile index={0} icon={LockKeyhole} tone="cyan" label="Events · 24h" value={events24h} foot="Recorded in the audit trail" />
        <KpiTile
          index={1}
          icon={ShieldAlert}
          tone={issues7d > 0 ? "pink" : "lime"}
          label="Denied or failed · 7d"
          value={issues7d}
          foot={issues7d > 0 ? "Review them below" : "None in the last week"}
        />
        <KpiTile
          index={2}
          icon={ShieldCheck}
          tone="violet"
          label="Approval gate"
          value="Always on"
          foot="Outbound drafts need a person"
          href="/approvals"
        />
        <KpiTile
          index={3}
          icon={ShieldCheck}
          tone={killSwitch ? "pink" : "lime"}
          label="Automation"
          value={killSwitch ? "Paused" : "Enabled"}
          foot={killSwitch ? "Operator kill switch is on" : "Kill switch is off"}
          href="/automation"
        />
      </section>

      <Card aria-labelledby="audit-title" className="rise-in" style={stagger(4)}>
        <CardHeader
          id="audit-title"
          title="Audit trail"
          description="The latest 100 events for this workspace, newest first. Times are UTC."
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            tone="muted"
            className="mt-4 py-10"
            title={view === "issues" ? "No denied or failed events" : "No events recorded yet"}
            description="Actions such as creating leads, exporting data and approving drafts are recorded here."
          />
        ) : (
          <DataTable
            label="Audit trail"
            minWidth={720}
            className="mt-3"
            head={
              <>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Record</Th>
                <Th>Result</Th>
                <Th>IP address</Th>
              </>
            }
          >
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td nowrap className="text-ink-muted">
                  {formatUtcDateTime(r.createdAt)}
                </Td>
                <Td className="max-w-[200px] truncate">{r.actor?.name ?? r.actor?.email ?? "System"}</Td>
                <Td className="font-medium">{r.action.replace(/[._]/g, " ")}</Td>
                <Td className="text-ink-muted">
                  {r.resource ?? "—"}
                  {r.resourceId && <span className="ml-1.5 font-mono text-[10px] text-ink-dim">{r.resourceId.slice(0, 8)}</span>}
                </Td>
                <Td>
                  <Badge tone={RESULT[r.result] ?? "muted"}>{r.result.toLowerCase()}</Badge>
                </Td>
                <Td nowrap className="font-mono text-[11px] text-ink-muted">
                  {r.ip ?? "—"}
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card aria-labelledby="safe-title" className="rise-in" style={stagger(5)}>
        <CardHeader id="safe-title" title="Safeguards in force" description="Built into the product — none of these can be switched off from the app" />
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {[
            {
              title: "A person approves outbound drafts",
              body: "AI workflows can only propose. The Approval queue runs exactly what you were shown, and never sends to a prospect.",
              link: { href: "/approvals", label: "Open the Approval queue" },
            },
            {
              title: "Workspace isolation",
              body: "Data is scoped to the workspace you are signed in to, and the server re-checks your membership on every request.",
            },
            {
              title: "Sessions",
              body: "Sign-in uses HttpOnly cookies. “Remember me” keeps you signed in for 30 days; otherwise a session lasts 1 day.",
            },
            {
              title: "Operator kill switch",
              body: "The platform operator can pause all automation at once. It is currently " + (killSwitch ? "on." : "off."),
              link: { href: "/automation", label: "Open Automations" },
            },
          ].map((s) => (
            <li key={s.title} className="rounded-control border border-line bg-surface-2/60 p-4">
              <p className="text-sm font-semibold text-ink">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{s.body}</p>
              {s.link && (
                <Link href={s.link.href} className="mt-2 inline-block text-xs font-semibold text-neon-cyan hover:underline">
                  {s.link.label} →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
