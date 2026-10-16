/**
 * Pure helpers behind the dashboard. No I/O: the page does the (organization-
 * scoped) queries and passes plain numbers/rows in, so every figure shown to a
 * user can be unit-tested. Days are bucketed in UTC (the workspace has no
 * timezone setting yet).
 */
import type { Tone } from "@/components/ui/tone";
import type { Trend } from "@/components/ui/trend";

export type { Trend };

// ── Range selection ────────────────────────────────────────────────────────

export const RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]["value"];

export const DEFAULT_RANGE: RangeKey = "30d";

/** Validates the ?range= query value; anything unknown falls back to the default. */
export function parseRange(raw: string | string[] | undefined): { key: RangeKey; days: number; label: string } {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const found = RANGE_OPTIONS.find((r) => r.value === value) ?? RANGE_OPTIONS.find((r) => r.value === DEFAULT_RANGE)!;
  return { key: found.value, days: found.days, label: found.label };
}

const DAY_MS = 86_400_000;

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Windows are whole UTC calendar days so the chart and the KPI tiles always agree:
 * current  = the last `days` days including today (today is partial),
 * previous = the `days` days immediately before that.
 */
export function periodWindows(now: Date, days: number): { currentStart: Date; previousStart: Date } {
  const currentStart = utcMidnight(now) - (days - 1) * DAY_MS;
  return {
    currentStart: new Date(currentStart),
    previousStart: new Date(currentStart - days * DAY_MS),
  };
}

// ── Trends ─────────────────────────────────────────────────────────────────

/** % change vs previous period. null when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function formatPercent(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : 1;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${abs.toFixed(digits)}%`;
}

/**
 * Trend chip for a metric. Nothing is invented: no data in either window → null
 * (the chip is hidden); growth from zero is shown as "New" rather than a made-up percentage.
 */
export function trendFor(current: number, previous: number): Trend | null {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return { label: "New", direction: "up" };
  const pct = percentChange(current, previous)!;
  if (Math.abs(pct) < 0.05) return { label: "0.0%", direction: "flat" };
  return { label: formatPercent(pct), direction: pct > 0 ? "up" : "down" };
}

/**
 * Change in an average, in points (e.g. lead score 61.2 → 64.4 = "+3.2 pts").
 * Null unless both periods actually have data, so a missing baseline is never shown as 0.
 */
export function pointsTrend(current: number | null, previous: number | null): Trend | null {
  if (current === null || previous === null) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { label: "0.0 pts", direction: "flat" };
  return { label: `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} pts`, direction: diff > 0 ? "up" : "down" };
}

/** Share of leads at a qualified-or-later stage, as a percentage with one decimal. */
export function conversionRate(total: number, qualified: number): number | null {
  if (total <= 0) return null;
  return Math.round((qualified / total) * 1000) / 10;
}

