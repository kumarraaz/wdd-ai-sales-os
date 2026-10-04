/**
 * Multi-source discovery run orchestrator (discovery workspace).
 *
 * Runs an ordered source plan — primary first, then fallbacks — with:
 * - Per-source budget guards (zero-spend enforcement) BEFORE any call.
 * - Query fan-out for Google Places (city variants) while under target.
 * - Cross-source dedup, enrichment, and honest filters.
 * - PARTIAL results: one source failing never discards another's results.
 * - Truthful counts: requested vs discovered vs contactable are reported
 *   separately; the system never claims a target it did not reach.
 *
 * Pure orchestration: provider lookup, budget checks, and usage recording
 * are injected (RunDeps) so tests can substitute fakes and the API route
 * owns DB access. Progress streams through onEvent as RunEvent.
 *
 * NO website inspection runs here — websiteStatus comes from provider
 * fields only (websiteUri absent = NO_WEBSITE for Google; UNKNOWN for
 * sparse providers). NO_WEBSITE leads never trigger inspection.
 */
import { parseLocation } from "./pipeline";
import {
  dedupeCandidates,
  enrichCandidate,
  type DedupResult,
} from "./candidates";
import {
  DiscoveryError,
  type DiscoveryQuery,
  type DiscoveredCompany,
  type LeadDiscoveryProvider,
} from "./types";
import type { BudgetCheck } from "./cost";

export type WebsiteFilter = "any" | "no_website" | "has_website";
export type OpportunityFilter = "any" | "new_website" | "website_improvement" | "seo";
export type RecentEvidenceFilter = "any" | "30d" | "90d" | "6m" | "1y";

export interface RunSourceSelection {
  providerId: string;
  role: "primary" | "fallback";
}

export interface DiscoveryRunInput {
  /** Ordered: primary first, then fallbacks. Use providerId "all" for all enabled. */
  sources: RunSourceSelection[];
  industry: string;
  location: string;
  websiteFilter: WebsiteFilter;
  contactRequired: boolean;
  opportunity: OpportunityFilter;
  recentEvidence: RecentEvidenceFilter;
  /** Desired final candidates AFTER filters. 1..100. */
  limit: number;
  category?: string;
}

export interface RunDeps {
  getProvider(id: string): LeadDiscoveryProvider | undefined;
  listSearchable(): LeadDiscoveryProvider[];
  checkBudget(providerId: string): Promise<BudgetCheck>;
  recordUsage(providerId: string, usage: { requests?: number; credits?: number }): Promise<void>;
  recordBlocked(providerId: string): Promise<void>;
}

export type SourceRunStatus =
  | "ok"
  | "not_configured"
  | "blocked"
  | "failed"
  | "skipped";

export interface SourceRunOutcome {
  providerId: string;
  label: string;
  role: "primary" | "fallback";
  status: SourceRunStatus;
  discovered: number;
  kept: number;
  requestsMade: number;
  creditsUsed: number;
  queriesRun: string[];
  /** Human reason for non-ok statuses — shown verbatim in the UI. */
  message?: string;
}

export interface RunSummary {
  requested: number;
  /** Raw candidates across providers (pre-dedup). */
  discovered: number;
  /** After cross-source dedup (pre-filter). */
  deduplicated: number;
  duplicatesRemoved: number;
  /** Removed by the user's own filters (website/contact/opportunity/evidence). */
  filteredOut: number;
  withWebsite: number;
  withoutWebsite: number;
  unknownWebsite: number;
  contactable: number;
  unreachable: number;
}

export type RunStatus = "COMPLETE" | "PARTIAL" | "FAILED" | "LIMIT_REACHED";

export interface DiscoveryRunOutput {
  candidates: DiscoveredCompany[];
  summary: RunSummary;
  sources: SourceRunOutcome[];
  status: RunStatus;
  durationMs: number;
  error?: string;
}

export type RunEvent =
  | { type: "source-start"; providerId: string; label: string }
  | { type: "source-done"; outcome: SourceRunOutcome }
  | { type: "complete"; output: DiscoveryRunOutput }
  | { type: "error"; message: string };

/** Priority order when the user selects "All enabled sources". */
const ALL_SOURCES_PRIORITY = [
  "google-places",
  "geoapify",
  "tavily",
  "gemini-grounding",
  "openstreetmap",
];

/** City fan-out for Indian states — transparent query expansion. */
const CITY_FANOUT: Record<string, string[]> = {
  gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot"],
  maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik"],
  delhi: ["New Delhi"],
  karnataka: ["Bengaluru", "Mysuru", "Hubballi"],
  "tamil nadu": ["Chennai", "Coimbatore"],
  tamilnadu: ["Chennai", "Coimbatore"],
  rajasthan: ["Jaipur", "Udaipur", "Jodhpur"],
  punjab: ["Ludhiana", "Amritsar"],
  haryana: ["Gurugram", "Faridabad"],
  "uttar pradesh": ["Lucknow", "Kanpur", "Noida"],
  "west bengal": ["Kolkata", "Howrah"],
  telangana: ["Hyderabad"],
  kerala: ["Kochi", "Thiruvananthapuram"],
  "madhya pradesh": ["Indore", "Bhopal"],
  bihar: ["Patna"],
  odisha: ["Bhubaneswar"],
  assam: ["Guwahati"],
};

