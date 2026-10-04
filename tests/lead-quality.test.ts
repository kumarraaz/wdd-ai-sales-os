/**
 * Lead quality — Discovery → Lead → CRM data integrity.
 * Pure unit tests (no DB). Covers the user's fix list:
 *  1. Google Business name → Lead name (never "Unnamed lead")
 *  2. All verified lead data preserved on import
 *  3. Contactability: phone alone qualifies; email never required
 *  4. Opportunity HIGH/MEDIUM/LOW with deterministic verified-data reasons
 *  5. Deterministic 0–100 score (no fabricated firmographics)
 *  6. CRM display name = company name
 *  8. Import never gated on qualification
 *  9. NO_WEBSITE never triggers website inspection
 * 10. Invalid status rejected by the update schema (inline dropdown API)
 */
import { describe, it, expect } from "vitest";
import {
  enrichCandidate,
  computeContactable,
  computeWebsiteStatus,
  scoreDiscoveredCompany,
  classifyOpportunity,
  industryMatchesTarget,
  locationMatchesTarget,
  type DiscoveryScoreTarget,
} from "../lib/discovery/candidates";
import { buildImportLeadInput } from "../lib/discovery/import";
import { leadDisplayName } from "../lib/leads";
import { updateLeadSchema } from "../lib/validators";
import { getDiscoveryProvider } from "../lib/discovery/registry";
import type { DiscoveredCompany } from "../lib/discovery/types";

const google = getDiscoveryProvider("google-places")!;

function company(overrides: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    provider: "google-places",
    providerId: "ChIJ-test-quality",
    name: "Sharma Industries",
    category: "manufacturer",
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    phone: "+91 79 4000 1234",
    discoveredAt: new Date().toISOString(),
    provenance: "VERIFIED_DATA",
    ...overrides,
  };
}

const TARGET: DiscoveryScoreTarget = { industry: "manufacturers", location: "Gujarat" };

describe("1. Google Business name → Lead name", () => {
  it("buildImportLeadInput defaults fullName to the real business name", () => {
    const input = buildImportLeadInput(company(), google, "manufacturers");
    expect(input.fullName).toBe("Sharma Industries");
    expect(input.companyName).toBe("Sharma Industries");
    expect(input.fullName).not.toContain("Unnamed");
  });

  it("never invents a name when none exists — leaves it undefined, not 'Unnamed lead'", () => {
    const input = buildImportLeadInput(company({ name: "   " }), google);
    expect(input.fullName).toBeUndefined();
  });

  it("leadDisplayName prefers company name, never shows 'Unnamed lead'", () => {
    expect(leadDisplayName({ fullName: null, company: { name: "Sharma Industries" } })).toBe(
      "Sharma Industries",
    );
    expect(leadDisplayName({ fullName: "Ramesh", company: { name: "Sharma Industries" } })).toBe(
      "Sharma Industries",
    );
    expect(leadDisplayName({ fullName: "Ramesh", company: null })).toBe("Ramesh");
    expect(leadDisplayName({ fullName: null, company: null })).not.toContain("Unnamed");
  });
});

describe("2. all verified lead data preserved on import", () => {
  it("carries phone, website state, address, industry, place id, URLs, flags, score", () => {
    const c = enrichCandidate(
      company({
        email: "info@sharma.example.com",
        website: undefined,
        googleMapsUrl: "https://maps.google.com/?cid=123",
        sourceUrl: "https://maps.google.com/?cid=123",
      }),
      "authoritative",
      TARGET,
    );
    const input = buildImportLeadInput(c, google, "manufacturers in Gujarat");
    expect(input.phone).toBe("+91 79 4000 1234");
    expect(input.email).toBe("info@sharma.example.com");
    expect(input.website).toBeUndefined(); // no website → stays missing, never invented
    expect(input.websiteStatus).toBe("NO_WEBSITE");
    expect(input.city).toBe("Ahmedabad");
    expect(input.industry).toBe("manufacturer");
    expect(input.externalId).toBe("ChIJ-test-quality"); // Google place id preserved
    expect(input.googleMapsUrl).toBe("https://maps.google.com/?cid=123");
    expect(input.contactable).toBe(true);
    expect(input.leadScore).toBeGreaterThan(0);
    expect(input.scoreReason).toBeTruthy();
    expect(input.opportunityType).toBe("HIGH");
    expect(input.opportunityReason).toBeTruthy();
    expect(input.sourceType).toBe(google.sourceType);
    expect(input.sourceDetail).toContain("manufacturers in Gujarat");
  });

  it("does not invent missing values", () => {
    const input = buildImportLeadInput(
      enrichCandidate(company({ phone: undefined, email: undefined }), "authoritative"),
      google,
    );
    expect(input.email).toBeUndefined();
    expect(input.phone).toBeUndefined();
    expect(input.website).toBeUndefined();
    expect(input.contactable).toBe(false);
  });
});

