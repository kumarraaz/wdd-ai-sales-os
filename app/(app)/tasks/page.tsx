import type { Metadata } from "next";
import type { Prisma, TaskPriority, TaskStatus } from "@prisma/client";
import Link from "next/link";
import { AlarmClock, CalendarClock, CheckCheck, CheckSquare, ListTodo } from "lucide-react";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiTile } from "@/components/ui/KpiTile";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedLinks } from "@/components/ui/SegmentedLinks";
import type { Tone } from "@/components/ui/tone";
import { stagger } from "@/lib/cn";
import { db } from "@/lib/db";
import { formatUtcDate } from "@/lib/format-date";
import { leadDisplayName } from "@/lib/lead-display";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tasks" };

const OPEN: TaskStatus[] = ["TODO", "IN_PROGRESS"];
const DAY = 86_400_000;

const VIEWS = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
] as const;

const PRIORITY: Record<TaskPriority, { label: string; tone: Tone }> = {
  URGENT: { label: "Urgent", tone: "red" },
  HIGH: { label: "High", tone: "amber" },
  MEDIUM: { label: "Medium", tone: "cyan" },
  LOW: { label: "Low", tone: "muted" },
};

const STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  TODO: { label: "To do", tone: "blue" },
  IN_PROGRESS: { label: "In progress", tone: "cyan" },
  DONE: { label: "Done", tone: "lime" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getPageContext();
  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Tasks" badge={<DemoBadge />} />
        <DemoUnavailable what="Tasks" />
      </div>
    );
  }

  const rawView = (await searchParams).view;
  const view = VIEWS.find((v) => v.value === (Array.isArray(rawView) ? rawView[0] : rawView))?.value ?? "open";
  const orgId = ctx.organizationId;
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * DAY);

  const viewWhere: Prisma.TaskWhereInput =
    view === "open"
      ? { status: { in: OPEN } }
      : view === "overdue"
        ? { status: { in: OPEN }, dueAt: { lt: now } }
        : view === "done"
          ? { status: "DONE" }
          : {};

  const [open, overdue, dueSoon, done30, tasks] = await Promise.all([
    db.task.count({ where: { organizationId: orgId, status: { in: OPEN } } }),
    db.task.count({ where: { organizationId: orgId, status: { in: OPEN }, dueAt: { lt: now } } }),
    db.task.count({ where: { organizationId: orgId, status: { in: OPEN }, dueAt: { gte: now, lt: weekAhead } } }),
    db.task.count({ where: { organizationId: orgId, status: "DONE", updatedAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
    db.task.findMany({
      where: { organizationId: orgId, ...viewWhere },
      orderBy:
        view === "done" ? { updatedAt: "desc" } : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        title: true,
        detail: true,
        status: true,
        priority: true,
        dueAt: true,
        lead: { select: { id: true, fullName: true, company: { select: { name: true } } } },
        assignedTo: { select: { name: true, email: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Follow-ups and to-dos for this workspace. Tasks are created when you approve a CRM task proposal."
        actions={
          <SegmentedLinks
            label="Show tasks"
            options={VIEWS.map((v) => ({ value: v.value, label: v.label }))}
            current={view}
            hrefFor={(v) => (v === "open" ? "/tasks" : `/tasks?view=${v}`)}
          />
        }
      />

      <section aria-label="Task summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile index={0} icon={ListTodo} tone="cyan" label="Open" value={open} foot="To do or in progress" />
        <KpiTile index={1} icon={AlarmClock} tone="pink" label="Overdue" value={overdue} foot={overdue > 0 ? "Past their due date" : "Nothing late"} />
        <KpiTile index={2} icon={CalendarClock} tone="violet" label="Due in 7 days" value={dueSoon} foot="Open, with a due date" />
        <KpiTile index={3} icon={CheckCheck} tone="lime" label="Done · 30 days" value={done30} foot="Completed recently" />
      </section>

      <Card aria-labelledby="tasks-title" className="rise-in" style={stagger(4)}>
        <CardHeader
          id="tasks-title"
          title={VIEWS.find((v) => v.value === view)?.label + " tasks"}
          description={view === "done" ? "Most recently completed first. Dates are UTC." : "Earliest due date first. Dates are UTC."}
        />
        {tasks.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            tone="muted"
            className="mt-4 py-10"
            title={view === "overdue" ? "Nothing is overdue" : view === "done" ? "No completed tasks yet" : "No tasks here yet"}
            description="When an AI workflow proposes a CRM task and you approve it in the Approval queue, it appears here."
            action={
              <Link href="/approvals" className="text-sm font-semibold text-neon-cyan hover:underline">
                Open the Approval queue →
              </Link>
            }
          />
        ) : (
          <DataTable
            label="Tasks"
            minWidth={760}
            className="mt-3"
            head={
              <>
                <Th>Task</Th>
                <Th>Lead</Th>
                <Th>Priority</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th>Assignee</Th>
              </>
            }
          >
            {tasks.map((t) => {
              const late = !!t.dueAt && t.dueAt < now && OPEN.includes(t.status);
              const pr = PRIORITY[t.priority];
              const st = STATUS[t.status];
              return (
                <Tr key={t.id}>
                  <Td className="max-w-[320px]">
                    <span className="block truncate font-medium">{t.title}</span>
                    {t.detail && <span className="block truncate text-[11px] text-ink-muted">{t.detail}</span>}
                  </Td>
                  <Td>
                    {t.lead ? (
                      <Link href={`/leads/${t.lead.id}`} className="font-medium text-neon-cyan hover:underline">
                        {leadDisplayName({ fullName: t.lead.fullName, company: t.lead.company })}
                      </Link>
                    ) : (
                      <span className="text-ink-dim">—</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={pr.tone}>{pr.label}</Badge>
                  </Td>
                  <Td nowrap className={late ? "font-semibold text-red-300" : "text-ink-muted"}>
                    {t.dueAt ? formatUtcDate(t.dueAt) : "No date"}
                    {late && " · overdue"}
                  </Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                  <Td className="text-ink-muted">{t.assignedTo?.name ?? t.assignedTo?.email ?? "Unassigned"}</Td>
                </Tr>
              );
            })}
          </DataTable>
        )}
        {tasks.length === 100 && <p className="mt-3 text-xs text-ink-muted">Showing the first 100 tasks.</p>}
      </Card>
    </div>
  );
}
