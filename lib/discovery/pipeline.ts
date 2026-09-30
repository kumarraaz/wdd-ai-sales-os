/**
 * Lead Discovery + Research pipeline orchestrator (Phase 2).
 *
 * Chains the existing building blocks into one guided flow:
 *   provider search → duplicate detection → website research →
 *   AI research → transparent qualification.
 *
 * Design rules:
 * - Pure orchestration: no direct DB access here (the API route owns
 *   persistence, quota, and audit). Duplicate checking, website research,
 *   and AI generation are injected so demo mode can substitute fixtures.
 * - Failure isolation: one company's website/AI failure never aborts the
 *   batch — the item is marked failed/pending with a reason.
 * - Progress is reported through the onEvent callback; the API route turns
 *   these into SSE events so the UI never blocks.
 * - Nothing is invented: every field comes from the provider, the website
 *   inspection, or the AI output, each carrying its provenance.
 */
import {
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoveredCompany,
} from "./types";
import type { CompanyMatch } from "./import";
import type { WebsiteFindings } from "../intelligence/inspect";
import type { LeadIntelligenceOutput } from "../intelligence/intelligence-schema";
import type { ScoreResult } from "../intelligence/scoring";
import type {
  AIInputLead,
  AIInputCompany,
  AIInputInspection,
} from "../intelligence/prompt";
import type { GenerateIntelligenceResult } from "../intelligence/generate";

export type WebsiteFilter = "any" | "has_website" | "no_website";
export type OpportunityKind =
  | "website_improvement"
  | "new_website"
  | "seo"
  | "any";

export interface PipelineInput {
  industry: string;
  location: string;
  websiteFilter: WebsiteFilter;
  opportunity: OpportunityKind;
  /** 1..50 requested; providers may cap per their own limits. */
  limit: number;
  category?: string;
}

export type PipelineStage =
  | "searching"
  | "deduping"
  | "researching"
  | "analyzing"
  | "qualifying";

export interface PipelineStageEvent {
  type: "stage";
  stage: PipelineStage;
  message: string;
}

export interface PipelineProgressEvent {
  type: "progress";
  stage: PipelineStage;
  completed: number;
  total: number;
}

export interface PipelineCompanyEvent {
  type: "company";
  result: PipelineCompanyResult;
}

export interface PipelineCompleteEvent {
  type: "complete";
  summary: PipelineSummary;
}

export interface PipelineErrorEvent {
  type: "error";
  message: string;
}

export type PipelineEvent =
  | PipelineStageEvent
  | PipelineProgressEvent
  | PipelineCompanyEvent
  | PipelineCompleteEvent
  | PipelineErrorEvent;

export type WebsiteResearchStatus = "completed" | "failed" | "skipped";
export type AIResearchStatus = "completed" | "failed" | "pending" | "skipped";

export interface PipelineCompanyResult {
  company: DiscoveredCompany;
  duplicate: { reason: string; matchedLeadId?: string } | null;
  website: {
    status: WebsiteResearchStatus;
    findings?: WebsiteFindings;
    error?: string;
  };
  ai: {
    status: AIResearchStatus;
    output?: LeadIntelligenceOutput;
    warnings?: string[];
    error?: string;
  };
  score: ScoreResult | null;
  qualified: boolean;
  qualificationReasons: string[];
}

export interface PipelineSummary {
  searched: number;
  researched: number;
  analyzed: number;
  qualified: number;
  duplicates: number;
  failed: number;
}

/** Injected capabilities — real implementations or demo fixtures. */
export interface PipelineDeps {
  /** Run the provider search. */
  search: (query: DiscoveryQuery) => Promise<DiscoveryResult>;
  /** Duplicate check for one company (read-only). */
  checkDuplicate: (company: DiscoveredCompany) => Promise<CompanyMatch>;
  /** Website research for one URL. Throws on failure. */
  researchWebsite: (url: string) => Promise<WebsiteFindings>;
  /**
   * AI research. Throws on failure; implementations should throw a
   * distinguishable error when AI is not configured (→ "pending").
   */
  generateAI: (
    lead: AIInputLead,
    company: AIInputCompany | null,
    inspection: AIInputInspection | null,
  ) => Promise<GenerateIntelligenceResult>;
  /** Transparent scoring (pure). */
  score: (
    lead: AIInputLead,
    inspection: AIInputInspection | null,
  ) => ScoreResult;
}

/**
 * Parse a free-text location like "Gujarat, India" or "Ahmedabad, Gujarat, India"
 * into provider query parts. Transparent and predictable: last segment is the
 * country, the rest are state then city.
 */
