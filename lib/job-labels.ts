import type { Tone } from "@/components/ui/tone";

/** Plain-language names for the job types the engine registers (lib/automation/types.ts). */
const JOB_LABELS: Record<string, string> = {
  "discovery.pipeline": "Discovery run",
  "research.website": "Website research",
  "research.lead": "Lead research",
  "lead.scoring": "Lead scoring",
  "followup.create": "Create follow-up",
  "message.generate": "Draft a message",
  "prospecting.instagram.daily": "Daily Instagram prospecting",
};

export function jobLabel(name: string): string {
  return JOB_LABELS[name] ?? name;
}

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "Queued", tone: "blue" },
  RUNNING: { label: "Running", tone: "cyan" },
  RETRYING: { label: "Retrying", tone: "amber" },
  COMPLETED: { label: "Completed", tone: "lime" },
  FAILED: { label: "Failed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export function jobStatus(status: string): { label: string; tone: Tone } {
  return JOB_STATUS[status] ?? { label: status.toLowerCase(), tone: "muted" };
}
