/**
 * Dashboard data — database integration tests.
 * REQUIRE a real PostgreSQL database. Skipped when DATABASE_URL is not set.
 *
 * Covers: period windows (boundaries), per-day aggregation, tenant isolation,
 * and the invariant that every dashboard drill-down count equals the total of
 * the lead list it links to.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../lib/db";
import { getDashboardData } from "../lib/dashboard-data";
import { listLeads } from "../lib/leads";
import { listLeadsQuerySchema } from "../lib/validators";

const hasDb = !!process.env.DATABASE_URL;
const DAY = 86_400_000;

describe.skipIf(!hasDb)("dashboard data — database integration", () => {
  let orgA: string;
  let orgB: string;
  const actorId = "dashboard-db-test-user";
  // Fixed clock for the window maths: "now" is mid-day on 16 Oct 2026 (UTC).
  const now = new Date("2026-10-16T12:00:00Z");
  const range = { key: "7d" as const, days: 7, label: "Last 7 days" };

  beforeAll(async () => {
    await db.user.upsert({
      where: { email: "dashboard-db-test@example.com" },
      create: { id: actorId, email: "dashboard-db-test@example.com", name: "Dashboard Tester" },
      update: {},
    });
    orgA = (await db.organization.create({ data: { name: "Dash Org A", slug: `dash-a-${Date.now()}` } })).id;
    orgB = (await db.organization.create({ data: { name: "Dash Org B", slug: `dash-b-${Date.now()}` } })).id;

    const lead = (
      organizationId: string,
      createdAt: string,
      status: "NEW" | "QUALIFIED" | "MEETING" | "CONTACTED" | "FOLLOW_UP",
      leadScore: number,
      extra: { contactable?: boolean; websiteStatus?: string; lastContactedAt?: Date } = {},
    ) =>
      db.lead.create({
        data: { organizationId, status, leadScore, createdAt: new Date(createdAt), updatedAt: new Date(createdAt), ...extra },
      });

    // Org A — current window is 10–16 Oct (UTC days), previous window is 3–9 Oct.
    await lead(orgA, "2026-10-16T01:00:00Z", "NEW", 85, { contactable: true, websiteStatus: "NO_WEBSITE" });
    await lead(orgA, "2026-10-15T10:00:00Z", "QUALIFIED", 70, { contactable: true });
    await lead(orgA, "2026-10-10T00:00:00Z", "MEETING", 90); // first instant of the current window
    await lead(orgA, "2026-10-09T23:59:59Z", "CONTACTED", 60, { lastContactedAt: new Date(Date.now() - 10 * DAY) });
    await lead(orgA, "2026-10-03T00:00:00Z", "NEW", 40, { websiteStatus: "NO_WEBSITE" }); // first instant of the previous window
    await lead(orgA, "2026-10-02T23:59:59Z", "NEW", 99); // outside both windows, but still a hot lead
    await lead(orgA, "2026-09-01T00:00:00Z", "FOLLOW_UP", 30); // old, but a follow-up is due

    // Org B — must never show up in org A's numbers.
    await lead(orgB, "2026-10-16T02:00:00Z", "NEW", 95, { contactable: true, websiteStatus: "NO_WEBSITE" });
    await lead(orgB, "2026-10-15T02:00:00Z", "NEW", 95, { contactable: true });

    const approval = (organizationId: string, createdAt: Date, status: "PENDING" | "APPROVED") =>
      db.agentApproval.create({
        data: {
          organizationId,
          workflowId: "wf",
          workflowRunId: `run-${organizationId}-${status}-${createdAt.getTime()}`,
          stageId: "approve",
          status,
          actionType: "OUTREACH_DRAFT",
          proposedInput: {},
          target: { label: "Fictional Co" },
          reason: "test",
          requestedByUserId: actorId,
          createdAt,
        },
      });
    await approval(orgA, new Date(Date.now() - 3 * DAY), "PENDING");
    await approval(orgA, new Date(Date.now() - 1 * DAY), "APPROVED");
    // Past its expiry but still PENDING in the table (expiry is applied lazily): must not count as awaiting.
    await db.agentApproval.create({
      data: {
        organizationId: orgA,
        workflowId: "wf",
        workflowRunId: "run-expired",
        stageId: "approve",
        status: "PENDING",
        actionType: "OUTREACH_DRAFT",
        proposedInput: {},
        target: { label: "Expired Co" },
        reason: "test",
        requestedByUserId: actorId,
        createdAt: new Date(Date.now() - 6 * DAY),
        expiresAt: new Date(Date.now() - 3 * DAY),
      },
    });
    await approval(orgB, new Date(Date.now() - 5 * DAY), "PENDING");
    await approval(orgB, new Date(Date.now() - 6 * DAY), "PENDING");
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.delete({ where: { id: actorId } });
    await db.$disconnect();
  });

  it("counts each window with whole UTC days, boundaries included", async () => {
    const d = await getDashboardData(orgA, range, now);
    expect(d.totalLeads).toBe(7);
    expect(d.period.newLeads).toBe(3); // 16 Oct, 15 Oct, 10 Oct 00:00:00
    expect(d.period.newLeadsPrev).toBe(2); // 9 Oct 23:59:59, 3 Oct 00:00:00
    expect(d.period.qualified).toBe(2); // QUALIFIED + MEETING
    expect(d.period.qualifiedPrev).toBe(1); // CONTACTED
    expect(d.period.avgScore).toBe(81.7);
    expect(d.period.avgScorePrev).toBe(50);
  });

  it("charts exactly what the KPI tiles count", async () => {
    const d = await getDashboardData(orgA, range, now);
    expect(d.points).toHaveLength(7);
    expect(d.points[0].day).toBe("2026-10-10");
    expect(d.points[6].day).toBe("2026-10-16");
    expect(d.points.reduce((n, p) => n + p.leads, 0)).toBe(d.period.newLeads);
    expect(d.points.reduce((n, p) => n + p.qualified, 0)).toBe(d.period.qualified);
    expect(d.points[6]).toMatchObject({ leads: 1, qualified: 0 });
    expect(d.addedToday).toBe(1);
  });

  it("reports a missing baseline as null, never as 0", async () => {
    const empty = (await db.organization.create({ data: { name: "Empty", slug: `dash-empty-${Date.now()}` } })).id;
    try {
      const d = await getDashboardData(empty, range, now);
      expect(d.totalLeads).toBe(0);
      expect(d.period).toMatchObject({ newLeads: 0, newLeadsPrev: 0, avgScore: null, avgScorePrev: null });
      expect(d.points.every((p) => p.leads === 0)).toBe(true);
      expect(d.pendingApprovals).toBe(0);
      expect(d.oldestPendingAt).toBeNull();
      expect(d.moves[0].href).toBe("/discover"); // brand-new workspace is guided, not shown fake work
    } finally {
      await db.organization.delete({ where: { id: empty } });
    }
  });

  it("is tenant-isolated", async () => {
    const a = await getDashboardData(orgA, range, now);
    const b = await getDashboardData(orgB, range, now);
    expect(a.totalLeads).toBe(7);
    expect(b.totalLeads).toBe(2);
    expect(a.pendingApprovals).toBe(1);
    expect(b.pendingApprovals).toBe(2);
    expect(b.period.newLeads).toBe(2);
    expect(b.hotLeads).toBe(2);
    expect(a.hotLeads).toBe(2); // 85 and 99 in org A only
  });

  it("finds the oldest pending approval", async () => {
    const a = await getDashboardData(orgA, range, now);
    const ageDays = (Date.now() - new Date(a.oldestPendingAt as string).getTime()) / DAY;
    expect(ageDays).toBeGreaterThan(2.9);
    expect(ageDays).toBeLessThan(3.1);
  });

  it("every drill-down count equals the total of the list it links to", async () => {
    const d = await getDashboardData(orgA, range); // real clock: the lists use it too
    const total = async (q: Record<string, unknown>) => (await listLeads(orgA, listLeadsQuerySchema.parse(q))).total;

    expect(d.hotLeads).toBe(await total({ minScore: 80, status: "NEW" }));
    expect(d.followUpsDue).toBe(await total({ followUp: "due" }));
    expect(d.contactable).toBe(await total({ contactable: "true" }));
    expect(d.noWebsite).toBe(await total({ websiteStatus: "NO_WEBSITE" }));
    for (const row of d.pipeline) expect(row.count).toBe(await total({ status: row.status }));
    expect(d.followUpsDue).toBe(2); // the stale CONTACTED lead + the FOLLOW_UP lead
  });
});
