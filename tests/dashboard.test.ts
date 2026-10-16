import { describe, expect, it } from "vitest";
import {
  PIPELINE_STAGES,
  bucketByDay,
  buildNextMoves,
  conversionRate,
  fillDays,
  parseRange,
  percentChange,
  periodWindows,
  pipelineRows,
  pointsTrend,
  relativeTime,
  trendFor,
} from "@/lib/dashboard";

describe("parseRange", () => {
  it("accepts the known ranges", () => {
    expect(parseRange("7d")).toMatchObject({ key: "7d", days: 7 });
    expect(parseRange("90d")).toMatchObject({ key: "90d", days: 90 });
  });
  it("falls back to 30 days for anything else (including injection-ish input)", () => {
    for (const bad of [undefined, "", "1y", "30", "30d; DROP TABLE", ["x"]]) {
      expect(parseRange(bad as string)).toMatchObject({ key: "30d", days: 30 });
    }
  });
  it("uses the first value when the param is repeated", () => {
    expect(parseRange(["7d", "90d"])).toMatchObject({ key: "7d" });
  });
});

describe("periodWindows", () => {
  it("uses whole UTC days: the last N days including today, then the N days before", () => {
    const now = new Date("2026-10-16T12:34:56Z");
    const { currentStart, previousStart } = periodWindows(now, 7);
    expect(currentStart.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(previousStart.toISOString()).toBe("2026-10-03T00:00:00.000Z");
  });
  it("matches the chart: the first chart day is the current window's first day", () => {
    const now = new Date("2026-03-01T00:00:01Z");
    const days = 30;
    const { currentStart } = periodWindows(now, days);
    expect(fillDays([], days, now)[0].day).toBe(currentStart.toISOString().slice(0, 10));
  });
});

describe("pointsTrend", () => {
  it("reports the change in points with one decimal", () => {
    expect(pointsTrend(64.4, 61.2)).toEqual({ label: "+3.2 pts", direction: "up" });
    expect(pointsTrend(50, 58.5)).toEqual({ label: "−8.5 pts", direction: "down" });
    expect(pointsTrend(60, 60)).toEqual({ label: "0.0 pts", direction: "flat" });
  });
  it("is null without data in both periods (never a made-up baseline)", () => {
    expect(pointsTrend(null, 60)).toBeNull();
    expect(pointsTrend(60, null)).toBeNull();
    expect(pointsTrend(null, null)).toBeNull();
  });
});

describe("fillDays", () => {
  const now = new Date("2026-10-16T09:00:00Z");
  it("zero-fills aggregated rows and ignores days outside the window", () => {
    const pts = fillDays(
      [
        { day: "2026-10-16", leads: 4, qualified: 1 },
        { day: "2026-10-14", leads: 2, qualified: 2 },
        { day: "2026-01-01", leads: 99, qualified: 99 },
      ],
      3,
      now,
    );
    expect(pts.map((p) => [p.day, p.leads, p.qualified])).toEqual([
      ["2026-10-14", 2, 2],
      ["2026-10-15", 0, 0],
      ["2026-10-16", 4, 1],
    ]);
  });
});

describe("trendFor / percentChange", () => {
  it("computes growth and decline", () => {
    expect(trendFor(118, 100)).toEqual({ label: "+18.0%", direction: "up" });
    expect(trendFor(50, 100)).toEqual({ label: "−50.0%", direction: "down" });
  });
  it("drops decimals for triple-digit changes", () => {
    expect(trendFor(312, 100)?.label).toBe("+212%");
  });
  it("never invents a percentage without a baseline", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(trendFor(5, 0)).toEqual({ label: "New", direction: "up" });
    expect(trendFor(0, 0)).toBeNull();
  });
  it("reports a flat trend", () => {
    expect(trendFor(100, 100)).toEqual({ label: "0.0%", direction: "flat" });
  });
  it("shows a drop to zero as a decline", () => {
    expect(trendFor(0, 40)).toEqual({ label: "−100%", direction: "down" });
  });
});

describe("conversionRate", () => {
  it("is a one-decimal percentage", () => {
    expect(conversionRate(2846, 684)).toBe(24);
    expect(conversionRate(1000, 174)).toBe(17.4);
  });
  it("is null with no leads", () => {
    expect(conversionRate(0, 0)).toBeNull();
  });
});

