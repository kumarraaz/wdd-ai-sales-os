/**
 * Entity matching tests — deterministic cross-source identity resolution.
 *
 * The ABC Plastics case from the spec: Google "ABC Plastics Pvt Ltd" +
 * web "ABC Plastics Ahmedabad" + Instagram "@abcplastics" must MATCH.
 * POSSIBLE matches must NOT merge (no false merges).
 */
import { describe, it, expect } from "vitest";
import {
  matchEntities,
  normalizeBusinessName,
  normalizePhoneDigits,
  normalizeDomainOf,
} from "../lib/prospecting/entity-match";

describe("normalizeBusinessName", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeBusinessName("ABC Plastics Pvt Ltd")).toBe("abc plastics");
    expect(normalizeBusinessName("Sharma & Sons Enterprises")).toBe("sharma sons");
  });
});

describe("normalizePhoneDigits", () => {
  it("keeps digits only", () => {
    expect(normalizePhoneDigits("+91 98765 43210")).toBe("919876543210");
  });
});

describe("normalizeDomainOf", () => {
  it("extracts the host", () => {
    expect(normalizeDomainOf("https://www.abcplastics.com/about")).toBe("abcplastics.com");
    expect(normalizeDomainOf(null)).toBeNull();
  });
});

describe("matchEntities", () => {
  const google = {
    businessName: "ABC Plastics Pvt Ltd",
    phone: "+91 98765 43210",
    website: "https://abcplastics.com",
    providerId: "place-123",
    instagramUsername: null,
    city: "Ahmedabad",
  };

  it("MATCHED: same phone digits", () => {
    const r = matchEntities(google, {
      businessName: "Totally Different Name",
      phone: "919876543210",
      website: null,
      providerId: null,
      instagramUsername: null,
      city: "Surat",
    });
    expect(r.status).toBe("MATCHED");
    expect(r.signals).toContain("phone");
  });

  it("MATCHED: same domain", () => {
    const r = matchEntities(google, {
      businessName: "ABC Plastics",
      phone: null,
      website: "http://abcplastics.com/",
      providerId: null,
      instagramUsername: null,
      city: null,
    });
    expect(r.status).toBe("MATCHED");
    expect(r.signals).toContain("domain");
  });

  it("MATCHED: same provider id (Google place_id)", () => {
    const r = matchEntities(google, {
      businessName: null,
      phone: null,
      website: null,
      providerId: "place-123",
      instagramUsername: null,
      city: null,
    });
    expect(r.status).toBe("MATCHED");
  });

  it("MATCHED: same normalized name + same city (the ABC Plastics case)", () => {
    const r = matchEntities(google, {
      businessName: "ABC Plastics Ahmedabad",
      phone: null,
      website: null,
      providerId: null,
      instagramUsername: null,
      city: "Ahmedabad",
    });
    expect(r.status).toBe("MATCHED");
    expect(r.confidence).toBeGreaterThanOrEqual(75);
  });

  it("POSSIBLE: same name, different city — not merged", () => {
    const r = matchEntities(google, {
      businessName: "ABC Plastics",
      phone: null,
      website: null,
      providerId: null,
      instagramUsername: null,
      city: "Delhi",
    });
    expect(r.status).toBe("POSSIBLE");
  });

  it("POSSIBLE: Instagram username matches the name slug", () => {
    const r = matchEntities(
      {
        businessName: null,
        phone: null,
        website: null,
        providerId: null,
        instagramUsername: "abcplastics",
        city: null,
      },
      {
        businessName: "ABC Plastics",
        phone: null,
        website: null,
        providerId: null,
        instagramUsername: null,
        city: "Ahmedabad",
      },
    );
    expect(r.status).toBe("POSSIBLE");
  });

  it("NOT_MATCHED: clearly different businesses", () => {
    const r = matchEntities(google, {
      businessName: "XYZ Textiles",
      phone: "+91 11111 22222",
      website: "https://xyztextiles.com",
      providerId: null,
      instagramUsername: null,
      city: "Ahmedabad",
    });
    expect(r.status).toBe("NOT_MATCHED");
  });

  it("UNKNOWN: not enough signal to judge", () => {
    const r = matchEntities(
      { businessName: null, phone: null, website: null, providerId: null, instagramUsername: "somehandle", city: null },
      { businessName: null, phone: null, website: null, providerId: null, instagramUsername: null, city: null },
    );
    expect(r.status).toBe("UNKNOWN");
  });
});
