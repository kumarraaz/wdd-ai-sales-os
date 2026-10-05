/**
 * Prospecting agent tool tests (autonomous sales agent phase).
 *
 * The three new tools are thin wrappers over lib/prospecting/* — tested
 * through the real verification layer (no mocks of the logic itself).
 */
import { describe, it, expect } from "vitest";
import { executeTool, listTools } from "../lib/agent/tools/registry";
import "../lib/agent/tools/index"; // central registration
import type { WorkspaceContext } from "../lib/agent/tools/registry";

const ctx: WorkspaceContext = {
  user: { id: "user-1", email: "u@example.com", name: "Test User" },
  organization: { id: "org-A", name: "Org A", slug: "org-a" },
  membership: { id: "mem-1", role: "ADMIN" },
};

const candidate = {
  businessName: "ABC Plastics",
  category: "Plastic manufacturer",
  city: "Ahmedabad",
  country: "India",
  website: "https://abcplastics.com",
  phone: "+91 98765 43210",
  instagramUsername: null,
  providerId: null,
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
};

describe("prospecting tool registration", () => {
  it("registers the three prospecting tools with stable names", () => {
    const names = listTools();
    expect(names).toContain("prospecting.verifyCandidate");
    expect(names).toContain("prospecting.classifyIndustry");
    expect(names).toContain("prospecting.matchEntities");
  });
});

describe("prospecting.verifyCandidate", () => {
  it("returns a source-backed verdict", async () => {
    const result = await executeTool("prospecting.verifyCandidate", ctx, candidate);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { confidence: string; reason: string };
      expect(data.confidence).toBe("MEDIUM");
      expect(data.reason).toContain("Google Places");
    }
  });

  it("rejects a candidate with no identity", async () => {
    const result = await executeTool("prospecting.verifyCandidate", ctx, {
      ...candidate,
      businessName: null,
      phone: null,
      website: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { confidence: string }).confidence).toBe("REJECTED");
    }
  });

  it("invalid input fails safely", async () => {
    const result = await executeTool("prospecting.verifyCandidate", ctx, {
      ...candidate,
      targetIndustry: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("prospecting.classifyIndustry", () => {
  it("returns deterministic classification without AI", async () => {
    const result = await executeTool("prospecting.classifyIndustry", ctx, {
      businessName: "ABC Plastics",
      category: "Plastic manufacturer",
      location: "Ahmedabad, India",
      website: "https://abcplastics.com",
      observations: null,
      sourceLabels: ["Google Places"],
      targetIndustry: "manufacturers",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { classifiedBy: string; relevanceScore: number };
      expect(data.classifiedBy).toBe("deterministic");
      expect(data.relevanceScore).toBe(85);
    }
  });
});

describe("prospecting.matchEntities", () => {
  it("detects the same business across sources", async () => {
    const result = await executeTool("prospecting.matchEntities", ctx, {
      a: { businessName: "ABC Plastics Pvt Ltd", phone: "+91 98765 43210", city: "Ahmedabad" },
      b: { businessName: "ABC Plastics", phone: null, city: "Ahmedabad" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { status: string }).status).toBe("MATCHED");
    }
  });

  it("refuses to merge different businesses", async () => {
    const result = await executeTool("prospecting.matchEntities", ctx, {
      a: { businessName: "ABC Plastics", phone: "+91 98765 43210", city: "Ahmedabad" },
      b: { businessName: "XYZ Textiles", phone: "+91 11111 22222", city: "Ahmedabad" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { status: string }).status).toBe("NOT_MATCHED");
    }
  });
});
