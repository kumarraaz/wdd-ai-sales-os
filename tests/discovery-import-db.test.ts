/**
 * Discovery → CRM import — database integration tests.
 * REQUIRE a real PostgreSQL database. Skipped when DATABASE_URL is not set.
 *
 * Covers: single + bulk import, duplicate hierarchy, name+location possible
 * duplicates, idempotent re-import, partial failure handling, tenant
 * isolation, provenance preservation, intelligence relationship preservation,
 * initial CRM stage (NEW — never auto-qualified).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../lib/db";
import {
  importDiscoveredCompanies,
  findMatchForCompany,
} from "../lib/discovery/import";
import { GooglePlacesProvider } from "../lib/discovery/google-places";
import type { DiscoveredCompany } from "../lib/discovery/types";

const hasDb = !!process.env.DATABASE_URL;
const provider = new GooglePlacesProvider();

// Fixture sequence — every company() call gets a unique phone and website.
// Sharing one phone/website across tests would make the (correct) duplicate
// detection fire between unrelated tests.
let fixtureSeq = 0;
function company(overrides: Partial<DiscoveredCompany>): DiscoveredCompany {
  fixtureSeq += 1;
  const n = fixtureSeq;
  return {
    provider: "google-places",
    providerId: `ChIJ-test-${n}-${Math.random().toString(36).slice(2, 6)}`,
    name: "Test Company",
    category: "Manufacturing",
    city: "Ahmedabad",
    country: "India",
    phone: `+91 79 4000 ${String(1000 + n)}`,
    website: `https://test-company-${n}.example.com`,
    sourceUrl: "https://maps.google.com/test",
    discoveredAt: new Date().toISOString(),
    provenance: "VERIFIED_DATA",
    ...overrides,
  };
}

describe.skipIf(!hasDb)("discovery import — database integration", () => {
  let orgA: string;
  let orgB: string;
  const actorId = "discovery-import-test-user";

  beforeAll(async () => {
    await db.user.upsert({
      where: { email: "discovery-import-test@example.com" },
      create: { id: actorId, email: "discovery-import-test@example.com", name: "Import Tester" },
      update: {},
    });
    const a = await db.organization.create({
      data: { name: "Import Org A", slug: `import-orga-${Date.now()}` },
    });
    const b = await db.organization.create({
      data: { name: "Import Org B", slug: `import-orgb-${Date.now()}` },
    });
    orgA = a.id;
    orgB = b.id;
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.delete({ where: { id: actorId } });
    await db.$disconnect();
  });

  it("imports a single lead at the NEW stage with provenance preserved", async () => {
    const c = company({ providerId: "ChIJ-single-1", name: "Single Import Co" });
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c], {
      searchQuery: "manufacturers",
    });
    expect(summary.imported).toHaveLength(1);
    expect(summary.failed).toHaveLength(0);

    const leadId = summary.imported[0].leadId!;
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      include: { provenance: true },
    });
    expect(lead?.status).toBe("NEW");
    expect(lead?.sourceType).toBe("GOOGLE_BUSINESS");
    expect(lead?.externalId).toBe("ChIJ-single-1");
    expect(lead?.sourceUrl).toBe("https://maps.google.com/test");
    // Provenance rows exist and original values are preserved.
    expect(lead?.provenance.some((p) => p.field === "website" && p.label === "VERIFIED")).toBe(true);
    expect(lead?.website).toBe(c.website);
  });

  it("is idempotent — re-importing returns already_exists, never a second lead", async () => {
    const c = company({ providerId: "ChIJ-idempotent-1", name: "Idempotent Co" });
    const first = await importDiscoveredCompanies(orgA, actorId, provider, [c]);
    expect(first.imported).toHaveLength(1);

    const second = await importDiscoveredCompanies(orgA, actorId, provider, [c]);
    expect(second.imported).toHaveLength(0);
    expect(second.alreadyExists).toHaveLength(1);
    expect(second.alreadyExists[0].status).toBe("already_exists");

    const count = await db.lead.count({
      where: { organizationId: orgA, externalId: "ChIJ-idempotent-1" },
    });
    expect(count).toBe(1);
  });

  it("detects duplicates by canonical website across tenants' data boundary", async () => {
    const c = company({
      providerId: "ChIJ-web-1",
      name: "Website Dup Co",
      website: "https://www.website-dup.example.com/",
    });
    await importDiscoveredCompanies(orgA, actorId, provider, [c]);

    // Same website, different formatting + different provider id → duplicate.
    const c2 = company({
      providerId: "ChIJ-web-2",
      name: "Website Dup Co Renamed",
      website: "http://website-dup.example.com",
    });
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c2]);
    expect(summary.alreadyExists).toHaveLength(1);
    expect(summary.imported).toHaveLength(0);
  });

  it("detects duplicates by normalized phone", async () => {
    const c = company({ providerId: "ChIJ-phone-1", name: "Phone Dup Co", phone: "+91 79 4000 1111", website: undefined });
    await importDiscoveredCompanies(orgA, actorId, provider, [c]);
    const c2 = company({
      providerId: "ChIJ-phone-2",
      name: "Phone Dup Co 2",
      phone: "+91-79-4000-1111",
      website: "https://phone-dup-2.example.com",
    });
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c2]);
    expect(summary.alreadyExists).toHaveLength(1);
  });

  it("flags name+location as possible duplicate but still imports (no silent merge)", async () => {
    const c = company({
      providerId: "ChIJ-possible-1",
      name: "Possible Dup Industries",
      website: "https://possible-1.example.com",
      phone: undefined,
      city: "Surat",
    });
    await importDiscoveredCompanies(orgA, actorId, provider, [c]);

    const c2 = company({
      providerId: "ChIJ-possible-2",
      name: "possible dup industries", // different case/punctuation
      website: "https://possible-2.example.com",
      phone: "+91 261 400 2222",
      city: "Surat",
    });
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c2]);
    expect(summary.possibleDuplicates).toHaveLength(1);
    expect(summary.possibleDuplicates[0].reason).toContain("Possible duplicate");
    expect(summary.possibleDuplicates[0].leadId).toBeTruthy();
    expect(summary.possibleDuplicates[0].matchedLeadId).toBeTruthy();
  });

  it("does not treat name-only matches as duplicates", async () => {
    const c = company({
      providerId: "ChIJ-nameonly-1",
      name: "Generic Name Only Co",
      website: "https://nameonly-1.example.com",
      phone: undefined,
      city: "Delhi",
    });
    await importDiscoveredCompanies(orgA, actorId, provider, [c]);
    const c2 = company({
      providerId: "ChIJ-nameonly-2",
      name: "Generic Name Only Co",
      website: "https://nameonly-2.example.com",
      phone: "+91 11 4000 3333",
      city: "Chennai", // different city
    });
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c2]);
    expect(summary.imported).toHaveLength(1);
    expect(summary.possibleDuplicates).toHaveLength(0);
  });

  it("keeps intelligence relationships linked to the imported lead", async () => {
    const c = company({ providerId: "ChIJ-intel-1", name: "Intel Link Co" });
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c]);
    const leadId = summary.imported[0].leadId!;

    await db.websiteInspection.create({
      data: {
        organizationId: orgA,
        leadId,
        status: "COMPLETED",
        requestedUrl: "https://intel-link.example.com",
        findings: {},
        dataLabel: "VERIFIED",
      },
    });

    const lead = await db.lead.findUnique({
      where: { id: leadId },
      include: { websiteInspections: { take: 1 } },
    });
    expect(lead?.websiteInspections).toHaveLength(1);
  });

  it("enforces tenant isolation — org B sees none of org A's imports", async () => {
    const c = company({ providerId: "ChIJ-tenant-1", name: "Tenant Isolation Co" });
    await importDiscoveredCompanies(orgA, actorId, provider, [c]);

    const match = await findMatchForCompany(orgB, provider, c);
    expect(match.match).toBeNull();
    expect(match.possible).toBeNull();

    const inB = await db.lead.count({ where: { organizationId: orgB } });
    expect(inB).toBe(0);
  });

  it("bulk import reports partial outcomes without rolling back successes", async () => {
    const fresh = company({ providerId: "ChIJ-bulk-fresh", name: "Bulk Fresh Co" });
    const dup = company({ providerId: "ChIJ-bulk-dup", name: "Bulk Dup Co" });
    await importDiscoveredCompanies(orgA, actorId, provider, [dup]);

    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [fresh, dup]);
    expect(summary.imported).toHaveLength(1);
    expect(summary.alreadyExists).toHaveLength(1);
    expect(summary.failed).toHaveLength(0);
    expect(summary.imported[0].providerId).toBe("ChIJ-bulk-fresh");
  });

  it("persists the real business name as the lead name (never 'Unnamed lead')", async () => {
    const c = company({ providerId: "ChIJ-quality-name", name: "Quality Name Industries" });
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c]);
    expect(summary.imported).toHaveLength(1);
    const lead = await db.lead.findUnique({
      where: { id: summary.imported[0].leadId! },
      include: { company: true },
    });
    expect(lead?.fullName).toBe("Quality Name Industries");
    expect(lead?.company?.name).toBe("Quality Name Industries");
    expect(lead?.fullName).not.toContain("Unnamed");
  });

  it("persists score, opportunity and website/contact state from enrichment", async () => {
    const { enrichCandidate } = await import("../lib/discovery/candidates");
    const c = enrichCandidate(
      company({
        providerId: "ChIJ-quality-score",
        name: "Score Test Mfg",
        website: undefined, // Google authoritative → NO_WEBSITE
      }),
      "authoritative",
      { industry: "manufacturers", location: "Gujarat" },
    );
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c], {
      searchQuery: "manufacturers",
    });
    expect(summary.imported).toHaveLength(1);
    const lead = await db.lead.findUnique({ where: { id: summary.imported[0].leadId! } });
    expect(lead?.websiteStatus).toBe("NO_WEBSITE");
    expect(lead?.website).toBeNull();
    expect(lead?.contactable).toBe(true); // phone alone qualifies
    expect(lead?.leadScore).toBe(c.score);
    expect(lead?.leadScore).toBeGreaterThan(0);
    expect(lead?.scoreReason).toBe(c.scoreReason);
    expect(lead?.opportunityType).toBe("HIGH");
    expect(lead?.opportunityReason).toContain("No website");
    expect(lead?.externalId).toBe("ChIJ-quality-score");
    expect(lead?.sourceType).toBe("GOOGLE_BUSINESS");
    expect(lead?.phone).toBe(c.phone);
  });

  it("imports low-score / not_qualified candidates without gating", async () => {
    const { enrichCandidate } = await import("../lib/discovery/candidates");
    const c = enrichCandidate(
      company({
        providerId: "ChIJ-quality-low",
        name: "Low Score Co",
        phone: undefined,
        email: undefined,
        website: "https://low-score.example.com",
      }),
      "authoritative",
    );
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c]);
    expect(summary.imported).toHaveLength(1);
    const lead = await db.lead.findUnique({ where: { id: summary.imported[0].leadId! } });
    expect(lead?.contactable).toBe(false);
    expect(lead?.websiteStatus).toBe("HAS_WEBSITE");
  });

  it("does not create WebsiteInspection rows for NO_WEBSITE imports", async () => {
    const { enrichCandidate } = await import("../lib/discovery/candidates");
    const c = enrichCandidate(
      company({ providerId: "ChIJ-quality-noinspect", name: "No Inspect Co", website: undefined }),
      "authoritative",
    );
    expect(c.websiteStatus).toBe("NO_WEBSITE");
    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [c]);
    const lead = await db.lead.findUnique({
      where: { id: summary.imported[0].leadId! },
      include: { websiteInspections: true },
    });
    expect(lead?.websiteInspections).toHaveLength(0);
  });
});
