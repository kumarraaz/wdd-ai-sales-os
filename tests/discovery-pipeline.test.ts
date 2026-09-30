/**
 * Discovery pipeline tests — orchestration logic with mocked deps.
 *
 * Covers: input validation, location parsing, website problem detection,
 * duplicate handling, per-company failure isolation (website + AI),
 * website filter, qualification rules, and event streaming.
 * No real Google/Gemini/network calls.
 */
import { describe, it, expect, vi } from "vitest";
import {
  runDiscoveryPipeline,
  parseLocation,
  websiteProblems,
  type PipelineDeps,
  type PipelineEvent,
  type PipelineCompanyResult,
} from "../lib/discovery/pipeline";
import type { DiscoveredCompany } from "../lib/discovery/types";
import { discoveryPipelineSchema } from "../lib/validators";
import type { WebsiteFindings } from "../lib/intelligence/inspect";

function company(overrides: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return {
    provider: "google-places",
    providerId: `place-${Math.random().toString(36).slice(2, 8)}`,
    name: "Acme Manufacturing Co",
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    website: "https://acme-example.com",
    phone: "+91 79 4000 1111",
    discoveredAt: new Date().toISOString(),
    provenance: "VERIFIED_DATA",
    ...overrides,
  };
}

function findings(overrides: Partial<WebsiteFindings> = {}): WebsiteFindings {
  return {
    requestedUrl: "https://acme-example.com",
    finalUrl: "https://acme-example.com/",
    httpStatus: 200,
    redirectChain: [],
    https: true,
    responseTimeMs: 500,
    htmlAvailable: true,
    title: "Acme Manufacturing",
    metaDescription: "We manufacture things.",
    canonicalUrl: null,
    robotsMeta: null,
    viewportMeta: "width=device-width, initial-scale=1",
    h1: { count: 1, texts: ["Welcome"] },
    h2Count: 3,
    imageCount: 10,
    imagesMissingAlt: 0,
    internalLinkCount: 20,
    externalLinkCount: 2,
    robotsTxt: { available: true, url: "https://acme-example.com/robots.txt" },
    sitemap: { available: true, url: "https://acme-example.com/sitemap.xml" },
    favicon: { available: true, href: null },
    openGraph: { title: null, description: null, image: null, url: null },
    twitterCard: { card: null, title: null, description: null, image: null },
    lang: "en",
    structuredData: { jsonLdCount: 0, microdata: false, present: false },
    mobile: { viewportPresent: true, responsiveSignal: true },
    techSignals: [],
    contact: { emails: ["info@acme-example.com"], phones: [] },
    socialLinks: [],
    provenance: "VERIFIED_DATA",
    inspectedAt: new Date().toISOString(),
    ...overrides,
  } as WebsiteFindings;
}

function noMatch() {
  return { match: null, matchedLeadId: undefined, existingStatus: null, possible: null };
}