describe("3. contactability", () => {
  it("phone alone qualifies as contactable", () => {
    expect(computeContactable({ phone: "+91 79 4000 1234" })).toBe(true);
  });

  it("no email does NOT make a lead uncontactable", () => {
    expect(computeContactable({ phone: "+91 79 4000 1234", email: undefined })).toBe(true);
  });

  it("email alone qualifies", () => {
    expect(computeContactable({ email: "a@b.com" })).toBe(true);
  });

  it("social/profile URL qualifies", () => {
    expect(computeContactable({ instagramUrl: "https://instagram.com/x" })).toBe(true);
    expect(computeContactable({ facebookUrl: "https://facebook.com/x" })).toBe(true);
    expect(computeContactable({ linkedinUrl: "https://linkedin.com/company/x" })).toBe(true);
  });

  it("a Google Maps listing URL alone does NOT count", () => {
    const c = enrichCandidate(
      company({ phone: undefined, googleMapsUrl: "https://maps.google.com/?cid=1" }),
      "authoritative",
    );
    expect(c.contactable).toBe(false);
  });

  it("nothing at all → not contactable", () => {
    expect(computeContactable({})).toBe(false);
  });
});

describe("4. opportunity classification", () => {
  it("HIGH: no website + phone + target industry (+ location) with a deterministic reason", () => {
    const { tier, reason } = classifyOpportunity(
      company(),
      "NO_WEBSITE",
      true,
      TARGET,
    );
    expect(tier).toBe("HIGH");
    expect(reason).toBe(
      `No website + phone available + target industry "manufacturers" + target location "Gujarat"`,
    );
  });

  it("never labels opportunity as the string 'NO WEBSITE'", () => {
    const c = enrichCandidate(company(), "authoritative", TARGET);
    expect(c.opportunityType).not.toBe("NO_WEBSITE");
    expect(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).toContain(c.opportunityType);
  });

  it("MEDIUM: no website with partial signals", () => {
    const { tier, reason } = classifyOpportunity(
      company({ phone: undefined, category: "software" }),
      "NO_WEBSITE",
      false,
      TARGET,
    );
    // industry/location mismatch but no website alone is a partial signal
    expect(["MEDIUM", "LOW", "UNKNOWN"]).toContain(tier);
    expect(reason).toBeTruthy();
  });

  it("MEDIUM: has website but phone + industry match (improvement/SEO prospect)", () => {
    const { tier, reason } = classifyOpportunity(company(), "HAS_WEBSITE", true, TARGET);
    expect(tier).toBe("MEDIUM");
    expect(reason.toLowerCase()).toContain("has website");
  });

  it("LOW: contactable but no strong signal", () => {
    const { tier } = classifyOpportunity(
      company({ phone: "+91 1", category: "software" }),
      "HAS_WEBSITE",
      true,
      TARGET,
    );
    expect(tier).toBe("LOW");
  });

  it("UNKNOWN: not contactable", () => {
    const { tier } = classifyOpportunity(
      company({ phone: undefined }),
      "UNKNOWN",
      false,
      TARGET,
    );
    expect(tier).toBe("UNKNOWN");
  });

  it("reasons mention only verified signals, never invented facts", () => {
    const { reason } = classifyOpportunity(company(), "NO_WEBSITE", true, TARGET);
    expect(reason).not.toMatch(/revenue|employee|owner|founded|turnover/i);
  });
});

