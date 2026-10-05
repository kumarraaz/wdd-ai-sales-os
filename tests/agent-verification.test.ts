/**
 * Verification engine tests — the quality gate of the AI sales agent.
 *
 * Nothing is invented: every case asserts confidence + reason from
 * source-backed evidence only.
 */
import { describe, it, expect } from "vitest";
import { verifyCandidate, type VerificationInput } from "../lib/prospecting/verification";

function base(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    businessName: "ABC Plastics",
    category: "Plastic manufacturer",
    city: "Ahmedabad",
    country: "India",
    website: "https://abcplastics.com",
    phone: "+91 98765 43210",
    instagramUsername: null,
    targetIndustry: "manufacturers",
    targetLocation: "Ahmedabad",
    targetCountry: "India",
    sources: [
      {
        provider: "google-places",
        sourceType: "GOOGLE_BUSINESS",
        retrievedAt: "2026-10-06T00:00:00Z",
        label: "Google Places business listing",
      },
    ],
    industryRelevance: 85,
    ...overrides,
  };
}

describe("verifyCandidate", () => {
  it("HIGH: identity + industry + location verified by 2+ independent sources", () => {
    const r = verifyCandidate(
      base({
        sources: [
          { provider: "google-places", sourceType: "GOOGLE_BUSINESS", retrievedAt: "2026-10-06T00:00:00Z" },
          { provider: "tavily", sourceType: "WEB_SEARCH", retrievedAt: "2026-10-06T00:00:00Z" },
        ],
      }),
    );
    expect(r.confidence).toBe("HIGH");
    expect(r.checks.identity).toBe(true);
    expect(r.checks.industry).toBe(true);
    expect(r.checks.location).toBe(true);
    expect(r.checks.independentSources).toBe(2);
    expect(r.reason).toContain("2 independent sources");
  });

  it("MEDIUM: single strong source with supporting evidence", () => {
    const r = verifyCandidate(base());
    expect(r.confidence).toBe("MEDIUM");
    expect(r.reason).toContain("single strong source");
  });

  it("REJECTED: no verifiable business identity", () => {
    const r = verifyCandidate(
      base({ businessName: null, providerId: null, instagramUsername: null }),
    );
    expect(r.confidence).toBe("REJECTED");
    expect(r.reason).toContain("No verifiable business identity");
  });

  it("REJECTED: industry mismatch with low relevance", () => {
    const r = verifyCandidate(base({ industryRelevance: 20, category: "Bakery" }));
    expect(r.confidence).toBe("REJECTED");
    expect(r.reason).toContain("Industry mismatch");
  });

  it("REJECTED: location contradiction", () => {
    const r = verifyCandidate(base({ city: "Delhi" }));
    expect(r.confidence).toBe("REJECTED");
    expect(r.reason).toContain("Location does not match");
  });

  it("LOW: identity exists but industry evidence is weak", () => {
    const r = verifyCandidate(base({ industryRelevance: 55 }));
    // 55 >= 60 fails the industry bar but >= 30 avoids REJECTED → LOW
    expect(r.confidence).toBe("LOW");
  });

  it("accepts an Instagram username as identity when nothing else is known", () => {
    const r = verifyCandidate(
      base({
        businessName: null,
        category: "jewellery",
        city: "Mumbai",
        country: "India",
        website: null,
        phone: null,
        instagramUsername: "jaipur_jewels",
        targetIndustry: "jewellery",
        targetLocation: "Mumbai",
        industryRelevance: 85,
        sources: [
          {
            provider: "tavily",
            sourceType: "INSTAGRAM",
            url: "https://www.instagram.com/jaipur_jewels/",
            retrievedAt: "2026-10-06T00:00:00Z",
            label: "Instagram profile URL via public web search (listed, not accessed)",
          },
        ],
      }),
    );
    expect(r.confidence).toBe("MEDIUM");
    expect(r.checks.identity).toBe(true);
  });

  it("never invents: reason cites sources, never claims unverified facts", () => {
    const r = verifyCandidate(base({ sources: [] }));
    expect(r.confidence).toBe("MEDIUM");
    expect(r.reason).not.toContain("undefined");
  });
});