describe("bucketByDay", () => {
  const now = new Date("2026-10-16T09:00:00Z");
  it("returns one point per day, oldest first, zero-filled", () => {
    const pts = bucketByDay([], 7, now);
    expect(pts).toHaveLength(7);
    expect(pts[0].day).toBe("2026-10-10");
    expect(pts[6].day).toBe("2026-10-16");
    expect(pts.every((p) => p.leads === 0 && p.qualified === 0)).toBe(true);
  });
  it("counts leads and the qualified-or-later subset per day", () => {
    const pts = bucketByDay(
      [
        { createdAt: new Date("2026-10-16T01:00:00Z"), status: "NEW" },
        { createdAt: new Date("2026-10-16T05:00:00Z"), status: "QUALIFIED" },
        { createdAt: new Date("2026-10-16T08:00:00Z"), status: "MEETING" },
        { createdAt: new Date("2026-10-15T08:00:00Z"), status: "LOST" },
      ],
      3,
      now,
    );
    expect(pts.map((p) => [p.day, p.leads, p.qualified])).toEqual([
      ["2026-10-14", 0, 0],
      ["2026-10-15", 1, 0],
      ["2026-10-16", 3, 2],
    ]);
  });
  it("labels days like the Figma axis", () => {
    expect(bucketByDay([], 1, now)[0].label).toBe("OCT 16");
  });
  it("ignores rows outside the window", () => {
    const pts = bucketByDay([{ createdAt: new Date("2026-01-01T00:00:00Z"), status: "NEW" }], 3, now);
    expect(pts.reduce((n, p) => n + p.leads, 0)).toBe(0);
  });
});

describe("pipelineRows", () => {
  it("returns every stage, zero-filled, with bars relative to the largest", () => {
    const rows = pipelineRows([
      { status: "NEW", count: 40 },
      { status: "QUALIFIED", count: 10 },
      { status: "SOMETHING_ELSE", count: 999 },
    ]);
    expect(rows).toHaveLength(PIPELINE_STAGES.length);
    expect(rows[0]).toMatchObject({ status: "NEW", count: 40, pct: 100 });
    expect(rows[1]).toMatchObject({ status: "QUALIFIED", count: 10, pct: 25 });
    expect(rows.find((r) => r.status === "WON")).toMatchObject({ count: 0, pct: 0 });
  });
  it("does not divide by zero on an empty pipeline", () => {
    expect(pipelineRows([]).every((r) => r.count === 0 && r.pct === 0)).toBe(true);
  });
});

describe("buildNextMoves", () => {
  it("surfaces only rules with something to do, capped at three", () => {
    const moves = buildNextMoves({ totalLeads: 100, hotLeads: 12, pendingApprovals: 4, followUpsDue: 7 });
    expect(moves.map((m) => m.id)).toEqual(["hot-leads", "approvals", "follow-ups"]);
    expect(moves[0].title).toBe("Review 12 hot leads");
    expect(moves[1].title).toBe("Approve 4 messages");
    expect(moves[2].title).toBe("Follow up with 7 prospects");
  });
  it("uses singular nouns for 1", () => {
    const moves = buildNextMoves({ totalLeads: 5, hotLeads: 1, pendingApprovals: 1, followUpsDue: 1 });
    expect(moves.map((m) => m.title)).toEqual(["Review 1 hot lead", "Approve 1 message", "Follow up with 1 prospect"]);
  });
  it("skips zero-count rules", () => {
    const moves = buildNextMoves({ totalLeads: 10, hotLeads: 0, pendingApprovals: 2, followUpsDue: 0 });
    expect(moves.map((m) => m.id)).toEqual(["approvals"]);
  });
  it("guides a brand-new workspace instead of showing fake work", () => {
    const moves = buildNextMoves({ totalLeads: 0, hotLeads: 0, pendingApprovals: 0, followUpsDue: 0 });
    expect(moves[0].href).toBe("/discover");
    expect(moves).toHaveLength(3);
  });
  it("falls back to pipeline-growth actions when nothing is pending", () => {
    const moves = buildNextMoves({ totalLeads: 50, hotLeads: 0, pendingApprovals: 0, followUpsDue: 0 });
    expect(moves.map((m) => m.href)).toEqual(["/discover", "/prospecting"]);
  });
  it("only links to routes that exist in the app", () => {
    const all = [
      ...buildNextMoves({ totalLeads: 9, hotLeads: 1, pendingApprovals: 1, followUpsDue: 1 }),
      ...buildNextMoves({ totalLeads: 0, hotLeads: 0, pendingApprovals: 0, followUpsDue: 0 }),
      ...buildNextMoves({ totalLeads: 9, hotLeads: 0, pendingApprovals: 0, followUpsDue: 0 }),
    ];
    for (const m of all) expect(m.href.startsWith("/app/")).toBe(false);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  it("is compact: now / minutes / hours / days", () => {
    expect(relativeTime(at(20_000), now)).toBe("now");
    expect(relativeTime(at(14 * 60_000), now)).toBe("14m");
    expect(relativeTime(at(3 * 3_600_000), now)).toBe("3h");
    expect(relativeTime(at(49 * 3_600_000), now)).toBe("2d");
  });
  it("never goes negative for clock skew", () => {
    expect(relativeTime(at(-5 * 60_000), now)).toBe("now");
  });
});
