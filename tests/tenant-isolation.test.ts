/**
 * Tenant isolation tests — REQUIRE a real PostgreSQL database.
 * Run with: DATABASE_URL=... npx vitest run tests/tenant-isolation.test.ts
 * Skipped automatically when DATABASE_URL is not set.
 *
 * These tests are the executable proof of the core security invariant:
 * Organization A can NEVER read or mutate Organization B's records.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// Prisma 7: never `new PrismaClient()` without a driver adapter — reuse the
// shared client from lib/db, which is configured with PrismaPg (@prisma/adapter-pg).
import { db } from "../lib/db";
import { createLead, getLead, updateLead, deleteLead, listLeads } from "../lib/leads";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("tenant isolation — leads", () => {
  let orgA: string;
  let orgB: string;
  let leadA: string;

  beforeAll(async () => {
    const a = await db.organization.create({ data: { name: "Org A", slug: `orga-${Date.now()}` } });
    const b = await db.organization.create({ data: { name: "Org B", slug: `orgb-${Date.now()}` } });
    orgA = a.id;
    orgB = b.id;
    const { lead } = await createLead(orgA, "system", {
      fullName: "Org A Secret Lead",
      email: "secret-a@example.com",
    });
    leadA = lead.id;
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  });

  it("Org B cannot list Org A's lead", async () => {
    const res = await listLeads(orgB, { page: 1, pageSize: 25 });
    expect(res.leads.find((l) => l.id === leadA)).toBeUndefined();
  });

  it("Org B cannot read Org A's lead by id", async () => {
    expect(await getLead(orgB, leadA)).toBeNull();
  });

  it("Org B cannot update Org A's lead", async () => {
    expect(
      await updateLead(orgB, "system", leadA, { fullName: "Hijacked" }),
    ).toBeNull();
    const still = await getLead(orgA, leadA);
    expect(still?.fullName).toBe("Org A Secret Lead");
  });

  it("Org B cannot delete Org A's lead", async () => {
    expect(await deleteLead(orgB, leadA)).toBe(false);
    expect(await getLead(orgA, leadA)).not.toBeNull();
  });
});
