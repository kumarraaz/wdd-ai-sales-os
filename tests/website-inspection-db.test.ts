/**
 * Website inspection DB integration tests — REQUIRE a real PostgreSQL database.
 * Run with: DATABASE_URL=... npx vitest run tests/website-inspection-db.test.ts
 * Skipped automatically when DATABASE_URL is not set.
 *
 * Covers: inspection persistence, tenant isolation, quota enforcement,
 * lead/company linking, and audit logging.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../lib/db";
import {
  checkWebsiteInspectionQuota,
  recordWebsiteInspectionUsage,
} from "../lib/quotas";
import { audit } from "../lib/audit";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("website inspection — database integration", () => {
  let orgA: string;
  let orgB: string;
  const actorId = "website-inspection-test-user";

  beforeAll(async () => {
    await db.user.upsert({
      where: { email: "website-inspection-test@example.com" },
      create: {
        id: actorId,
        email: "website-inspection-test@example.com",
        name: "Inspection Tester",
      },
      update: {},
    });
    const a = await db.organization.create({
      data: { name: "Inspect Org A", slug: `inspect-orga-${Date.now()}` },
    });
    const b = await db.organization.create({
      data: { name: "Inspect Org B", slug: `inspect-orgb-${Date.now()}` },
    });
    orgA = a.id;
    orgB = b.id;
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.delete({ where: { id: actorId } });
    await db.$disconnect();
  });

  it("persists an inspection linked to a lead and company", async () => {
    const company = await db.company.create({
      data: { organizationId: orgA, name: "Inspect Co", website: "https://inspect-co.example.com" },
    });
    const lead = await db.lead.create({
      data: {
        organizationId: orgA,
        companyId: company.id,
        fullName: "Inspect Lead",
        website: "https://inspect-co.example.com",
      },
    });

    const inspection = await db.websiteInspection.create({
      data: {
        organizationId: orgA,
        leadId: lead.id,
        companyId: company.id,
        requestedUrl: "https://inspect-co.example.com",
        finalUrl: "https://inspect-co.example.com/",
        httpStatus: 200,
        status: "COMPLETED",
        findings: { title: "Inspect Co", provenance: "VERIFIED_DATA" },
        dataLabel: "VERIFIED",
      },
    });

    const found = await db.websiteInspection.findFirst({
      where: { id: inspection.id, organizationId: orgA },
      include: { lead: true, company: true },
    });
    expect(found?.leadId).toBe(lead.id);
    expect(found?.companyId).toBe(company.id);
    expect(found?.dataLabel).toBe("VERIFIED");
    expect((found?.findings as { title: string }).title).toBe("Inspect Co");
  });

  it("tenant isolation: org B cannot see org A's inspections", async () => {
    await db.websiteInspection.create({
      data: {
        organizationId: orgA,
        requestedUrl: "https://secret.example.com",
        status: "COMPLETED",
        findings: {},
      },
    });

    const leaked = await db.websiteInspection.findMany({
      where: { organizationId: orgB },
    });
    expect(leaked).toHaveLength(0);

    const crossRead = await db.websiteInspection.findFirst({
      where: { organizationId: orgB, requestedUrl: "https://secret.example.com" },
    });
    expect(crossRead).toBeNull();
  });

  it("enforces the daily website inspection quota", async () => {
    // FREE fallback: 25/day. Exhaust, then the next check is denied.
    for (let i = 0; i < 25; i++) {
      await recordWebsiteInspectionUsage(orgB);
    }
    const denied = await checkWebsiteInspectionQuota(orgB);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain("inspection limit");
    expect(denied.used).toBeGreaterThanOrEqual(25);
  });

  it("writes an audit log entry for website inspections", async () => {
    await audit({
      organizationId: orgA,
      actorId,
      action: "intelligence.website_inspect",
      resource: "WebsiteInspection",
      resourceId: "test-inspection",
      metadata: { url: "https://example.com", httpStatus: 200 },
    });
    const entry = await db.auditLog.findFirst({
      where: { organizationId: orgA, action: "intelligence.website_inspect" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.result).toBe("SUCCESS");
  });
});
