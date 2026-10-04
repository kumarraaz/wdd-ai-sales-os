/**
 * Approvals inbox (Phase 7) — minimal UI.
 *
 * Server component: resolves the workspace exactly like the other (app) pages
 * and renders pending/terminal approvals. Review actions go through the
 * secure POST APIs; the UI can never modify the proposed action.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoSession } from "@/lib/demo-session";
import { ApprovalActions } from "@/components/app/ApprovalActions";

export const dynamic = "force-dynamic";

type MembershipOrgRole = Prisma.MembershipGetPayload<{
  select: { organizationId: true; role: true };
}>;

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-400/15 text-amber-300",
  APPROVED: "bg-sky-400/15 text-sky-300",
  EXECUTED: "bg-emerald-400/15 text-emerald-300",
  REJECTED: "bg-red-400/15 text-red-300",
  CANCELLED: "bg-white/10 text-white/50",
  EXPIRED: "bg-white/10 text-white/50",
  FAILED: "bg-red-400/15 text-red-300",
};

function summarizeTarget(target: unknown): string {
  if (target && typeof target === "object") {
    const t = target as { label?: string; channel?: string | null };
    return [t.label, t.channel].filter(Boolean).join(" · ") || "—";
  }
  return "—";
}

export default async function ApprovalsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");
  if (!session?.user) redirect("/dashboard");

  const jar = await cookies();
  const cookieOrg = jar.get("wdd.org_id")?.value;
  const userId = session.user.id;
  const memberships: MembershipOrgRole[] = await db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (memberships.length === 0) redirect("/login?error=no-workspace");
  const active = memberships.find((m) => m.organizationId === cookieOrg) ?? memberships[0];
  const canReview = active.role !== "VIEWER";

  const approvals = await db.agentApproval.findMany({
    where: { organizationId: active.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-white/50">
          Review AI-proposed sales actions. Approving executes exactly what was proposed — nothing more.
        </p>
      </div>

      {approvals.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/50">
          No approval requests yet. Run a sales workflow that drafts outreach to see them here.
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => (
            <div
              key={a.id}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${STATUS_STYLES[a.status] ?? "bg-white/10 text-white/50"}`}
                >
                  {a.status}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
                  {a.actionType.replaceAll("_", " ")}
                </span>
                <span className="ml-auto text-xs text-white/40">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="mt-2 text-sm font-medium">{summarizeTarget(a.target)}</div>
              <p className="mt-1 text-sm text-white/60">{a.reason}</p>
              <div className="mt-1 text-xs text-white/40">
                Workflow <span className="font-mono">{a.workflowId}</span>
                {a.expiresAt && a.status === "PENDING" && (
                  <span> · expires {new Date(a.expiresAt).toLocaleString()}</span>
                )}
              </div>
              {a.status === "PENDING" && canReview && (
                <div className="mt-3">
                  <ApprovalActions id={a.id} />
                </div>
              )}
              {a.status === "PENDING" && !canReview && (
                <p className="mt-3 text-xs text-white/40">Your role cannot review approvals.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