/** "now", "14m", "3h", "2d" — compact relative age (activity feed, oldest-approval note). */
export function relativeTime(atIso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(atIso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Definitions ────────────────────────────────────────────────────────────

/** "Qualified" = at QUALIFIED or any later active pipeline stage (matches the previous dashboard). */
export const QUALIFIED_STATUSES = ["QUALIFIED", "CONTACTED", "REPLIED", "MEETING", "PROPOSAL", "NEGOTIATION"] as const;

/** Finished or dead stages: never suggest follow-ups for these. */
export const CLOSED_STATUSES = ["WON", "LOST", "NOT_RELEVANT", "CONVERTED"] as const;

/** A "hot lead" is a NEW lead scoring at least this much (matches /leads?minScore=80&status=NEW). */
export const HOT_LEAD_SCORE = 80;
export const STALE_CONTACT_DAYS = 5;

// ── Chart data ─────────────────────────────────────────────────────────────

export interface DayPoint {
  /** YYYY-MM-DD (UTC) */
  day: string;
  /** e.g. "SEP 16" */
  label: string;
  leads: number;
  qualified: number;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`)
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

/**
 * Zero-fills per-day aggregates into one point per day for the last `days` days
 * (oldest first). Rows outside the window are ignored.
 */
export function fillDays(
  rows: ReadonlyArray<{ day: string; leads: number; qualified: number }>,
  days: number,
  now: Date,
): DayPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r] as const));
  const today = utcMidnight(now);
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(today - i * DAY_MS));
    const v = byDay.get(day);
    out.push({ day, label: dayLabel(day), leads: v?.leads ?? 0, qualified: v?.qualified ?? 0 });
  }
  return out;
}

/**
 * Same as fillDays, starting from individual lead rows (used for the demo
 * fixtures; the real dashboard aggregates per day in SQL instead of loading rows).
 */
export function bucketByDay(
  rows: ReadonlyArray<{ createdAt: Date; status: string }>,
  days: number,
  now: Date,
): DayPoint[] {
  const qualifiedSet = new Set<string>(QUALIFIED_STATUSES);
  const byDay = new Map<string, { day: string; leads: number; qualified: number }>();
  for (const r of rows) {
    const key = utcDay(r.createdAt);
    const cur = byDay.get(key) ?? { day: key, leads: 0, qualified: 0 };
    cur.leads += 1;
    if (qualifiedSet.has(r.status)) cur.qualified += 1;
    byDay.set(key, cur);
  }
  return fillDays([...byDay.values()], days, now);
}

// ── Pipeline health ────────────────────────────────────────────────────────

export const PIPELINE_STAGES: ReadonlyArray<{ status: string; label: string; tone: Tone }> = [
  { status: "NEW", label: "New", tone: "cyan" },
  { status: "QUALIFIED", label: "Qualified", tone: "violet" },
  { status: "CONTACTED", label: "Contacted", tone: "blue" },
  { status: "REPLIED", label: "Replied", tone: "amber" },
  { status: "MEETING", label: "Meeting", tone: "pink" },
  { status: "PROPOSAL", label: "Proposal", tone: "lime" },
  { status: "NEGOTIATION", label: "Negotiation", tone: "violet" },
  { status: "WON", label: "Won", tone: "lime" },
];

export interface PipelineRow {
  status: string;
  label: string;
  tone: Tone;
  count: number;
  /** 0-100, relative to the largest stage so bars are comparable. */
  pct: number;
}

export function pipelineRows(byStatus: ReadonlyArray<{ status: string; count: number }>): PipelineRow[] {
  const counts = new Map(byStatus.map((s) => [s.status, s.count] as const));
  const max = Math.max(1, ...PIPELINE_STAGES.map((s) => counts.get(s.status) ?? 0));
  return PIPELINE_STAGES.map((s) => {
    const count = counts.get(s.status) ?? 0;
    return { ...s, count, pct: (count / max) * 100 };
  });
}

// ── Copilot: next best moves (deterministic, from real counts) ─────────────

export interface NextMove {
  id: string;
  title: string;
  detail: string;
  href: string;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/**
 * Rule-based suggestions computed from the workspace's own data — not an LLM
 * call, and presented as such. Zero-count rules are skipped; if nothing is
 * pending the list falls back to the actions that grow the pipeline.
 */
export function buildNextMoves(input: {
  totalLeads: number;
  hotLeads: number;
  pendingApprovals: number;
  followUpsDue: number;
}): NextMove[] {
  const moves: NextMove[] = [];
  if (input.hotLeads > 0) {
    moves.push({
      id: "hot-leads",
      title: `Review ${plural(input.hotLeads, "hot lead", "hot leads")}`,
      detail: `Score ${HOT_LEAD_SCORE}+ · new, not yet worked`,
      href: `/leads?minScore=${HOT_LEAD_SCORE}&status=NEW`,
    });
  }
  if (input.pendingApprovals > 0) {
    moves.push({
      id: "approvals",
      title: `Approve ${plural(input.pendingApprovals, "message", "messages")}`,
      detail: "Drafted outreach waiting for your review",
      href: "/approvals",
    });
  }
  if (input.followUpsDue > 0) {
    moves.push({
      id: "follow-ups",
      title: `Follow up with ${plural(input.followUpsDue, "prospect", "prospects")}`,
      detail: `Due now, or no reply in ${STALE_CONTACT_DAYS}+ days`,
      href: "/leads?followUp=due",
    });
  }
  if (moves.length > 0) return moves.slice(0, 3);

  if (input.totalLeads === 0) {
    return [
      { id: "discover", title: "Run your first discovery", detail: "Find real, contactable businesses", href: "/discover" },
      { id: "sources", title: "Check your data sources", detail: "See which providers are connected", href: "/integrations" },
      { id: "import", title: "Import leads from CSV", detail: "Bring in prospects you already have", href: "/leads" },
    ];
  }
  return [
    { id: "discover", title: "Refill the top of the funnel", detail: "Nothing is waiting on you — run a discovery", href: "/discover" },
    { id: "prospecting", title: "Review the daily prospecting plan", detail: "Automated discovery, drafts only", href: "/prospecting" },
  ];
}
