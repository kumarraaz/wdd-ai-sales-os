/**
 * Lead Verification Engine — the quality gate of the AI sales agent.
 *
 * A discovered candidate is NOT automatically a valid lead. Every candidate
 * is checked against source-backed evidence:
 *
 *   1. identity — is there a real business/entity? (name or strong source id)
 *   2. industry — does it match the day's target industry?
 *   3. location — does it match the day's target location?
 *   4. source independence — how many distinct providers back the identity?
 *
 * Confidence:
 *   HIGH     — identity + industry + location verified, ≥2 independent sources
 *   MEDIUM   — identity + industry + location verified, single strong source
 *   LOW      — weak/incomplete evidence (importable only as "needs verification")
 *   REJECTED — contradictory or clearly irrelevant; never imported
 *
 * Nothing here invents data: every check reads evidence the candidate
 * carries, and the reason string cites the sources.
 */
import { industryMatchesTarget } from "../discovery/candidates";

export type VerificationConfidence = "HIGH" | "MEDIUM" | "LOW" | "REJECTED";

/** One piece of source-backed evidence attached to a candidate. */
export interface SourceRef {
  /** Provider id, e.g. "tavily", "google-places". */
  provider: string;
  /** LeadSourceType-style label, e.g. "INSTAGRAM", "GOOGLE_BUSINESS". */
  sourceType: string;
  url?: string;
  retrievedAt: string;
  /** Short human label, e.g. "Instagram profile URL (listed, not accessed)". */
  label?: string;
}

export interface VerificationInput {
  businessName: string | null;
  /** Provider/category string, e.g. Google category or research category. */
  category: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  phone: string | null;
  instagramUsername: string | null;
  /** Google place_id or similar strong provider-scoped id. */
  providerId?: string | null;
  targetIndustry: string;
  targetLocation: string | null;
  targetCountry: string | null;
  sources: SourceRef[];
  /** 0–100 from the industry classifier; null when not classified. */
  industryRelevance: number | null;
}

export interface VerificationResult {
  confidence: VerificationConfidence;
  reason: string;
  checks: {
    identity: boolean;
    industry: boolean;
    location: boolean;
    /** Distinct providers backing the identity. */
    independentSources: number;
  };
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Location passes when the candidate city/country matches the target (or target is empty). */
function locationMatches(input: VerificationInput): boolean {
  const targetCity = norm(input.targetLocation);
  const targetCountry = norm(input.targetCountry);
  if (!targetCity && !targetCountry) return true; // no constraint configured
  const city = norm(input.city);
  const country = norm(input.country);
  // City known on both sides: a mismatch is a contradiction — a matching
  // country must not override it.
  if (targetCity && city) {
    return city.includes(targetCity) || targetCity.includes(city);
  }
  // Only country to go on (or city unknown): match = pass, mismatch = fail.
  if (targetCountry && country) {
    return country.includes(targetCountry) || targetCountry.includes(country);
  }
  // Target city set but candidate city unknown → not a contradiction.
  return true;
}

/** Industry passes when classifier relevance ≥ 60 or the deterministic matcher agrees. */
function industryMatches(input: VerificationInput): { pass: boolean; relevance: number } {
  if (input.industryRelevance !== null) {
    return { pass: input.industryRelevance >= 60, relevance: input.industryRelevance };
  }
  const haystack = `${input.category ?? ""} ${input.businessName ?? ""}`;
  const pass = industryMatchesTarget(haystack, "", input.targetIndustry);
  return { pass, relevance: pass ? 85 : 20 };
}

export function verifyCandidate(input: VerificationInput): VerificationResult {
  const sources = input.sources ?? [];
  const independentSources = new Set(sources.map((s) => s.provider)).size;
  const sourceLabels = sources
    .map((s) => s.label ?? s.provider)
    .filter(Boolean)
    .slice(0, 4);

  const identity = !!(norm(input.businessName) || input.providerId || input.instagramUsername);
  const { pass: industryPass, relevance } = industryMatches(input);
  const locationPass = locationMatches(input);

  const checks = {
    identity,
    industry: industryPass,
    location: locationPass,
    independentSources,
  };

  const cited = sourceLabels.length > 0 ? ` Sources: ${sourceLabels.join("; ")}.` : "";

  // REJECTED — no usable identity, or clearly off-target.
  if (!identity) {
    return {
      confidence: "REJECTED",
      reason: `No verifiable business identity (no business name, provider id, or profile).${cited}`,
      checks,
    };
  }
  if (!industryPass && relevance < 30) {
    return {
      confidence: "REJECTED",
      reason:
        `Industry mismatch for target "${input.targetIndustry}" ` +
        `(relevance ${relevance}/100).${cited}`,
      checks,
    };
  }
  if (!locationPass) {
    return {
      confidence: "REJECTED",
      reason: `Location does not match the target${input.targetLocation ? ` "${input.targetLocation}"` : ""}.${cited}`,
      checks,
    };
  }

  // HIGH — everything verified by ≥2 independent sources.
  if (industryPass && locationPass && independentSources >= 2) {
    return {
      confidence: "HIGH",
      reason:
        `Identity, industry ("${input.targetIndustry}", relevance ${relevance}/100) and ` +
        `location verified by ${independentSources} independent sources.${cited}`,
      checks,
    };
  }

  // MEDIUM — one strong source + supporting evidence.
  if (industryPass && locationPass) {
    return {
      confidence: "MEDIUM",
      reason:
        `Identity, industry (relevance ${relevance}/100) and location verified ` +
        `from a single strong source; no second independent confirmation.${cited}`,
      checks,
    };
  }

  // LOW — identity exists but industry or location evidence is weak.
  const weak: string[] = [];
  if (!industryPass) weak.push("industry relevance below bar");
  if (!locationPass) weak.push("location unverified");
  return {
    confidence: "LOW",
    reason: `Weak evidence: ${weak.join(", ") || "incomplete"}.${cited}`,
    checks,
  };
}