/**
 * Build query variants for fan-out. Only Google Places gets city
 * expansion (authoritative + paginated); other providers get one query.
 * Exported for tests.
 */
export function buildQueryVariants(
  providerId: string,
  industry: string,
  location: string,
): { city?: string; state?: string; country?: string; label: string }[] {
  const loc = parseLocation(location);
  const base = {
    city: loc.city,
    state: loc.state,
    country: loc.country,
    label: [industry, loc.city, loc.state, loc.country].filter(Boolean).join(", "),
  };
  if (providerId !== "google-places") return [base];
  // City fan-out only when the location is state-level (no city given).
  if (!loc.city && loc.state) {
    const cities = CITY_FANOUT[loc.state.toLowerCase().trim()];
    if (cities?.length) {
      const variants = [base];
      for (const city of cities.slice(0, 4)) {
        variants.push({
          city,
          state: loc.state,
          country: loc.country,
          label: [industry, city, loc.state, loc.country].filter(Boolean).join(", "),
        });
      }
      return variants;
    }
  }
  return [base];
}

function evidenceCutoff(filter: RecentEvidenceFilter): number | null {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  switch (filter) {
    case "30d":
      return now - 30 * day;
    case "90d":
      return now - 90 * day;
    case "6m":
      return now - 182 * day;
    case "1y":
      return now - 365 * day;
    default:
      return null;
  }
}

/** Apply the user's filters to enriched candidates. Exported for tests. */
export function applyCandidateFilters(
  candidates: DiscoveredCompany[],
  input: DiscoveryRunInput,
): DiscoveredCompany[] {
  const cutoff = evidenceCutoff(input.recentEvidence);
  return candidates.filter((c) => {
    if (input.websiteFilter === "no_website" && c.websiteStatus !== "NO_WEBSITE") return false;
    if (input.websiteFilter === "has_website" && c.websiteStatus !== "HAS_WEBSITE") return false;
    if (input.contactRequired && !c.contactable) return false;
    if (input.opportunity === "new_website" && c.websiteStatus !== "NO_WEBSITE") return false;
    if (
      (input.opportunity === "website_improvement" || input.opportunity === "seo") &&
      c.websiteStatus !== "HAS_WEBSITE"
    )
      return false;
    if (cutoff != null) {
      const ev = c.recentEvidenceDate ? new Date(c.recentEvidenceDate).getTime() : NaN;
      if (!Number.isFinite(ev) || ev < cutoff) return false;
    }
    return true;
  });
}

function expandSources(input: DiscoveryRunInput, deps: RunDeps): RunSourceSelection[] {
  if (input.sources.some((s) => s.providerId === "all")) {
    const searchable = new Set(deps.listSearchable().map((p) => p.id));
    return ALL_SOURCES_PRIORITY.filter((id) => searchable.has(id)).map((id, i) => ({
      providerId: id,
      role: i === 0 ? ("primary" as const) : ("fallback" as const),
    }));
  }
  return input.sources;
}

function summarize(
  deduped: DiscoveredCompany[],
  final: DiscoveredCompany[],
  requested: number,
  discoveredRaw: number,
  duplicatesRemoved: number,
): RunSummary {
  return {
    requested,
    discovered: discoveredRaw,
    deduplicated: deduped.length,
    duplicatesRemoved,
    filteredOut: deduped.length - final.length,
    withWebsite: deduped.filter((c) => c.websiteStatus === "HAS_WEBSITE").length,
    withoutWebsite: deduped.filter((c) => c.websiteStatus === "NO_WEBSITE").length,
    unknownWebsite: deduped.filter((c) => c.websiteStatus === "UNKNOWN").length,
    contactable: deduped.filter((c) => c.contactable).length,
    unreachable: deduped.filter((c) => !c.contactable).length,
  };
}

/**
 * Run multi-source discovery. Never throws for per-source failures —
 * those become SourceRunOutcome entries (PARTIAL results). Throws only
 * for invalid input.
 */
