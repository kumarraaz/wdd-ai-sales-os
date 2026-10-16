/**
 * Workspace activity feed (dashboard "Live activity" + GET /api/activity).
 * Merges three real, organization-scoped sources and nothing else:
 *   - LeadActivity      — events recorded against leads
 *   - DiscoveryHistory  — finished discovery runs
 *   - AgentApproval     — approval decisions made by a person
 */
import { db } from "./db";

export interface ActivityItem {
  id: string;
  /** 2-letter marker for the avatar tile, e.g. "DS", "AI", "OK". */
  initials: string;
  title: string;
  detail: string | null;
  /** ISO timestamp */
  at: string;
  /** where "open" should go, when there is a destination */
  href: string | null;
}

/** Avatar marker for a LeadActivity.type (free-form string in the schema). */
export function activityInitials(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("discover") || t.includes("import")) return "DS";
  if (t.includes("research") || t.includes("scor") || t.includes("enrich") || t.includes("intelligence")) return "AI";
  if (t.includes("approv")) return "OK";
  if (t.includes("note")) return "NT";
  if (t.includes("email") || t.includes("message") || t.includes("sent")) return "MS";
  return (t.replace(/[^a-z]/g, "").slice(0, 2) || "••").toUpperCase();
}

function clamp(text: string | null | undefined, max = 90): string | null {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const APPROVAL_LABEL: Record<string, string> = {
  OUTREACH_DRAFT: "outreach draft",
  CRM_FOLLOWUP: "CRM follow-up",
  CRM_TASK: "CRM task",
};

export async function getRecentActivity(organizationId: string, limit = 6): Promise<ActivityItem[]> {
  const [leadActivity, runs, approvals] = await Promise.all([
    db.leadActivity.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        detail: true,
        createdAt: true,
        leadId: true,
        lead: { select: { fullName: true, company: { select: { name: true } } } },
      },
    }),
    db.discoveryHistory.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, label: true, status: true, imported: true, discovered: true, createdAt: true },
    }),
    db.agentApproval.findMany({
      where: {
        organizationId,
        reviewedAt: { not: null },
        status: { in: ["APPROVED", "EXECUTED", "REJECTED", "FAILED"] },
      },
      orderBy: { reviewedAt: "desc" },
      take: 3,
      select: { id: true, status: true, actionType: true, reviewedAt: true, target: true },
    }),
  ]);

  const items: ActivityItem[] = [];

  for (const a of leadActivity) {
    items.push({
      id: `la:${a.id}`,
      initials: activityInitials(a.type),
      title: clamp(a.title, 70) ?? "Lead updated",
      detail: clamp(a.detail) ?? clamp(a.lead?.company?.name ?? a.lead?.fullName),
      at: a.createdAt.toISOString(),
      href: `/leads/${a.leadId}`,
    });
  }

  for (const r of runs) {
    const failed = r.status === "FAILED";
    items.push({
      id: `dr:${r.id}`,
      initials: "DS",
      title: failed
        ? "Discovery run failed"
        : r.imported > 0
          ? `Imported ${r.imported.toLocaleString("en-IN")} new ${r.imported === 1 ? "lead" : "leads"}`
          : "Discovery run finished",
      detail: clamp(r.label),
      at: r.createdAt.toISOString(),
      href: "/discover/history",
    });
  }

  for (const ap of approvals) {
    if (!ap.reviewedAt) continue;
    const rejected = ap.status === "REJECTED";
    const target = ap.target as { label?: unknown } | null;
    items.push({
      id: `ap:${ap.id}`,
      initials: rejected ? "NO" : "OK",
      title: `${rejected ? "Rejected" : "Approved"} ${APPROVAL_LABEL[ap.actionType] ?? "action"}`,
      detail: typeof target?.label === "string" ? clamp(target.label) : null,
      at: ap.reviewedAt.toISOString(),
      href: "/approvals",
    });
  }

  return items.sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, limit);
}