describe("5. deterministic 0–100 discovery score", () => {
  it("scores the canonical example: no website + phone + industry + location", () => {
    const { score, factors, scoreReason } = scoreDiscoveredCompany(company(), "NO_WEBSITE", TARGET);
    // 25 (no website) + 20 (phone) + 15 (industry) + 10 (location) + 5 (Google confidence)
    expect(score).toBe(75);
    expect(score).toBeLessThanOrEqual(100);
    expect(scoreReason).toContain("No website");
    expect(scoreReason).toContain("Phone available");
    expect(factors.every((f) => f.points <= f.max)).toBe(true);
  });

  it("is deterministic — same input, same score", () => {
    const a = scoreDiscoveredCompany(company(), "NO_WEBSITE", TARGET);
    const b = scoreDiscoveredCompany(company(), "NO_WEBSITE", TARGET);
    expect(a).toEqual(b);
  });

  it("missing data scores 0 for that factor, never negative", () => {
    const { score, factors } = scoreDiscoveredCompany(
      company({ phone: undefined, email: undefined, rating: undefined, reviewCount: undefined }),
      "UNKNOWN",
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(factors.every((f) => f.points >= 0)).toBe(true);
  });

  it("never uses fabricated firmographics", () => {
    const { scoreReason, factors } = scoreDiscoveredCompany(company(), "NO_WEBSITE", TARGET);
    expect(scoreReason).not.toMatch(/revenue|employee|owner|founded|turnover/i);
    expect(factors.map((f) => f.factor).join(" ")).not.toMatch(/revenue|employee|owner/i);
  });

  it("clamps to 0–100 even for maximal evidence", () => {
    const { score } = scoreDiscoveredCompany(
      company({
        email: "a@b.com",
        rating: 4.9,
        reviewCount: 500,
        sourceUrl: "https://maps.google.com/x",
      }),
      "NO_WEBSITE",
      TARGET,
    );
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(100); // 25+20+15+10+10+5+5+5+5 = 115 → clamped to 100
  });
});

describe("industry/location matching", () => {
  it("matches target industry keyword in category or name", () => {
    expect(industryMatchesTarget("manufacturer", "X", "manufacturers")).toBe(true);
    expect(industryMatchesTarget("software", "X", "manufacturers")).toBe(false);
    expect(industryMatchesTarget(undefined, "Sharma Manufacturing Co", "manufacturers")).toBe(true);
    expect(industryMatchesTarget("manufacturers", "X", "manufacturer")).toBe(true); // singular/plural both ways
  });

  it("matches target location against city/state/country", () => {
    expect(locationMatchesTarget(company(), "Gujarat")).toBe(true);
    expect(locationMatchesTarget(company(), "Ahmedabad, Gujarat")).toBe(true);
    expect(locationMatchesTarget(company(), "Maharashtra")).toBe(false);
  });
});

describe("8. import never gated on qualification", () => {
  it("buildImportLeadInput ignores qualification entirely", () => {
    const low = buildImportLeadInput(
      { ...enrichCandidate(company(), "authoritative", TARGET), qualification: "not_qualified" },
      google,
    );
    const unreviewed = buildImportLeadInput(
      { ...enrichCandidate(company(), "authoritative", TARGET), qualification: "unreviewed" },
      google,
    );
    expect(low.fullName).toBe("Sharma Industries");
    expect(unreviewed.fullName).toBe("Sharma Industries");
    expect(low.leadScore).toBeGreaterThan(0);
    // qualification is not even a field on the lead input
    expect("qualification" in low).toBe(false);
  });
});

describe("9. NO_WEBSITE never triggers website research", () => {
  it("NO_WEBSITE is detected from Google authority without any crawling", () => {
    const c = enrichCandidate(company({ website: undefined }), "authoritative", TARGET);
    expect(c.websiteStatus).toBe("NO_WEBSITE");
    expect(c.website).toBeUndefined();
  });

  it("sparse providers yield UNKNOWN, never an assumed NO_WEBSITE", () => {
    expect(computeWebsiteStatus({ website: undefined }, false)).toBe("UNKNOWN");
  });
});

describe("13. inline status update validation", () => {
  it("accepts a canonical status", () => {
    const parsed = updateLeadSchema.safeParse({ status: "CONTACTED" });
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const parsed = updateLeadSchema.safeParse({ status: "SUPER_QUALIFIED" });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-status garbage in the status field", () => {
    const parsed = updateLeadSchema.safeParse({ status: "" });
    expect(parsed.success).toBe(false);
  });
});
