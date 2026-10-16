import type { Tone } from "@/components/ui/tone";

/** How a discovery source's availability (see lib/discovery/sources.ts) is shown in the UI. */
export const SOURCE_STATUS: Record<string, { label: string; tone: Tone }> = {
  CONNECTED: { label: "Connected", tone: "lime" },
  NOT_CONFIGURED: { label: "Not set up", tone: "muted" },
  FREE_LIMIT_REACHED: { label: "Limit reached", tone: "red" },
  LIMITED: { label: "Limited", tone: "amber" },
  ERROR: { label: "Error", tone: "red" },
};

export function sourceStatus(availability: string): { label: string; tone: Tone } {
  return SOURCE_STATUS[availability] ?? { label: availability.replace(/_/g, " ").toLowerCase(), tone: "muted" };
}

/** Discovery-run status (DiscoveryHistory.status) → badge. */
export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  COMPLETE: { label: "Complete", tone: "lime" },
  PARTIAL: { label: "Partial", tone: "amber" },
  LIMIT_REACHED: { label: "Limit reached", tone: "amber" },
  FAILED: { label: "Failed", tone: "red" },
};

export function runStatus(status: string): { label: string; tone: Tone } {
  return RUN_STATUS[status] ?? { label: status.replace(/_/g, " ").toLowerCase(), tone: "muted" };
}
