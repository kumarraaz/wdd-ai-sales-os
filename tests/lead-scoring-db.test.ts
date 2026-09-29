/**
 * Lead scoring DB integration tests — REQUIRE a real PostgreSQL database.
 * Run with: DATABASE_URL=... npx vitest run tests/lead-scoring-db.test.ts
 * Skipped automatically when DATABASE_URL is not set.
 *
 * Covers: persistence + history preservation, tenant isolation,
 * quota enforcement, audit logging, no cross-tenant access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../lib/db";
import {
  checkLeadScoringQuota,
  recordLeadScoringUsage,
} from "../lib/quotas";
import { audit } from "../lib/audit";

const hasDb = !!process.env.DATABASE_URL;

const SAMPLE_FACTORS = [
  {
    factor: "Business Fit",
    points: 18,
    maximumPoints: 25,
    direction: "positive_sales_opportunity",
    explanation: "Sample.",
    provenance: "USER_PROVIDED",
    evidence: [],
  },
];

describe.skipIf(!hasDb)("lead scoring — database integration", () => {
  let orgA: string;
  let orgB: string;
  let leadA: string;
  const actorId = "lead-scoring-test-user";

  beforeAll(async () => {
    await db.user.upsert({
      where: { email: "lead-scoring-test@example.com" },
      create: {
        id: actorId,
        email: "lead-scoring-test@example.com",
        name: "Scoring Tester",
      },
      update: {},
    });
    const a = await db.organization.create({
      data: { name: "Score Org A", slug: `score-orga-${Date.now()}` },
    });
    const b = await db.organization.create({
      data: { name: "Score Org B", slug: `score-orgb-${Date.now()}` },
    });
    orgA = a.id;
    orgB = b.id;
    const lead = await db.lead.create({
      data: { organizationId: orgA, fullName: "Score Lead" },
    });
    leadA = lead.id;
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.delete({ where: { id: actorId } });
    await db.$disconnect();
  });

  it("persists scores and preserves history (no silent overwrite)", async () => {
    const first = await db.leadScore.create({
      data: {
        organizationId: orgA,
        leadId: leadA,
        score: 62,
        scoreBand: "Moderate Fit",
        scoringVersion: "v1",
        factors: SAMPLE_FACTORS,
        evidence: [],
        provider: "deterministic",
        breakdown: {},
        model: "wdd-scoring-v1",
      },
    });
    const second = await db.leadScore.create({
      data: {
        organizationId: orgA,
        leadId: leadA,
        score: 71,
        scoreBand: "Strong Fit",
        scoringVersion: "v1",
        factors: SAMPLE_FACTORS,
        evidence: [],
        provider: "deterministic",
        breakdown: {},
        model: "wdd-scoring-v1",
      },
    });
    expect(second.id).not.toBe(first.id);

    const latest = await db.leadScore.findFirst({
      where: { organizationId: orgA, leadId: leadA },
      orderBy: { createdAt: "desc" },
    });
    expect(latest?.id).toBe(second.id);
    expect(latest?.score).toBe(71);

    const count = await db.leadScore.count({
      where: { organizationId: orgA, leadId: leadA },
    });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("tenant isolation: org B cannot read org A's scores", async () => {
    const leaked = await db.leadScore.findMany({
      where: { organizationId: orgB },
    });
    expect(leaked).toHaveLength(0);

    const crossRead = await db.leadScore.findFirst({
      where: { organizationId: orgB, leadId: leadA },
    });
    expect(crossRead).toBeNull();
  });

  it("enforces the daily lead scoring quota", async () => {
    // FREE fallback: 100/day. Exhaust, then the next check is denied.
    for (let i = 0; i < 100; i++) {
      await recordLeadScoringUsage(orgB);
    }
    const denied = await checkLeadScoringQuota(orgB);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain("lead scoring limit");
  });

  it("writes an audit entry for scoring", async () => {
    await audit({
      organizationId: orgA,
      actorId,
      action: "intelligence.lead_score",
      resource: "LeadScore",
      resourceId: "test-score",
      metadata: { leadId: leadA, score: 62, scoreBand: "Moderate Fit" },
    });
    const entry = await db.auditLog.findFirst({
      where: { organizationId: orgA, action: "intelligence.lead_score" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.result).toBe("SUCCESS");
    expect(JSON.stringify(entry?.metadata ?? {})).not.toContain("GEMINI");
  });
});