export function parseLocation(location: string): {
  city?: string;
  state?: string;
  country?: string;
} {
  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { state: parts[0] };
  if (parts.length === 2) return { state: parts[0], country: parts[1] };
  return { city: parts[0], state: parts[1], country: parts.slice(2).join(", ") };
}

/** Observable website problems from verified inspection findings. */
export function websiteProblems(findings: WebsiteFindings): string[] {
  const problems: string[] = [];
  if (findings.httpStatus < 200 || findings.httpStatus >= 400) {
    problems.push(`Website returns HTTP ${findings.httpStatus}`);
  }
  if (!findings.https) problems.push("No HTTPS");
  if (!findings.title) problems.push("Missing page title");
  if (!findings.metaDescription) problems.push("Missing meta description");
  if (findings.h1.count === 0) problems.push("No H1 heading");
  if (!findings.viewportMeta) problems.push("No mobile viewport tag");
  if (findings.imagesMissingAlt > 0) {
    problems.push(`${findings.imagesMissingAlt} images missing alt text`);
  }
  if (findings.contact.emails.length === 0 && findings.contact.phones.length === 0) {
    problems.push("No visible contact email or phone on homepage");
  }
  return problems;
}

function toAILead(company: DiscoveredCompany): AIInputLead {
  return {
    id: company.providerId,
    phone: company.phone ?? null,
    website: company.website ?? null,
    industry: company.category ?? null,
    city: company.city ?? null,
    country: company.country ?? null,
    location: [company.city, company.state, company.country]
      .filter(Boolean)
      .join(", "),
    sourceType: company.provider,
    externalId: company.providerId,
    sourceUrl: company.sourceUrl ?? null,
    rating: company.rating ?? null,
    reviewCount: company.reviewCount ?? null,
  };
}

function toAICompany(company: DiscoveredCompany): AIInputCompany {
  return {
    id: company.providerId,
    name: company.name,
    website: company.website ?? null,
    industry: company.category ?? null,
    city: company.city ?? null,
    country: company.country ?? null,
    location: [company.city, company.state, company.country]
      .filter(Boolean)
      .join(", "),
  };
}

function toAIInspection(
  company: DiscoveredCompany,
  findings: WebsiteFindings,
): AIInputInspection {
  return {
    id: company.providerId,
    requestedUrl: findings.requestedUrl,
    findings: findings as unknown as Record<string, unknown>,
  };
}

/** Bounded-parallel map: limits concurrent website/AI calls. */
async function mapParallel<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let completed = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      completed++;
      onProgress?.(completed, items.length);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function qualify(
  company: DiscoveredCompany,
  duplicate: PipelineCompanyResult["duplicate"],
  website: PipelineCompanyResult["website"],
  score: ScoreResult | null,
  opportunity: OpportunityKind,
): { qualified: boolean; reasons: string[] } {
  if (duplicate) {
    return { qualified: false, reasons: [`Already in CRM — ${duplicate.reason}`] };
  }
  const reasons: string[] = [];
  if (!score) {
    return { qualified: false, reasons: ["Could not be scored"] };
  }
  reasons.push(`Score ${score.score}/100 (${score.scoreBand})`);
  if (score.score < 40) {
    return { qualified: false, reasons: [...reasons, "Below qualification threshold (40)"] };
  }
  if (!company.website && !company.phone) {
    return { qualified: false, reasons: [...reasons, "No website or phone to reach them"] };
  }
  if (company.website) reasons.push("Public website available");
  if (company.phone) reasons.push("Public phone available");

  if (opportunity === "website_improvement") {
    if (website.status !== "completed" || !website.findings) {
      return {
        qualified: false,
        reasons: [...reasons, "Website could not be assessed for improvement opportunity"],
      };
    }
    const problems = websiteProblems(website.findings);
    if (problems.length === 0) {
      return {
        qualified: false,
        reasons: [...reasons, "Website shows no clear improvement problems"],
      };
    }
    reasons.push(`Website problems: ${problems.slice(0, 4).join("; ")}`);
  }
  if (opportunity === "new_website" && company.website) {
    return { qualified: false, reasons: [...reasons, "Already has a website"] };
  }
  return { qualified: true, reasons };
}

/**
 * Run the full pipeline. Streams PipelineEvents through onEvent.
 * Never throws for per-company failures — those are recorded on the item.
 * Throws only for fatal pipeline failures (search failed, etc.).
 */
