import type { Metadata } from "next";
import type { JobStatus } from "@prisma/client";
import { AlertTriangle, CheckCircle2, Hourglass, Play, Workflow } from "lucide-react";
import { CancelJobButton } from "@/components/app/CancelJobButton";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { KpiTile } from "@/components/ui/KpiTile";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedLinks } from "@/components/ui/SegmentedLinks";
import { isKillSwitchOn } from "@/lib/automation/types";
import { stagger } from "@/lib/cn";
import { db } from "@/lib/db";
import { formatUtcDateTime } from "@/lib/format-date";
import { jobLabel, jobStatus } from "@/lib/job-labels";
import { getPageContext } from "@/lib/page-context";
import { roleAtLeast } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Automations" };

const VIEWS: ReadonlyArray<{ value: string; label: string; statuses: readonly JobStatus[] | null }> = [
  { value: "active", label: "Active", statuses: ["QUEUED", "RUNNING", "RETRYING"] },
  { value: "failed", label: "Failed", statuses: ["FAILED"] },
  { value: "done", label: "Finished", statuses: ["COMPLETED", "CANCELLED"] },
  { value: "all", label: "All", statuses: null },
];

const DAY = 86_400_000;

export default async function AutomationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getPageContext();
  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Automations" badge={<DemoBadge />} />
        <DemoUnavailable what="Automations">
          The job queue runs against a real workspace. Demo mode never starts background work.
        </DemoUnavailable>
      </div>
    );
  }

  if (!roleAtLeast(ctx.role, "SALES_EXECUTIVE")) {
    return (
      <div className="space-y-5">
        <PageHeader title="Automations" description="Background jobs and rules for this workspace." />
        <InlineAlert tone="amber" title="Your role can't view the job queue">
          Ask a workspace admin if you need access.
        </InlineAlert>
      </div>
    );
  }

  const rawView = (await searchParams).view;
  const view = VIEWS.find((v) => v.value === (Array.isArray(rawView) ? rawView[0] : rawView)) ?? VIEWS[0];
  const canCancel = roleAtLeast(ctx.role, "SALES_MANAGER");
  const orgId = ctx.organizationId;
  // Request-scoped clock (this is an async server component, not a memoised render).
  const now = new Date().getTime();
  const killSwitch = isKillSwitchOn();

  const [queued, running, retrying, failed7d, done24h, jobs, rules] = await Promise.all([
    db.job.count({ where: { organizationId: orgId, status: "QUEUED" } }),
    db.job.count({ where: { organizationId: orgId, status: "RUNNING" } }),
    db.job.count({ where: { organizationId: orgId, status: "RETRYING" } }),
    db.job.count({ where: { organizationId: orgId, status: "FAILED", updatedAt: { gte: new Date(now - 7 * DAY) } } }),
    db.job.count({ where: { organizationId: orgId, status: "COMPLETED", finishedAt: { gte: new Date(now - DAY) } } }),
    db.job.findMany({
      where: { organizationId: orgId, ...(view.statuses ? { status: { in: [...view.statuses] } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        error: true,
        createdAt: true,
        finishedAt: true,
      },
    }),
    db.automation.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        name: true,
        status: true,
        triggers: { select: { type: true } },
        actions: { orderBy: { order: "asc" }, select: { type: true, requiresApproval: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description="Background jobs and rules for this workspace. Anything that would contact a prospect stops in the Approval queue first."
        actions={
          <SegmentedLinks
            label="Show jobs"
            options={VIEWS.map((v) => ({ value: v.value, label: v.label }))}
            current={view.value}
            hrefFor={(v) => (v === "active" ? "/automation" : `/automation?view=${v}`)}
          />
        }
      />

      {killSwitch ? (
        <InlineAlert tone="amber" title="Automation is paused">
          The operator kill switch is on, so queued jobs will not run until it is turned off. Manual actions still work.
        </InlineAlert>
      ) : (
        <p className="text-xs text-ink-muted">
          Automation is enabled. Queued jobs are picked up by the scheduled worker (see “How jobs run” below).
        </p>
      )}

      <section aria-label="Queue summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile
          index={0}
          icon={Hourglass}
          tone="blue"
          label="Queued"
          value={queued}
          foot={retrying > 0 ? `${retrying} retrying` : "Waiting for the worker"}
        />
        <KpiTile index={1} icon={Play} tone="cyan" label="Running" value={running} foot="Started, not finished" />
        <KpiTile index={2} icon={CheckCircle2} tone="lime" label="Completed · 24h" value={done24h} foot="Finished in the last day" />
        <KpiTile index={3} icon={AlertTriangle} tone="pink" label="Failed · 7 days" value={failed7d} foot="See the Failed view" />
      </section>

      <Card aria-labelledby="jobs-title" className="rise-in" style={stagger(4)}>
        <CardHeader
          id="jobs-title"
          title="Jobs"
          description={`${view.label} jobs, newest first (up to 50). Times are UTC.`}
        />
        {jobs.length === 0 ? (
          <EmptyState
            icon={Workflow}
            tone="muted"
            className="mt-4 py-10"
            title={view.value === "active" ? "Nothing is queued or running" : "No jobs in this view"}
            description="Jobs appear here when discovery, research, scoring or prospecting runs are queued for this workspace."
          />
        ) : (
          <DataTable
            label="Jobs"
            minWidth={720}
            className="mt-3"
            head={
              <>
                <Th>Job</Th>
                <Th>Status</Th>
                <Th right>Attempts</Th>
                <Th>Created</Th>
                <Th>Finished</Th>
                <Th>Detail</Th>
                {canCancel && (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </>
            }
          >
            {jobs.map((j) => {
              const st = jobStatus(j.status);
              const cancellable = canCancel && (j.status === "QUEUED" || j.status === "RETRYING");
              return (
                <Tr key={j.id}>
                  <Td className="font-medium">{jobLabel(j.name)}</Td>
                  <Td>
                    <Badge tone={st.tone} dot={j.status === "RUNNING"} live={j.status === "RUNNING"}>
                      {st.label}
                    </Badge>
                  </Td>
                  <Td right>
                    {j.attempts}/{j.maxAttempts}
                  </Td>
                  <Td nowrap className="text-ink-muted">
                    {formatUtcDateTime(j.createdAt)}
                  </Td>
                  <Td nowrap className="text-ink-muted">
                    {j.finishedAt ? formatUtcDateTime(j.finishedAt) : "—"}
                  </Td>
                  <Td className="max-w-[260px] text-ink-muted">
                    {j.error ? <span className="line-clamp-2 break-words text-red-300">{j.error.slice(0, 240)}</span> : "—"}
                  </Td>
                  {canCancel && <Td>{cancellable ? <CancelJobButton id={j.id} label={jobLabel(j.name)} /> : null}</Td>}
                </Tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Card aria-labelledby="rules-title" className="rise-in" style={stagger(5)}>
          <CardHeader id="rules-title" title="Automation rules" description="Trigger → actions. Outbound actions require approval." />
          {rules.length === 0 ? (
            <EmptyState
              icon={Workflow}
              tone="muted"
              className="mt-4 py-8"
              title="No automation rules yet"
              description="Rules can't be created from the app yet. This list shows any rule configured for the workspace."
            />
          ) : (
            <ul className="mt-4 space-y-3">
              {rules.map((r) => (
                <li key={r.id} className="rounded-control border border-line bg-surface-2/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{r.name}</p>
                    <Badge tone={r.status === "ACTIVE" ? "lime" : "muted"}>{r.status.toLowerCase()}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-muted">
                    When {r.triggers.map((t) => t.type.replace(/[-_]/g, " ")).join(" or ") || "—"}
                    {r.actions.length > 0 &&
                      ` → ${r.actions
                        .map((a) => `${a.type.replace(/[-_]/g, " ")}${a.requiresApproval ? " (needs approval)" : ""}`)
                        .join(", then ")}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="how-title" className="rise-in" style={stagger(6)}>
          <CardHeader id="how-title" title="How jobs run" />
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-muted">
            <li>
              A scheduled worker processes queued jobs in small batches. The repository&apos;s cron is configured to run it once a
              day at 03:30 UTC.
            </li>
            <li>
              Some actions, such as <span className="text-ink">Run now</span> in Prospecting, process this workspace&apos;s queue
              straight away.
            </li>
            <li>Failed jobs retry automatically up to their attempt limit; permanent failures (bad input, quota reached) stop at once.</li>
            <li>Nothing here sends a message. Drafts wait in the Approval queue until a person approves them.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
