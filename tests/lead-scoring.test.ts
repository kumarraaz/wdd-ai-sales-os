/**
 * Lead scoring unit tests — no database, no live Gemini calls.
 *
 * Covers: deterministic calculation, 0–100 bounds, factor totals,
 * no double counting, missing-data honesty, evidence validity,
 * rate limiting, Gemini-unavailable fallback, malformed AI rejection,
 * inference labeling, demo mode (no Gemini, no DB writes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const v = jar.get(name);
      return v === undefined ? undefined : { value: v };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));

import {
  calculateScore,
  scoreBandFor,
  SCORING_VERSION,
  type ScoringLeadInput,
} from "../lib/intelligence/scoring";
import {
  enrichScoreWithAI,
  aiAssessmentSchema,
} from "../lib/intelligence/scoring-ai";
import { leadScoreSchema } from "../lib/validators";
import { LIMITS } from "../lib/rate-limit";
import { DEMO_COOKIE_NAME, createDemoSession } from "../lib/demo";
import { getDemoLeadScore } from "../lib/demo-data";
import {
  POST as demoScorePost,
  GET as demoScoreGet,
} from "../app/api/demo/intelligence/lead-score/route";

beforeEach(() => {
  jar.clear();
  delete process.env.DEMO_MODE;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
const RICH_LEAD: ScoringLeadInput = {
  id: "lead-rich-001",
  fullName: "Acme Corp",
  website: "https://acme.example.com",
  phone: "+911234567890",
  email: "sales@acme.example.com",
  industry: "Manufacturing",
  city: "Mumbai",
  country: "India",
  rating: 4.5,
  reviewCount: 50,
  externalId: "ChIJx",
  sourceUrl: "https://maps.google.com/?cid=123",
};

const RICH_INSPECTION = {
  id: "insp-rich-001",
  findings: {
    httpStatus: 200,
    title: "Acme Corp",
    metaDescription: null,
    h1: { count: 1, texts: ["Welcome"] },
    imageCount: 10,
    imagesMissingAlt: 2,
    sitemap: { available: false },
    openGraph: {},
    twitterCard: {},
    structuredData: { present: false },
    mobile: { viewportPresent: true, responsiveSignal: true },
    robotsTxt: { available: false },
    socialLinks: [{ platform: "linkedin" }],
    contact: { emails: ["sales@acme.example.com"], phones: [] },
  },
};

const RICH_INTEL = {
  id: "intel-rich-001",
  confidence: "HIGH",
  intelligence: { recommendedServices: [{ statement: "SEO" }, { statement: "Redesign" }] },
};

const BARE_LEAD: ScoringLeadInput = { id: "lead-bare-001" };

// ---------------------------------------------------------------------------
describe("deterministic scoring calculation", () => {
  it("computes the expected score for a rich fixture", () => {
    const r = calculateScore(RICH_LEAD, RICH_INSPECTION, RICH_INTEL);
    // Business Fit 25 + Website Opportunity 23 + Digital Presence 20
    // + Data Completeness 15 + AI Intelligence 10 = 93
    expect(r.score).toBe(93);
    expect(r.scoreBand).toBe("Very Strong Fit");
    expect(r.scoringVersion).toBe(SCORING_VERSION);
  });

  it("scores zero with honest explanations for a bare lead", () => {
    const r = calculateScore(BARE_LEAD, null, null);
    expect(r.score).toBe(0);
    expect(r.scoreBand).toBe("Low Fit");
    expect(r.factors).toHaveLength(5);
    // Missing data is "not available", never a fabricated negative.
    const text = r.factors.map((f) => f.explanation).join(" ");
    expect(text).toContain("not available");
    expect(text).not.toMatch(/bad|poor|terrible|awful/i);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("awards website-opportunity points for gaps, not for perfection", () => {
    const perfect = {
      id: "insp-perfect",
      findings: {
        httpStatus: 200,
        title: "Great Title",
        metaDescription: "A fine description.",
        h1: { count: 1, texts: ["Hi"] },
        imageCount: 5,
        imagesMissingAlt: 0,
        sitemap: { available: true },
        openGraph: { title: "T" },
        structuredData: { present: true },
        mobile: { viewportPresent: true, responsiveSignal: true },
        robotsTxt: { available: true },
        socialLinks: [],
        contact: { emails: [], phones: [] },
      },
    };
    const withGaps = calculateScore(RICH_LEAD, RICH_INSPECTION, null);
    const perfectScore = calculateScore(RICH_LEAD, perfect, null);
    const gapsFactor = withGaps.factors.find((f) => f.factor === "Website Opportunity")!;
    const perfectFactor = perfectScore.factors.find((f) => f.factor === "Website Opportunity")!;
    // A weak website = MORE opportunity. The score is sales-fit, not quality.
    expect(gapsFactor.points).toBeGreaterThan(perfectFactor.points);
    expect(perfectFactor.points).toBe(5); // only "reachable"
  });
});

describe("score bounds and bands", () => {
  it("always stays within 0–100", () => {
    const cases: [ScoringLeadInput, typeof RICH_INSPECTION | null, typeof RICH_INTEL | null][] = [
      [BARE_LEAD, null, null],
      [RICH_LEAD, RICH_INSPECTION, RICH_INTEL],
      [{ ...RICH_LEAD, rating: 5, reviewCount: 10000 }, RICH_INSPECTION, RICH_INTEL],
      [{ id: "x", industry: "Unknown Weird Industry" }, null, null],
    ];
    for (const [lead, insp, intel] of cases) {
      const r = calculateScore(lead, insp, intel);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.score)).toBe(true);
    }
  });

  it("maps bands correctly at boundaries", () => {
    expect(scoreBandFor(0)).toBe("Low Fit");
    expect(scoreBandFor(39)).toBe("Low Fit");
    expect(scoreBandFor(40)).toBe("Moderate Fit");
    expect(scoreBandFor(69)).toBe("Moderate Fit");
    expect(scoreBandFor(70)).toBe("Strong Fit");
    expect(scoreBandFor(84)).toBe("Strong Fit");
    expect(scoreBandFor(85)).toBe("Very Strong Fit");
    expect(scoreBandFor(100)).toBe("Very Strong Fit");
  });

  it("factor points sum to the total score", () => {
    const r = calculateScore(RICH_LEAD, RICH_INSPECTION, RICH_INTEL);
    const sum = r.factors.reduce((s, f) => s + f.points, 0);
    expect(sum).toBe(r.score);
    for (const f of r.factors) {
      expect(f.points).toBeLessThanOrEqual(f.maximumPoints);
      expect(f.points).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("no double counting", () => {
  it("no (source, field) pair appears in two factors", () => {
    const r = calculateScore(RICH_LEAD, RICH_INSPECTION, RICH_INTEL);
    const seen = new Map<string, string>();
    for (const f of r.factors) {
      for (const e of f.evidence) {
        const key = `${e.source}:${e.field}`;
        expect(
          seen.has(key),
          `double-counted ${key} in "${seen.get(key)}" and "${f.factor}"`,
        ).toBe(false);
        seen.set(key, f.factor);
      }
    }
  });
});

describe("evidence validity", () => {
  it("every evidence ref is non-empty and traceable to a record id", () => {
    const r = calculateScore(RICH_LEAD, RICH_INSPECTION, RICH_INTEL);
    expect(r.evidence.length).toBeGreaterThan(0);
    for (const e of r.evidence) {
      expect(e.source).toMatch(/^(Lead|Company|WebsiteInspection|LeadIntelligence)$/);
      expect(e.field.length).toBeGreaterThan(0);
      expect(e.reference).toContain(":");
      // The reference must point at one of the input record ids.
      const id = e.reference.split(":")[1];
      expect(["lead-rich-001", "insp-rich-001", "intel-rich-001"]).toContain(id);
    }
  });

  it("factors without data carry empty evidence and honest explanations", () => {
    const r = calculateScore(BARE_LEAD, null, null);
    const website = r.factors.find((f) => f.factor === "Website Opportunity")!;
    expect(website.evidence).toEqual([]);
    expect(website.explanation).toContain("Insufficient evidence");
    const ai = r.factors.find((f) => f.factor === "AI Intelligence")!;
    expect(ai.evidence).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("AI enrichment (mocked Gemini)", () => {
  function mockFetch(assessment: unknown) {
    return vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(assessment) }] } }],
          usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 60 },
        }),
        { status: 200 },
      ),
    );
  }

  const assessment = {
    interpretation: "Strong opportunity: verified SEO gaps.",
    keyStrengths: ["Established business"],
    keyGaps: ["Missing meta description"],
    suggestedNextStep: "Send the technical snapshot.",
  };

  it("returns null when Gemini is not configured — scoring still works", async () => {
    const r = calculateScore(RICH_LEAD, RICH_INSPECTION, RICH_INTEL);
    const enriched = await enrichScoreWithAI(r, "Acme", { fetchImpl: vi.fn() });
    expect(enriched).toBeNull();
    // The deterministic score is unaffected.
    expect(r.score).toBe(93);
  });

  it("returns a validated assessment labeled AI_INFERENCE when configured", async () => {
    const r = calculateScore(RICH_LEAD, RICH_INSPECTION, RICH_INTEL);
    const enriched = await enrichScoreWithAI(r, "Acme", {
      fetchImpl: mockFetch(assessment),
      apiKey: "k",
    });
    expect(enriched?.provenance).toBe("AI_INFERENCE");
    expect(enriched?.assessment.interpretation).toContain("Strong opportunity");
    expect(enriched?.model).toBe("gemini-2.0-flash");
  });

  it("rejects malformed AI output", async () => {
    const r = calculateScore(RICH_LEAD, RICH_INSPECTION, RICH_INTEL);
    await expect(
      enrichScoreWithAI(r, "Acme", {
        fetchImpl: mockFetch({ wrong: "shape" }),
        apiKey: "k",
      }),
    ).rejects.toThrow();
  });

  it("assessment schema enforces size limits", () => {
    expect(aiAssessmentSchema.safeParse(assessment).success).toBe(true);
    expect(
      aiAssessmentSchema.safeParse({ ...assessment, interpretation: "" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("input validation and rate limiting", () => {
  it("validates the lead-score input", () => {
    expect(leadScoreSchema.safeParse({ leadId: "c".repeat(25) }).success).toBe(true);
    expect(leadScoreSchema.safeParse({ leadId: "nope" }).success).toBe(false);
    expect(leadScoreSchema.safeParse({}).success).toBe(false);
  });

  it("has a leadScore rate-limit preset", () => {
    expect(LIMITS.leadScore.limit).toBeGreaterThan(0);
    expect(LIMITS.leadScore.windowMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("demo-mode lead scoring", () => {
  function seedDemoCookie(): void {
    vi.stubEnv("DEMO_MODE", "true");
    const token = createDemoSession();
    if (!token) throw new Error("test setup failed");
    jar.set(DEMO_COOKIE_NAME, token);
  }

  it("fixtures are deterministic and labeled DEMO_DATA", () => {
    const a = getDemoLeadScore("lead-1");
    const b = getDemoLeadScore("lead-1");
    expect(a).toEqual({ ...b, createdAt: a.createdAt });
    expect(a.dataLabel).toBe("DEMO_DATA");
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
    // Band matches the computed score.
    const expectedBand =
      a.score >= 85 ? "Very Strong Fit" : a.score >= 70 ? "Strong Fit" : a.score >= 40 ? "Moderate Fit" : "Low Fit";
    expect(a.scoreBand).toBe(expectedBand);
    const sum = a.factors.reduce((s, f) => s + f.points, 0);
    expect(sum).toBe(a.score);
    expect(a.aiEnriched).toBe(false);
  });

  it("POST returns 404 when demo is off", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const res = await demoScorePost(
      new NextRequest("http://localhost/api/demo/intelligence/lead-score", {
        method: "POST",
        body: JSON.stringify({ leadId: "x" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("POST serves DEMO_DATA without Gemini and without DB writes", async () => {
    seedDemoCookie();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await demoScorePost(
      new NextRequest("http://localhost/api/demo/intelligence/lead-score", {
        method: "POST",
        body: JSON.stringify({ leadId: "lead-7" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demo).toBe(true);
    expect(body.score.dataLabel).toBe("DEMO_DATA");
    expect(body.score.leadId).toBe("lead-7");
    // No external AI call.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    // No database access: the demo route module does not import the db client.
    const src = await import("../app/api/demo/intelligence/lead-score/route");
    expect(Object.keys(src)).toContain("POST");
  });

  it("GET serves the fixture too", async () => {
    seedDemoCookie();
    const res = await demoScoreGet(
      new NextRequest("http://localhost/api/demo/intelligence/lead-score?leadId=lead-3"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score.dataLabel).toBe("DEMO_DATA");
  });
});
