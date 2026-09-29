/**
 * Discovery DB integration tests — REQUIRE a real PostgreSQL database.
 * Run with: DATABASE_URL=... npx vitest run tests/discovery-db.test.ts
 * Skipped automatically when DATABASE_URL is not set.
 *
 * Covers: import into the existing Lead/Company architecture (no second
 * lead database), tenant isolation, duplicate skipping with reasons,
 * provenance persistence, quota enforcement, and audit logging.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { db } from "../lib/db";
import { getDiscoveryProvider } from "../lib/discovery/registry";
import {
  importDiscoveredCompanies,
  type ImportSummary,
} from "../lib/discovery/import";
import type { DiscoveredCompany } from "../lib/discovery/types";
import {
  checkDiscoveryQuota,
  recordDiscoveryUsage,
  getDiscoveryUsageToday,
} from "../lib/quotas";
import { audit } from "../lib/audit";

// Mock better-auth: the discovery routes resolve the workspace through
// withWorkspace -> requireWorkspace -> auth.api.getSession. The session user
// is wired to a real DB user + membership created in beforeAll.
vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: {
          id: "discovery-test-user",
          email: "discovery-test@example.com",
          name: "Discovery Tester",
        },
        session: { id: "discovery-test-session" },
      }),
    },
  },
}));

// Mock Next.js request-scoped headers(): withWorkspace -> requireWorkspace ->
// getSessionUser calls headers() BEFORE the mocked auth above is consulted,
// and headers() throws outside a request scope in vitest. Without this mock
// every route-level test fails with a 500 instead of reaching the handler.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

import { POST as discoverySearch } from "../app/api/discovery/search/route";

const hasDb = !!process.env.DATABASE_URL;

function company(overrides: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    provider: "google-places",
    providerId: "ChIJ-test-1",
    name: "Acme Industrial",
    category: "manufacturer",
    city: "Ahmedabad",
    country: "India",
    phone: "+91 79 4000 1122",
    website: "https://acme-discovery-test.example.com",
    sourceUrl: "https://maps.google.com/?cid=ChIJ-test-1",
    rating: 4.6,
    reviewCount: 128,
    discoveredAt: new Date().toISOString(),
    provenance: "VERIFIED_DATA",
    ...overrides,
  };
}

describe.skipIf(!hasDb)("discovery — database integration", () => {
  let orgA: string;
  let orgB: string;
  const actorId = "discovery-test-user";

  beforeAll(async () => {
    await db.user.upsert({
      where: { email: "discovery-test@example.com" },
      create: { id: actorId, email: "discovery-test@example.com", name: "Discovery Tester" },
      update: {},
    });
    const a = await db.organization.create({
      data: { name: "Discovery Org A", slug: `discovery-orga-${Date.now()}` },
    });
    const b = await db.organization.create({
      data: { name: "Discovery Org B", slug: `discovery-orgb-${Date.now()}` },
    });
    orgA = a.id;
    orgB = b.id;
    await db.membership.create({
      data: { userId: actorId, organizationId: orgA, role: "OWNER" },
    });
  });

  afterAll(async () => {
    await db.membership.deleteMany({ where: { userId: actorId } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.delete({ where: { id: actorId } });
    await db.$disconnect();
  });

  it("imports companies as leads with provenance (no second lead database)", async () => {
    const provider = getDiscoveryProvider("google-places");
    if (!provider) throw new Error("test setup: provider missing");

    const summary: ImportSummary = await importDiscoveredCompanies(
      orgA,
      actorId,
      provider,
      [company(), company({ providerId: "ChIJ-test-2", name: "Beta Traders", website: "https://beta-discovery-test.example.com", phone: undefined })],
      { searchQuery: "manufacturers" },
    );
    expect(summary.imported).toHaveLength(2);
    expect(summary.alreadyExists).toHaveLength(0);
    expect(summary.skipped).toHaveLength(0);

    const leads = await db.lead.findMany({
      where: { organizationId: orgA },
      include: { provenance: true, company: true },
    });
    expect(leads).toHaveLength(2);

    const acme = leads.find((l) => l.company?.name === "Acme Industrial");
    if (!acme) throw new Error("test setup: lead missing");
    expect(acme.dataLabel).toBe("VERIFIED");
    expect(acme.sourceType).toBe("GOOGLE_BUSINESS");
    expect(acme.externalId).toBe("ChIJ-test-1");
    expect(acme.sourceUrl).toBe("https://maps.google.com/?cid=ChIJ-test-1");
    expect(acme.rating).toBe(4.6);
    expect(acme.reviewCount).toBe(128);
    expect(acme.discoveredAt).toBeInstanceOf(Date);
    expect(acme.sourceDetail).toContain("Google Places");

    // Field-level provenance rows for website + phone.
    const fields = acme.provenance.map((p) => p.field).sort();
    expect(fields).toEqual(["phone", "website"]);
    for (const p of acme.provenance) {
      expect(p.label).toBe("VERIFIED");
      expect(p.source).toBe("Google Places");
      expect(p.sourceUrl).toBe("https://maps.google.com/?cid=ChIJ-test-1");
    }
  });

  it("skips duplicates on re-import with a reason", async () => {
    const provider = getDiscoveryProvider("google-places");
    if (!provider) throw new Error("test setup: provider missing");

    const summary = await importDiscoveredCompanies(orgA, actorId, provider, [
      company(),
    ]);
    expect(summary.imported).toHaveLength(0);
    expect(summary.alreadyExists).toHaveLength(1);
    expect(summary.alreadyExists[0]?.reason).toContain("same Google Places listing");
  });

  it("tenant isolation: org B does not see org A's discovered leads", async () => {
    const provider = getDiscoveryProvider("google-places");
    if (!provider) throw new Error("test setup: provider missing");

    // Same place imported into org B creates org B's own lead — no cross-org dedup.
    const summaryB = await importDiscoveredCompanies(orgB, actorId, provider, [
      company(),
    ]);
    expect(summaryB.imported).toHaveLength(1);

    const leadsA = await db.lead.findMany({ where: { organizationId: orgA } });
    const leadsB = await db.lead.findMany({ where: { organizationId: orgB } });
    expect(leadsA.every((l) => l.organizationId === orgA)).toBe(true);
    expect(leadsB.every((l) => l.organizationId === orgB)).toBe(true);
    expect(leadsB).toHaveLength(1);

    // Provenance rows are org-scoped too.
    const provB = await db.leadFieldProvenance.findMany({
      where: { organizationId: orgB },
    });
    expect(provB.length).toBeGreaterThan(0);
    expect(provB.every((p) => p.organizationId === orgB)).toBe(true);
  });

  it("enforces the daily discovery quota", async () => {
    // FREE fallback: 20 searches/day. Exhaust them, then the next is denied.
    await recordDiscoveryUsage(orgA, { searches: 20 });
    const used = await getDiscoveryUsageToday(orgA);
    expect(used.searches).toBeGreaterThanOrEqual(20);

    const denied = await checkDiscoveryQuota(orgA, 1);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain("search limit");
  });

  it("records discovery usage counters", async () => {
    const before = await getDiscoveryUsageToday(orgB);
    await recordDiscoveryUsage(orgB, { searches: 1, records: 7, imports: 2 });
    const after = await getDiscoveryUsageToday(orgB);
    expect(after.searches).toBe(before.searches + 1);
    expect(after.records).toBe(before.records + 7);
  });

  it("writes an audit log entry for discovery imports", async () => {
    await audit({
      organizationId: orgA,
      actorId,
      action: "discovery.import",
      resource: "lead",
      metadata: { provider: "google-places", imported: 1, skipped: 0 },
    });
    const entry = await db.auditLog.findFirst({
      where: { organizationId: orgA, action: "discovery.import" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.result).toBe("SUCCESS");
    expect(entry?.actorId).toBe(actorId);
  });

  it("search route returns 409 when the provider is not configured", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const res = await discoverySearch(
      new NextRequest("http://localhost/api/discovery/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "google-places", keyword: "gyms" }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("PROVIDER_NOT_CONFIGURED");
    expect(Array.isArray(body.setupInstructions)).toBe(true);
    vi.unstubAllEnvs();
  });

  it("search route rejects invalid input with 400", async () => {
    const res = await discoverySearch(
      new NextRequest("http://localhost/api/discovery/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "google-places", keyword: "" }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_INPUT");
  });
});
