import type { Metadata } from "next";
import { Download } from "lucide-react";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, Td, Th, Tr } from "@/components/ui/DataTable";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { PageHeader } from "@/components/ui/PageHeader";
import type { Tone } from "@/components/ui/tone";
import { stagger } from "@/lib/cn";
import { db } from "@/lib/db";
import { formatUtcDate } from "@/lib/format-date";
import { getPageContext } from "@/lib/page-context";
import { roleAtLeast } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

const ROLE_RANK = { OWNER: 0, ADMIN: 1, SALES_MANAGER: 2, SALES_EXECUTIVE: 3, VIEWER: 4 } as const;
const ROLE_TONE: Record<string, Tone> = { OWNER: "violet", ADMIN: "cyan", SALES_MANAGER: "blue", SALES_EXECUTIVE: "lime", VIEWER: "muted" };
const roleLabel = (r: string) => r.replace(/_/g, " ").toLowerCase();

// Mirrors the minimum role each API route enforces (see app/api/**/route.ts).
const ROLE_CAPABILITIES = [
  { role: "VIEWER", can: "View leads, the pipeline, approvals and reports. Cannot change anything." },
  { role: "SALES_EXECUTIVE", can: "Add and edit leads, run discovery and research, review approvals, view the job queue." },
  { role: "SALES_MANAGER", can: "Everything above, plus delete leads, cancel jobs and manage the prospecting plan." },
  { role: "ADMIN", can: "Everything above, plus the audit trail and automation status." },
  { role: "OWNER", can: "Full access to the workspace." },
] as const;

/**
 * Read-only workspace settings. The product has no endpoints for renaming a workspace or
 * managing members yet, so this page shows the facts and offers no controls that would do nothing.
 */
export default async function SettingsPage() {
  const ctx = await getPageContext();
  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Workspace settings" badge={<DemoBadge />} />
        <DemoUnavailable what="Workspace settings" />
      </div>
    );
  }

  const orgId = ctx.organizationId;
  const seeEmails = roleAtLeast(ctx.role, "ADMIN");
  const [org, members] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { name: true, slug: true, createdAt: true } }),
    db.membership.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, createdAt: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  const sorted = [...members].sort(
    (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.createdAt.getTime() - b.createdAt.getTime(),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Workspace settings" description="Who is in this workspace and what each role can do." />

      <InlineAlert tone="cyan" title="Settings are read-only for now">
        Renaming the workspace and inviting or removing members aren&apos;t available in the app yet, so no controls for them are
        shown here.
      </InlineAlert>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Card aria-labelledby="ws-title" className="rise-in" style={stagger(1)}>
          <CardHeader id="ws-title" title="Workspace" />
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Name</dt>
              <dd className="min-w-0 truncate text-ink">{org?.name ?? ctx.organizationName}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Identifier</dt>
              <dd className="font-mono text-xs text-ink">{org?.slug ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Created</dt>
              <dd className="text-ink">{org ? formatUtcDate(org.createdAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Members</dt>
              <dd className="tnum text-ink">{members.length}</dd>
            </div>
          </dl>
        </Card>

        <Card aria-labelledby="you-title" className="rise-in" style={stagger(2)}>
          <CardHeader id="you-title" title="You" />
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Name</dt>
              <dd className="min-w-0 truncate text-ink">{ctx.user.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Email</dt>
              <dd className="min-w-0 truncate text-ink">{ctx.user.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-muted">Role here</dt>
              <dd>
                <Badge tone={ROLE_TONE[ctx.role] ?? "muted"}>{roleLabel(ctx.role)}</Badge>
              </dd>
            </div>
          </dl>
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink">Your data</p>
            <p className="mt-1 text-xs text-ink-muted">Download every lead in this workspace as a CSV file.</p>
            <a
              href={`/api/leads/export?format=csv&orgId=${encodeURIComponent(orgId)}`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
            >
              <Download size={16} aria-hidden="true" /> Export leads (CSV)
            </a>
          </div>
        </Card>
      </div>

      <Card aria-labelledby="members-title" className="rise-in" style={stagger(3)}>
        <CardHeader
          id="members-title"
          title="Members"
          description={seeEmails ? "Everyone with access to this workspace" : "Email addresses are visible to admins and owners"}
        />
        <DataTable
          label="Members"
          minWidth={560}
          className="mt-3"
          head={
            <>
              <Th>Name</Th>
              {seeEmails && <Th>Email</Th>}
              <Th>Role</Th>
              <Th>Joined</Th>
            </>
          }
        >
          {sorted.map((m) => (
            <Tr key={m.id}>
              <Td className="font-medium">{m.user.name ?? "—"}</Td>
              {seeEmails && <Td className="text-ink-muted">{m.user.email}</Td>}
              <Td>
                <Badge tone={ROLE_TONE[m.role] ?? "muted"}>{roleLabel(m.role)}</Badge>
              </Td>
              <Td nowrap className="text-ink-muted">
                {formatUtcDate(m.createdAt)}
              </Td>
            </Tr>
          ))}
        </DataTable>
      </Card>

      <Card aria-labelledby="roles-title" className="rise-in" style={stagger(4)}>
        <CardHeader id="roles-title" title="What each role can do" />
        <ul className="mt-4 divide-y divide-line">
          {ROLE_CAPABILITIES.map((r) => (
            <li key={r.role} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
              <span className="w-40 shrink-0">
                <Badge tone={ROLE_TONE[r.role]}>{roleLabel(r.role)}</Badge>
              </span>
              <span className="text-sm text-ink-muted">{r.can}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
