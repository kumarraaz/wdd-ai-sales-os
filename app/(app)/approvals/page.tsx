/**
 * Approval queue — the human gate for AI-proposed actions.
 *
 * Server component. Each request shows the exact stored snapshot (recipient, channel and
 * content) a reviewer would be approving; review actions go through the secure POST APIs
 * (role-checked, rate-limited, audited) and can never alter the proposal.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ApprovalActions } from "@/components/app/ApprovalActions";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedLinks } from "@/components/ui/SegmentedLinks";
import type { Tone } from "@/components/ui/tone";
import { stagger } from "@/lib/cn";
import { pendingApprovalWhere } from "@/lib/approvals-query";
import { previewApproval } from "@/lib/approval-preview";
import { relativeTime } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { getPageContext } from "@/lib/page-context";
import { roleAtLeast } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Approval queue" };

const VIEWS = [
  { value: "pending", label: "Pending" },
  { value: "decided", label: "Decided" },
  { value: "all", label: "All" },
] as const;

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Awaiting review", tone: "amber" },
  APPROVED: { label: "Approved", tone: "blue" },
  EXECUTED: { label: "Approved · done", tone: "lime" },
  REJECTED: { label: "Rejected", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
  EXPIRED: { label: "Expired", tone: "muted" },
  FAILED: { label: "Approved · failed", tone: "red" },
};

const LIMIT = 50;

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getPageContext();
  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Approval queue" badge={<DemoBadge />} />
        <DemoUnavailable what="Approvals">
          Approvals gate real actions in a real workspace. Demo mode never creates or approves anything.
        </DemoUnavailable>
      </div>
    );
  }

  const rawView = (await searchParams).view;
  const view = VIEWS.find((v) => v.value === (Array.isArray(rawView) ? rawView[0] : rawView))?.value ?? "pending";
  const canReview = roleAtLeast(ctx.role, "SALES_EXECUTIVE");
  const now = new Date();
  const orgId = ctx.organizationId;

  const [pendingCount, rows] = await Promise.all([
    db.agentApproval.count({ where: pendingApprovalWhere(orgId, now) }),
    db.agentApproval.findMany({
      where:
        view === "pending"
          ? pendingApprovalWhere(orgId, now)
          : view === "decided"
            ? { organizationId: orgId, NOT: pendingApprovalWhere(orgId, now) }
            : { organizationId: orgId },
      // The oldest request waits longest, so it comes first; history is newest first.
      orderBy: view === "pending" ? { createdAt: "asc" } : { createdAt: "desc" },
      take: LIMIT,
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approval queue"
        description="Review actions proposed by the AI workflows. Approving runs exactly what you see below — it can't be edited, and nothing is sent to a prospect automatically."
        badge={pendingCount > 0 ? <Badge tone="amber" dot>{pendingCount} awaiting</Badge> : undefined}
        actions={
          <SegmentedLinks
            label="Show"
            options={VIEWS.map((v) => ({
              value: v.value,
              label: v.value === "pending" && pendingCount > 0 ? `Pending (${pendingCount})` : v.label,
            }))}
            current={view}
            hrefFor={(v) => (v === "pending" ? "/approvals" : `/approvals?view=${v}`)}
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          tone={view === "pending" ? "lime" : "muted"}
          title={view === "pending" ? "Nothing is waiting for your review" : "No approvals here yet"}
          description={
            view === "pending"
              ? "When a workflow drafts outreach or a follow-up, it pauses here until you approve or reject it."
              : "Decided requests appear here with what was run and who decided."
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((a, i) => {
            const expired = a.status === "PENDING" && !!a.expiresAt && a.expiresAt.getTime() <= now.getTime();
            const status = STATUS[expired ? "EXPIRED" : a.status] ?? { label: a.status, tone: "muted" as Tone };
            const preview = previewApproval(a.actionType, a.proposedInput, a.target);
            const result = a.executionResult as { ok?: boolean; errorCode?: string | null; errorMessage?: string | null } | null;
            const awaiting = a.status === "PENDING" && !expired;
            return (
              <li key={a.id} className="rise-in" style={stagger(Math.min(i, 8))}>
                <Card as="article" tone={awaiting ? "amber" : undefined} aria-label={`${preview.heading}: ${preview.recipient ?? "no recipient"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <Badge>{preview.heading}</Badge>
                    {preview.channel && <Badge tone="cyan">{preview.channel}</Badge>}
                    <time dateTime={a.createdAt.toISOString()} className="ml-auto text-xs text-ink-muted">
                      Requested {relativeTime(a.createdAt.toISOString(), now.getTime())} ago
                      {awaiting && a.expiresAt && ` · expires in ${expiresIn(a.expiresAt, now)}`}
                    </time>
                  </div>

                  <h2 className="mt-3 text-[17px] font-semibold leading-snug text-ink">
                    {preview.recipient ?? "Untitled request"}
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">{a.reason}</p>

                  {preview.fields.length > 0 && (
                    <dl className="mt-4 space-y-3 rounded-control border border-line bg-surface-2/60 p-4">
                      {preview.fields.map((f) => (
                        <div key={f.label}>
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-dim">{f.label}</dt>
                          <dd
                            className={
                              f.long
                                ? "mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-ink"
                                : "mt-1 break-words text-sm text-ink"
                            }
                          >
                            {f.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                    <span>{preview.effect}</span>
                    {preview.leadHref && (
                      <Link href={preview.leadHref} className="font-semibold text-neon-cyan hover:underline">
                        Open lead →
                      </Link>
                    )}
                    {preview.hasHiddenFields && <span>Includes technical fields not shown here.</span>}
                  </div>

                  {(a.status === "EXECUTED" || a.status === "FAILED") && (
                    <p
                      className={`mt-3 text-xs ${a.status === "FAILED" ? "text-red-300" : "text-neon-lime"}`}
                      role={a.status === "FAILED" ? "alert" : undefined}
                    >
                      {a.status === "FAILED"
                        ? `Approved, but running it failed${result?.errorCode ? ` (${result.errorCode})` : ""}. Nothing was created.`
                        : "Approved and run exactly as shown."}
                    </p>
                  )}

                  {awaiting && canReview && (
                    <div className="mt-4 border-t border-line pt-4">
                      <ApprovalActions id={a.id} noun={preview.noun} effect={preview.effect} />
                    </div>
                  )}
                  {awaiting && !canReview && (
                    <p className="mt-4 border-t border-line pt-4 text-xs text-ink-muted">
                      Your role can view this request but can&apos;t review it.
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length === LIMIT && (
        <p className="text-center text-xs text-ink-muted">Showing the {LIMIT} most relevant requests.</p>
      )}
    </div>
  );
}

function expiresIn(expiresAt: Date, now: Date): string {
  const mins = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