export async function runDiscoveryPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
  onEvent: (event: PipelineEvent) => void,
): Promise<{ results: PipelineCompanyResult[]; summary: PipelineSummary }> {
  const loc = parseLocation(input.location);
  const query: DiscoveryQuery = {
    keyword: input.industry,
    city: loc.city,
    state: loc.state,
    country: loc.country,
    maxResults: Math.min(Math.max(input.limit, 1), 50),
    category: input.category,
  };

  // ── Stage 1: search ──────────────────────────────────────────────
  onEvent({ type: "stage", stage: "searching", message: "Searching businesses..." });
  const searchResult = await deps.search(query);
  let companies = searchResult.companies;
  onEvent({
    type: "stage",
    stage: "searching",
    message: `${companies.length} businesses found`,
  });

  // Website filter (transparent post-search filter).
  if (input.websiteFilter === "has_website") {
    companies = companies.filter((c) => !!c.website);
  } else if (input.websiteFilter === "no_website") {
    companies = companies.filter((c) => !c.website);
  }

  // ── Stage 2: duplicate detection ─────────────────────────────────
  onEvent({ type: "stage", stage: "deduping", message: "Checking for duplicates..." });
  const duplicates = await mapParallel(
    companies,
    5,
    async (company) => {
      const { match, matchedLeadId, possible } =
        await deps.checkDuplicate(company);
      if (match?.definitive) {
        return { reason: match.reason, matchedLeadId };
      }
      // Possible duplicates are NOT treated as duplicates here — they are
      // flagged at import time for human review.
      void possible;
      return null;
    },
    (completed, total) =>
      onEvent({ type: "progress", stage: "deduping", completed, total }),
  );

  // ── Stage 3: website research ────────────────────────────────────
  onEvent({ type: "stage", stage: "researching", message: "Researching websites..." });
  const websites = await mapParallel(
    companies,
    3,
    async (company): Promise<PipelineCompanyResult["website"]> => {
      if (!company.website) return { status: "skipped" };
      try {
        const findings = await deps.researchWebsite(company.website);
        return { status: "completed", findings };
      } catch (err) {
        // One website failing never aborts the batch.
        return {
          status: "failed",
          error: err instanceof Error ? err.message : "Website research failed",
        };
      }
    },
    (completed, total) =>
      onEvent({ type: "progress", stage: "researching", completed, total }),
  );

  // ── Stage 4: AI research ─────────────────────────────────────────
  onEvent({ type: "stage", stage: "analyzing", message: "Analyzing opportunities..." });
  const aiResults = await mapParallel(
    companies,
    2,
    async (company, i): Promise<PipelineCompanyResult["ai"]> => {
      const website = websites[i];
      // AI needs verified website data; without it there is nothing honest to analyze.
      if (website.status !== "completed" || !website.findings) {
        return { status: "skipped", error: "No website research to analyze" };
      }
      try {
        const result = await deps.generateAI(
          toAILead(company),
          toAICompany(company),
          toAIInspection(company, website.findings),
        );
        return {
          status: "completed",
          output: result.output,
          warnings: result.warnings,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "AI research failed";
        // Distinguish "not configured" (→ pending, retryable later) from
        // genuine failures. Never lose the collected data.
        const notConfigured = /NOT_CONFIGURED|not configured|API key/i.test(message);
        return {
          status: notConfigured ? "pending" : "failed",
          error: message,
        };
      }
    },
    (completed, total) =>
      onEvent({ type: "progress", stage: "analyzing", completed, total }),
  );

  // ── Stage 5: qualification ───────────────────────────────────────
  onEvent({ type: "stage", stage: "qualifying", message: "Qualifying leads..." });
  const results: PipelineCompanyResult[] = companies.map((company, i) => {
    let score: ScoreResult | null = null;
    try {
      const website = websites[i];
      score = deps.score(
        toAILead(company),
        website.status === "completed" && website.findings
          ? toAIInspection(company, website.findings)
          : null,
      );
    } catch {
      score = null;
    }
    const { qualified, reasons } = qualify(
      company,
      duplicates[i],
      websites[i],
      score,
      input.opportunity,
    );
    const result: PipelineCompanyResult = {
      company,
      duplicate: duplicates[i],
      website: websites[i],
      ai: aiResults[i],
      score,
      qualified,
      qualificationReasons: reasons,
    };
    onEvent({ type: "company", result });
    return result;
  });

  const summary: PipelineSummary = {
    searched: companies.length,
    researched: results.filter((r) => r.website.status === "completed").length,
    analyzed: results.filter((r) => r.ai.status === "completed").length,
    qualified: results.filter((r) => r.qualified).length,
    duplicates: results.filter((r) => r.duplicate).length,
    failed: results.filter((r) => r.website.status === "failed").length,
  };
  onEvent({ type: "complete", summary });
  return { results, summary };
}