export async function runDiscovery(
  input: DiscoveryRunInput,
  deps: RunDeps,
  onEvent: (event: RunEvent) => void = () => {},
): Promise<DiscoveryRunOutput> {
  const started = Date.now();
  const limit = Math.min(Math.max(input.limit, 1), 100);
  if (!input.industry?.trim()) throw new DiscoveryError("INVALID_QUERY", "Industry is required.");
  if (!input.location?.trim()) throw new DiscoveryError("INVALID_QUERY", "Location is required.");

  const plan = expandSources(input, deps);
  const providerMap = new Map<string, LeadDiscoveryProvider>();
  for (const p of deps.listSearchable()) providerMap.set(p.id, p);

  const outcomes: SourceRunOutcome[] = [];
  const collected: DiscoveredCompany[] = [];
  let discoveredRaw = 0;
  let duplicatesRemoved = 0;

  const currentKept = (): DiscoveredCompany[] =>
    applyCandidateFilters(
      dedupeCandidates(collected.map((c) => ({ ...c }))).unique,
      input,
    );

  for (const sel of plan) {
    const provider = deps.getProvider(sel.providerId) ?? providerMap.get(sel.providerId);
    const outcome: SourceRunOutcome = {
      providerId: sel.providerId,
      label: provider?.label ?? sel.providerId,
      role: sel.role,
      status: "skipped",
      discovered: 0,
      kept: 0,
      requestsMade: 0,
      creditsUsed: 0,
      queriesRun: [],
    };

    if (!provider || !provider.searchable) {
      outcome.status = "skipped";
      outcome.message = "Provider not available.";
      outcomes.push(outcome);
      onEvent({ type: "source-done", outcome });
      continue;
    }

    // Stop early once the target is reached — saves budget.
    if (currentKept().length >= limit) {
      outcome.status = "skipped";
      outcome.message = `Target of ${limit} already reached — source not needed.`;
      outcomes.push(outcome);
      onEvent({ type: "source-done", outcome });
      continue;
    }

    onEvent({ type: "source-start", providerId: provider.id, label: provider.label });

    // 1) Budget guard BEFORE any call.
    let budget: BudgetCheck;
    try {
      budget = await deps.checkBudget(provider.id);
    } catch {
      budget = { allowed: false, reason: "Usage check failed.", usedRequests: 0, usedCredits: 0, period: "month", resetLabel: "", zeroSpendMode: true };
    }
    if (!budget.allowed) {
      await deps.recordBlocked(provider.id);
      outcome.status = "blocked";
      outcome.message = budget.reason ?? "Free-tier safety budget exhausted.";
      outcomes.push(outcome);
      onEvent({ type: "source-done", outcome });
      continue;
    }

    // 2) Configuration guard.
    if (!provider.isConfigured()) {
      outcome.status = "not_configured";
      outcome.message = `${provider.label} is not configured.`;
      outcomes.push(outcome);
      onEvent({ type: "source-done", outcome });
      continue;
    }

    // 3) Search (with fan-out variants for eligible providers).
    try {
      const variants = buildQueryVariants(provider.id, input.industry.trim(), input.location.trim());
      const authority = provider.capabilities?.websiteAuthority ?? "unreliable";
      for (const v of variants) {
        if (currentKept().length >= limit) break;
        const q: DiscoveryQuery = {
          keyword: input.industry.trim(),
          city: v.city,
          state: v.state,
          country: v.country,
          maxResults: Math.min(limit, 20),
          category: input.category,
        };
        const result = await provider.search(q);
        const req = result.meta?.requestsMade ?? 1;
        const cred = result.meta?.creditsUsed ?? 0;
        outcome.requestsMade += req;
        outcome.creditsUsed += cred;
        outcome.queriesRun.push(v.label);
        await deps.recordUsage(provider.id, { requests: req, credits: cred });
        discoveredRaw += result.companies.length;
        outcome.discovered += result.companies.length;
        for (const c of result.companies) {
          collected.push(enrichCandidate(c, authority));
        }
      }
      outcome.status = "ok";
      outcome.kept = currentKept().length;
    } catch (err) {
      if (err instanceof DiscoveryError && err.code === "FREE_LIMIT_REACHED") {
        await deps.recordBlocked(provider.id);
        outcome.status = "blocked";
      } else if (err instanceof DiscoveryError && err.code === "PROVIDER_NOT_CONFIGURED") {
        outcome.status = "not_configured";
      } else if (err instanceof DiscoveryError && err.code === "RATE_LIMITED") {
        outcome.status = "failed";
      } else {
        outcome.status = "failed";
      }
      outcome.message = err instanceof Error ? err.message : "Search failed.";
      outcome.kept = currentKept().length;
    }
    outcomes.push(outcome);
    onEvent({ type: "source-done", outcome });
  }

  // Final dedupe + filters.
  const dedup: DedupResult = dedupeCandidates(collected);
  duplicatesRemoved = dedup.removed;
  const candidates = applyCandidateFilters(dedup.unique, input).slice(0, limit);
  const summary = summarize(dedup.unique, candidates, limit, discoveredRaw, duplicatesRemoved);

  const anyOk = outcomes.some((o) => o.status === "ok");
  const anyBlocked = outcomes.some((o) => o.status === "blocked");
  const anyFailed = outcomes.some((o) => o.status === "failed");
  let status: RunStatus;
  let error: string | undefined;
  if (!anyOk && candidates.length === 0) {
    if (anyBlocked && !anyFailed) {
      status = "LIMIT_REACHED";
      error = "Free-tier safety budget exhausted for all attempted sources. No paid usage was attempted.";
    } else {
      status = "FAILED";
      error = outcomes.find((o) => o.message)?.message ?? "All sources failed.";
    }
  } else if (anyFailed || anyBlocked) {
    status = "PARTIAL";
  } else {
    status = "COMPLETE";
  }

  const output: DiscoveryRunOutput = {
    candidates,
    summary,
    sources: outcomes,
    status,
    durationMs: Date.now() - started,
    ...(error ? { error } : {}),
  };
  onEvent({ type: "complete", output });
  return output;
}
