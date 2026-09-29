/**
 * Discovery → CRM duplicate matching — pure unit tests (no DB, no network).
 *
 * Covers spec items: duplicate by external provider ID, by canonical
 * website, by normalized phone, possible-duplicate by name+location,
 * name+location matching, no false merge on name-only match.
 */
import { describe, it, expect } from "vitest";
import {
  matchDuplicate,
  normalizeName,
  normalizePhoneDigits,
} from "../lib/discovery/matching";
import { duplicateReason } from "../lib/discovery/import";

const PROVIDER = "Google Places";

const candidate = {
  providerId: "ChIJ123",
  sourceType: "GOOGLE_BUSINESS",
  website: "https://www.Acme-Industries.com/",
  phone: "+91 79 4000 1122",
  name: "Acme Industries Pvt. Ltd.",
  city: "Ahmedabad",
  country: "India",
};

describe("matchDuplicate — definitive matches", () => {
  it("matches by external provider ID + provider", () => {
    const m = matchDuplicate(candidate, { id: "l1", externalId: "ChIJ123", sourceType: "GOOGLE_BUSINESS" }, PROVIDER);
    expect(m?.definitive).toBe(true);
    expect(m?.kind).toBe("external_id");
  });

  it("does not match a different provider's external ID", () => {
    const m = matchDuplicate(candidate, { id: "l1", externalId: "ChIJ123", sourceType: "OTHER" }, PROVIDER);
    expect(m).toBeNull();
  });

  it("matches canonical website across protocol/www/case/trailing-slash variants", () => {
    for (const site of [
      "http://acme-industries.com",
      "https://www.acme-industries.com/",
      "ACME-INDUSTRIES.COM",
      "https://acme-industries.com/contact",
    ]) {
      const m = matchDuplicate(candidate, { id: "l1", website: site }, PROVIDER);
      expect(m?.definitive).toBe(true);
      expect(m?.kind).toBe("website");
    }
  });

  it("matches normalized phone across formatting variants", () => {
    for (const phone of ["+917940001122", "+91-79-4000-1122", "079 4000 1122"]) {
      const m = matchDuplicate({ ...candidate, phone }, { id: "l1", phone: "+91 79 4000 1122" }, PROVIDER);
      // Note: "079 4000 1122" lacks +91 country code — must NOT match.
      if (phone === "079 4000 1122") {
        expect(m).toBeNull();
      } else {
        expect(m?.definitive).toBe(true);
        expect(m?.kind).toBe("phone");
      }
    }
  });
});

describe("matchDuplicate — possible matches", () => {
  const sameNameCity = {
    id: "l1",
    name: "acme industries pvt ltd",
    city: "Ahmedabad",
    country: "India",
  };

  it("flags name + city as a possible duplicate (never definitive)", () => {
    const m = matchDuplicate(candidate, sameNameCity, PROVIDER);
    expect(m?.definitive).toBe(false);
    expect(m?.kind).toBe("name_location");
    expect(m?.reason).toContain("Possible duplicate");
  });

  it("falls back to country when no city is present", () => {
    const m = matchDuplicate(
      { ...candidate, city: undefined },
      { id: "l1", name: "ACME INDUSTRIES PVT. LTD.", country: "India" },
      PROVIDER,
    );
    expect(m?.definitive).toBe(false);
  });

  it("does NOT match on name alone (different city)", () => {
    const m = matchDuplicate(
      candidate,
      { id: "l1", name: "Acme Industries Pvt. Ltd.", city: "Mumbai", country: "India" },
      PROVIDER,
    );
    expect(m).toBeNull();
  });

  it("does NOT match on location alone (different name)", () => {
    const m = matchDuplicate(
      candidate,
      { id: "l1", name: "Some Other Company", city: "Ahmedabad", country: "India" },
      PROVIDER,
    );
    expect(m).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(
      matchDuplicate(candidate, { id: "l1", name: "Zzz Corp", city: "Delhi" }, PROVIDER),
    ).toBeNull();
    expect(matchDuplicate(candidate, null, PROVIDER)).toBeNull();
  });
});

describe("normalizers", () => {
  it("normalizeName strips punctuation and case", () => {
    expect(normalizeName("Acme Industries Pvt. Ltd.")).toBe("acme industries pvt ltd");
    expect(normalizeName("  ACME—Industries ")).toBe("acme industries");
  });

  it("normalizePhoneDigits keeps digits comparable", () => {
    expect(normalizePhoneDigits("+91 79 4000-1122").replace(/\D/g, "")).toBe("917940001122");
  });
});

describe("duplicateReason — backward compatibility", () => {
  it("still detects same-provider listing", () => {
    const r = duplicateReason(
      { providerId: "ChIJ123", sourceType: "GOOGLE_BUSINESS" },
      { id: "l1", externalId: "ChIJ123", sourceType: "GOOGLE_BUSINESS", email: null, phone: null, domain: null },
      PROVIDER,
    );
    expect(r).toContain("same Google Places listing");
  });

  it("still detects domain matches", () => {
    const r = duplicateReason(
      { providerId: "x", sourceType: "GOOGLE_BUSINESS", domain: "acme.example.com" },
      { id: "l1", externalId: null, sourceType: "", email: null, phone: null, domain: "acme.example.com" },
      PROVIDER,
    );
    expect(r).toContain("website");
  });

  it("returns null for possible-only matches (handled separately)", () => {
    // duplicateReason covers definitive matches only.
    const r = duplicateReason(
      { providerId: "ChIJ999", sourceType: "GOOGLE_BUSINESS" },
      { id: "l1", externalId: null, sourceType: "", email: null, phone: null, domain: null },
      PROVIDER,
    );
    expect(r).toBeNull();
  });
});
