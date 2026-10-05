/**
 * Prospecting run notifications — "47 new verified leads added".
 *
 * Created when a daily/manual run finishes (COMPLETED, PARTIAL, or FAILED).
 * Org-level rows in the existing Notification model; the AppShell bell +
 * banner surface unread ones. Best-effort: a notification failure must
 * never fail the run itself.
 */
import { db } from "../db";

export interface RunNotificationInput {
  runId: string;
  runDate: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  triggeredBy: string;
  targetCount: number;
  candidates: number;
  verified: number;
  imported: number;
  duplicates: number;
  rejected: number;
  failed: number;
  error?: string | null;
  sourceBreakdown?: Record<string, number>;
}

export async function notifyRunCompleted(
  organizationId: string,
  input: RunNotificationInput,
): Promise<void> {
  const mode = input.triggeredBy === "MANUAL" ? "manual" : "scheduled";
  const title =
    input.status === "FAILED"
      ? "Prospecting run failed"
      : input.imported > 0
        ? `${input.imported} new verified lead${input.imported === 1 ? "" : "s"} added`
        : "Prospecting run completed — no new leads";

  const lines = [
    `Daily prospecting ${input.status === "COMPLETED" ? "completed" : input.status.toLowerCase()} (${mode} run, ${input.runDate}).`,
    `Target: ${input.targetCount} · Candidates researched: ${input.candidates} · Verified: ${input.verified} · Imported: ${input.imported} · Duplicates: ${input.duplicates} · Rejected: ${input.rejected}` +
      (input.failed ? ` · Failed: ${input.failed}` : ""),
  ];
  const breakdown = Object.entries(input.sourceBreakdown ?? {}).filter(([, n]) => n > 0);
  if (breakdown.length > 0) {
    lines.push(
      `Sources: ${breakdown.map(([k, n]) => `${k.replace(/_/g, " ").toLowerCase()} ${n}`).join(" · ")}`,
    );
  }
  if (input.status === "FAILED" && input.error) {
    lines.push(`Reason: ${input.error}`);
  }

  await db.notification.create({
    data: {
      organizationId,
      type: "prospecting_run_completed",
      title,
      body: lines.join("\n"),
      link: "/prospecting",
      metadata: {
        runId: input.runId,
        status: input.status,
        triggeredBy: input.triggeredBy,
        targetCount: input.targetCount,
        candidates: input.candidates,
        verified: input.verified,
        imported: input.imported,
      },
    },
  });
}
