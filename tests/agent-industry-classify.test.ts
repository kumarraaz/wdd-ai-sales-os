/**
 * Industry classifier tests.
 *
 * - Without an AI provider: deterministic fallback, labeled honestly.
 * - With an AI provider (mocked): source-backed classification.
 * - AI failure: falls back to deterministic, never throws, never invents.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyIndustry } from "../lib/prospecting/industry-classify";

const evidence = {
  businessName: "ABC Plastics",
  category: "Plastic manufacturer",
  location: "Ahmedabad, India",
  website: "https://abcplastics.com",
  observations: "Manufactures plastic packaging products.",
  sourceLabels: ["Google Places"],
};

describe("classifyIndustry (deterministic fallback — no AI configured)", () => {
  beforeEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
  });
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  it("matches the target industry deterministically and labels itself", async () => {
    const r = await classifyIndustry(evidence, "manufacturers");
    expect(r.classifiedBy).toBe("deterministic");
    expect(r.relevanceScore).toBe(85);
    expect(r.reasoning).toContain("Deterministic keyword match");
  });

  it("scores low when there is no keyword evidence", async () => {
    const r = await classifyIndustry(
      { ...evidence, category: "Bakery", observations: "Sells cakes." },
      "manufacturers",
    );
    expect(r.classifiedBy).toBe("deterministic");
    expect(r.relevanceScore).toBe(20);
  });
});

describe("classifyIndustry (AI path)", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    vi.restoreAllMocks();
  });

  it("returns the AI classification with source-backed reasoning", async () => {
    const { GeminiProvider } = await import("../lib/ai/providers/gemini");
    vi.spyOn(GeminiProvider.prototype, "isConfigured").mockReturnValue(true);
    vi.spyOn(GeminiProvider.prototype, "generateJson").mockResolvedValue({
      text: JSON.stringify({
        industry: "Plastic Manufacturing",
        subIndustry: "Packaging",
        relevanceScore: 94,
        reasoning: "Business publicly describes manufacturing plastic packaging products (Google Places).",
      }),
    } as never);

    const r = await classifyIndustry(evidence, "Manufacturers & Industrial Suppliers");
    expect(r.classifiedBy).toBe("ai");
    expect(r.industry).toBe("Plastic Manufacturing");
    expect(r.subIndustry).toBe("Packaging");
    expect(r.relevanceScore).toBe(94);
    expect(r.reasoning).toContain("Google Places");
  });

  it("falls back to deterministic when the AI call fails", async () => {
    const { GeminiProvider } = await import("../lib/ai/providers/gemini");
    vi.spyOn(GeminiProvider.prototype, "isConfigured").mockReturnValue(true);
    vi.spyOn(GeminiProvider.prototype, "generateJson").mockRejectedValue(
      new Error("boom"),
    );

    const r = await classifyIndustry(evidence, "manufacturers");
    expect(r.classifiedBy).toBe("deterministic");
    expect(r.relevanceScore).toBe(85);
  });

  it("skipAi forces the deterministic path even when AI is configured", async () => {
    const r = await classifyIndustry(evidence, "manufacturers", { skipAi: true });
    expect(r.classifiedBy).toBe("deterministic");
  });
});
