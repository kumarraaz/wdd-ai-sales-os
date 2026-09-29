/**
 * AI lead-intelligence DB integration tests — REQUIRE a real PostgreSQL database.
 * Run with: DATABASE_URL=... npx vitest run tests/ai-intelligence-db.test.ts
 * Skipped automatically when DATABASE_URL is not set.
 *
 * Covers: persistence + history preservation, tenant isolation,
 * quota enforcement, audit logging, no cross-tenant access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../lib/db";
import {
  checkAiIntelligenceQuota,
  recordAiIntelligenceUsage,
} from "../lib/quotas";
import { audit } from "../lib/audit";

const hasDb = !!process.env.DATABASE_URL;

const SAMPLE_INTELLIGENCE = {
  summary: {
    text: "Sample summary.",
    evidence: [{ sourceType: "LEAD", field: "fullName" }],
  },
  businessType: "Unknown",
  verifiedSignals: [],
  inferredOpportunities: [],
  recommendedServices: [],
  salesAngle: {
    text: "Sample angle.",
    evidence: [{ sourceType: "LEAD", field: "fullName" }],
  },
  discoveryQuestions: [],
  confidence: "LOW",
  confidenceReason: "Minimal data.",
  evidence: [{ sourceType: "LEAD", field: "fullName" }],
};

describe.skipIf(!hasDb)("ai lead-intelligence — database integration", () => {
  let orgA: string;
  let orgB: string;
  let leadA: string;
  const actorId = "ai-intelligence-test-user";

  beforeAll(async () => {
    await db.user.upsert({
      where: { email: "ai-intelligence-test@example.com" },
      create: {
        id: actorId,
        email: "ai-intelligence-test@example.com",
        name: "AI Tester",
      },
      update: {},
    });
    const a = await db.organization.create({
      data: { name: "AI Org A", slug: `ai-orga-${Date.now()}` },
    });
    const b = await db.organization.create({
      data: { name: "AI Org B", slug: `ai-orgb-${Date.now()}` },
    });
    orgA = a.id;
    orgB = b.id;
    const lead = await db.lead.create({
      data: { organizationId: orgA, fullName: "AI Lead" },
    });
    leadA = lead.id;
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.delete({ where: { id: actorId } });
    await db.$disconnect();
  });

  it("persists generations and preserves history (no silent overwrite)", async () => {
    const first = await db.leadIntelligence.create({
      data: {
        organizationId: orgA,
        leadId: leadA,
        status: "COMPLETED",
        provider: "gemini",
        model: "gemini-2.0-flash",
        intelligence: SAMPLE_INTELLIGENCE,
        confidence: "LOW",
      },
    });
    // Second generation for the same lead creates a NEW row.
    const second = await db.leadIntelligence.create({
      data: {
        organizationId: orgA,
        leadId: leadA,
        status: "COMPLETED",
        provider: "gemini",
        model: "gemini-2.0-flash",
        intelligence: SAMPLE_INTELLIGENCE,
        confidence: "MEDIUM",
      },
    });
    expect(second.id).not.toBe(first.id);

    const history = await db.leadIntelligence.findMany({
      where: { organizationId: orgA, leadId: leadA },
      orderBy: { createdAt: "desc" },
    });
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]?.id).toBe(second.id); // latest first
  });

  it("tenant isolation: org B cannot read org A's intelligence", async () => {
    const leaked = await db.leadIntelligence.findMany({
      where: { organizationId: orgB },
    });
    expect(leaked).toHaveLength(0);

    const crossRead = await db.leadIntelligence.findFirst({
      where: { organizationId: orgB, leadId: leadA },
    });
    expect(crossRead).toBeNull();
  });

  it("enforces the daily AI intelligence quota", async () => {
    // FREE fallback: 25/day. Exhaust, then the next check is denied.
    for (let i = 0; i < 25; i++) {
      await recordAiIntelligenceUsage(orgB);
    }
    const denied = await checkAiIntelligenceQuota(orgB);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain("AI intelligence limit");
  });

  it("writes audit entries for generation requests", async () => {
    await audit({
      organizationId: orgA,
      actorId,
      action: "intelligence.lead_generate",
      resource: "LeadIntelligence",
      resourceId: "test-intel",
      metadata: { leadId: leadA, model: "gemini-2.0-flash" },
    });
    const entry = await db.auditLog.findFirst({
      where: { organizationId: orgA, action: "intelligence.lead_generate" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.result).toBe("SUCCESS");
    // No prompt content or keys in the audit metadata.
    expect(JSON.stringify(entry?.metadata ?? {})).not.toContain("GEMINI");
  });
});