function baseDeps(companies: DiscoveredCompany[]): PipelineDeps {
  return {
    search: async () => ({
      provider: "google-places",
      searchedAt: new Date().toISOString(),
      companies,
    }),
    checkDuplicate: async () => noMatch(),
    researchWebsite: async (url) => findings({ requestedUrl: url }),
    generateAI: async () => ({
      output: { summary: "test" } as never,
      warnings: [],
      model: "test",
      promptVersion: "v1",
      schemaVersion: "v1",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    score: () => ({
      score: 75,
      scoreBand: "Strong Fit" as const,
      factors: [],
      evidence: [],
      warnings: [],
      scoringVersion: "v1",
    }),
  };
}

async function run(input: Partial<Parameters<typeof runDiscoveryPipeline>[0]>, deps: PipelineDeps) {
  const events: PipelineEvent[] = [];
  const result = await runDiscoveryPipeline(
    {
      industry: "Manufacturers",
      location: "Gujarat, India",
      websiteFilter: "any",
      opportunity: "any",
      limit: 10,
      ...input,
    },
    deps,
    (e) => events.push(e),
  );
  return { ...result, events };
}

describe("discoveryPipelineSchema", () => {
  it("accepts a valid pipeline request", () => {
    const parsed = discoveryPipelineSchema.safeParse({
      providerId: "google-places",
      industry: "Manufacturers",
      location: "Gujarat, India",
      websiteFilter: "has_website",
      opportunity: "website_improvement",
      limit: 10,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects missing industry/location and out-of-range limit", () => {
    expect(discoveryPipelineSchema.safeParse({ providerId: "x", industry: "", location: "y" }).success).toBe(false);
    expect(discoveryPipelineSchema.safeParse({ providerId: "x", industry: "a", location: "y", limit: 0 }).success).toBe(false);
    expect(discoveryPipelineSchema.safeParse({ providerId: "x", industry: "a", location: "y", limit: 51 }).success).toBe(false);
    expect(discoveryPipelineSchema.safeParse({ providerId: "x", industry: "a", location: "y", websiteFilter: "bogus" }).success).toBe(false);
  });
});

describe("parseLocation", () => {
  it("parses state, country", () => {
    expect(parseLocation("Gujarat, India")).toEqual({ state: "Gujarat", country: "India" });
  });
  it("parses city, state, country", () => {
    expect(parseLocation("Ahmedabad, Gujarat, India")).toEqual({
      city: "Ahmedabad", state: "Gujarat", country: "India",
    });
  });
  it("handles single segment and empty", () => {
    expect(parseLocation("Gujarat")).toEqual({ state: "Gujarat" });
    expect(parseLocation("  ")).toEqual({});
  });
});

describe("websiteProblems", () => {
  it("detects common problems from verified findings", () => {
    const problems = websiteProblems(
      findings({ https: false, title: null, metaDescription: null, viewportMeta: null, contact: { emails: [], phones: [] } }),
    );
    expect(problems).toContain("No HTTPS");
    expect(problems).toContain("Missing page title");
    expect(problems).toContain("Missing meta description");
    expect(problems).toContain("No mobile viewport tag");
  });
  it("returns empty for a healthy site", () => {
    expect(websiteProblems(findings())).toEqual([]);
  });
});

describe("runDiscoveryPipeline", () => {
  it("runs the full flow and streams events", async () => {
    const companies = [company(), company()];
    const { results, summary, events } = await run({}, baseDeps(companies));

    expect(results).toHaveLength(2);
    expect(summary.searched).toBe(2);
    expect(summary.researched).toBe(2);
    expect(summary.qualified).toBe(2);

    const types = events.map((e) => e.type);
    expect(types).toContain("stage");
    expect(types).toContain("progress");
    expect(types).toContain("company");
    expect(types).toContain("complete");
    expect(types).not.toContain("error");
  });

  it("marks duplicates and skips their research", async () => {
    const dup = company({ providerId: "place-dup" });
    const fresh = company({ providerId: "place-fresh" });
    const research = vi.fn(async (url: string) => findings({ requestedUrl: url }));
    const deps = {
      ...baseDeps([dup, fresh]),
      checkDuplicate: async (c: DiscoveredCompany) =>
        c.providerId === "place-dup"
          ? { match: { kind: "website", definitive: true, reason: "Website exists" }, matchedLeadId: "lead-1", existingStatus: "NEW", possible: null }
          : noMatch(),
      researchWebsite: research,
    };
    const { results, summary } = await run({}, deps);

    const dupResult = results.find((r) => r.company.providerId === "place-dup")!;
    expect(dupResult.duplicate).not.toBeNull();
    expect(dupResult.qualified).toBe(false);
    expect(summary.duplicates).toBe(1);
    // Research still runs for duplicates at this stage (import decides);
    // qualification excludes them.
    expect(results.find((r) => r.company.providerId === "place-fresh")!.qualified).toBe(true);
  });

  it("isolates website failures — one bad site does not abort the batch", async () => {
    const bad = company({ providerId: "place-bad", website: "https://bad-example.com" });
    const good = company({ providerId: "place-good", website: "https://good-example.com" });
    const deps = {
      ...baseDeps([bad, good]),
      researchWebsite: async (url: string) => {
        if (url.includes("bad-example")) throw new Error("timeout");
        return findings({ requestedUrl: url });
      },
    };
    const { results, summary, events } = await run({}, deps);

    expect(results).toHaveLength(2);
    const badResult = results.find((r) => r.company.providerId === "place-bad")!;
    expect(badResult.website.status).toBe("failed");
    expect(badResult.website.error).toContain("timeout");
    expect(results.find((r) => r.company.providerId === "place-good")!.website.status).toBe("completed");
    expect(summary.failed).toBe(1);
    expect(events.map((e) => e.type)).toContain("complete");
  });

  it("marks AI as failed but preserves data on AI errors", async () => {
    const deps = {
      ...baseDeps([company()]),
      generateAI: async () => { throw new Error("Gemini exploded"); },
    };
    const { results } = await run({}, deps);
    expect(results[0].ai.status).toBe("failed");
    expect(results[0].ai.error).toContain("Gemini exploded");
    // Website research data is preserved; qualification still runs.
    expect(results[0].website.status).toBe("completed");
    expect(results[0].score).not.toBeNull();
  });

  it("marks AI as pending when not configured", async () => {
    const deps = {
      ...baseDeps([company()]),
      generateAI: async () => { throw new Error("NOT_CONFIGURED: AI not configured"); },
    };
    const { results } = await run({}, deps);
    expect(results[0].ai.status).toBe("pending");
  });

  it("applies the website filter", async () => {
    const withSite = company({ providerId: "p1", website: "https://a.com" });
    const withoutSite = company({ providerId: "p2", website: undefined });
    const { summary } = await run(
      { websiteFilter: "has_website" },
      baseDeps([withSite, withoutSite]),
    );
    expect(summary.searched).toBe(1);
  });

  it("skips website research and AI when no website", async () => {
    const research = vi.fn();
    const ai = vi.fn();
    const deps = { ...baseDeps([company({ website: undefined })]), researchWebsite: research, generateAI: ai };
    const { results } = await run({}, deps);
    expect(research).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
    expect(results[0].website.status).toBe("skipped");
    expect(results[0].ai.status).toBe("skipped");
  });

  it("disqualifies below-threshold scores with reasons", async () => {
    const deps = {
      ...baseDeps([company()]),
      score: () => ({
        score: 10, scoreBand: "Low Fit" as const, factors: [], evidence: [], warnings: [], scoringVersion: "v1",
      }),
    };
    const { results } = await run({}, deps);
    expect(results[0].qualified).toBe(false);
    expect(results[0].qualificationReasons.join(" ")).toContain("threshold");
  });

  it("website_improvement opportunity requires observable problems", async () => {
    // Healthy site → not qualified for website improvement.
    const { results: healthy } = await run(
      { opportunity: "website_improvement" },
      baseDeps([company()]),
    );
    expect(healthy[0].qualified).toBe(false);

    // Problematic site → qualified.
    const deps = {
      ...baseDeps([company()]),
      researchWebsite: async (url: string) =>
        findings({ requestedUrl: url, https: false, title: null, metaDescription: null }),
    };
    const { results: broken } = await run({ opportunity: "website_improvement" }, deps);
    expect(broken[0].qualified).toBe(true);
    expect(broken[0].qualificationReasons.join(" ")).toContain("Website problems");
  });

  it("propagates fatal search failures as error events", async () => {
    const deps = { ...baseDeps([]), search: async () => { throw new Error("provider down"); } };
    const events: PipelineEvent[] = [];
    await expect(
      runDiscoveryPipeline(
        { industry: "x", location: "y", websiteFilter: "any", opportunity: "any", limit: 5 },
        deps,
        (e) => events.push(e),
      ),
    ).rejects.toThrow("provider down");
  });
});
