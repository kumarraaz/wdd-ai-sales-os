/**
 * LeadCandidate enrichment — turns raw DiscoveredCompany records into
 * decision-ready candidates using VERIFIED evidence only.
 *
 * Computed fields:
 * - websiteStatus: NO_WEBSITE only when the provider's website field is
 *   AUTHORITATIVE (Google Places: websiteUri absent = NO_WEBSITE).
 *   Providers with sparse website data (OSM, Geoapify, web search) yield
 *   UNKNOWN when absent — never assumed.
 * - contactable: true when phone, email, or a social/profile URL exists.
 *   A Google Maps listing URL alone does NOT count (it is a directory
 *   profile, not a contact channel).
 * - opportunityType: HIGH | MEDIUM | LOW | UNKNOWN with a deterministic
 *   opportunityReason built only from verified signals
 *   (e.g. "No website + phone available + target industry \"manufacturer\"").
 * - score/scoreReason: deterministic 0–100 discovery opportunity score
 *   (no-website, phone, industry/location match, completeness, source
 *   confidence, email, rating, reviews). No inspection/intelligence inputs
 *   at discovery time. The score is always persisted on import — no more
 *   score=0 leads.
 * - recentEvidenceDate: provider value, else the search time (the source
 *   re-confirmed the listing — this is "recent source evidence", NEVER a
 *   company creation/registration date).
 * - qualification: derived from score bands; INFORMATIONAL ONLY — it never
 *   blocks import.
 *
 * Also: cross-source deduplication (pure, testable) keyed by
 * provider+providerId → normalized phone → normalized domain →
 * normalized name+city. First occurrence wins.
 */
import { normalizePhoneDigits, normalizeName } from "./matching";
import type {
  DiscoveredCompany,
  LeadDiscoveryProvider,
  OpportunityType,
  WebsiteStatus,
} from "./types";

/**
 * Deterministic discovery-time sales opportunity score (0–100).
 *
 * Pure function of VERIFIED source fields only — no LLM, no network, no
 * inspection. Each verified field contributes to EXACTLY ONE factor.
 * Missing data scores 0 for that factor and is reported as "not available"
 * — never as a negative fact. Never uses fabricated revenue, employee
 * count, owner names, or any invented firmographics.
 *
 * Factor weights (total 100):
 *   No website (authoritative) .. 25
 *   Phone available ............. 20
 *   Target industry match ....... 15
 *   Target location match ....... 10
 *   Data completeness ........... 10  (name + city + source URL)
 *   Source confidence ...........  5  (Google = authoritative)
 *   Email available .............  5
 *   Rating ≥ 4.0 ................  5
 *   Reviews ≥ 10 ................  5
 */
export interface DiscoveryScoreTarget {
  /** The search keyword, e.g. "manufacturers". */
  industry: string;
  /** The search location, e.g. "Ahmedabad" or "Ahmedabad, Gujarat". */
  location: string;
}

export interface DiscoveryScoreFactor {
  factor: string;
  points: number;
  max: number;
  reason: string;
}

export interface DiscoveryScore {
  score: number;
  factors: DiscoveryScoreFactor[];
  /** Human-readable breakdown, e.g. "No website +25 · Phone available +20". */
  scoreReason: string;
}

export interface OpportunityClassification {
  tier: OpportunityType;
  reason: string;
}

const STOP_WORDS = new Set([
  "in", "the", "of", "and", "a", "an", "for", "near", "at", "to", "all", "any",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** True when any meaningful search-industry token appears in the provider's category or business name. */
export function industryMatchesTarget(
  category: string | undefined,
  name: string,
  targetIndustry: string,
): boolean {
  const kw = tokens(targetIndustry);
  if (kw.length === 0) return false;
  const hay = `${category ?? ""} ${name}`.toLowerCase();
  // Naive singular/plural variants so "manufacturers" matches "manufacturer".
  const variants = new Set<string>();
  for (const t of kw) {
    variants.add(t);
    variants.add(`${t}s`);
    if (t.endsWith("s") && t.length > 4) variants.add(t.slice(0, -1));
  }
  if ([...variants].some((t) => hay.includes(t))) return true;
  // Stem-prefix fallback so "manufacturers" also matches "manufacturing".
  const hayWords = hay.split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of kw) {
    if (t.length < 7) continue;
    const stem = t.slice(0, 7);
    if (hayWords.some((w) => w.startsWith(stem))) return true;
  }
  return false;
}

/** True when the provider's city/state/country aligns with the search location. */
export function locationMatchesTarget(
  company: Pick<DiscoveredCompany, "city" | "state" | "country">,
  targetLocation: string,
): boolean {
  const target = targetLocation.toLowerCase().trim();
  if (!target) return false;
  const fields = [company.city, company.state, company.country]
    .map((f) => (f ?? "").toLowerCase().trim())
    .filter((f) => f.length >= 3);
  return fields.some((f) => target.includes(f) || f.includes(target));
}

export function scoreDiscoveredCompany(
  company: Pick<
    DiscoveredCompany,
    | "name" | "phone" | "email" | "category" | "city" | "state" | "country"
    | "rating" | "reviewCount" | "sourceUrl" | "provider"
  >,
  websiteStatus: WebsiteStatus,
  target?: DiscoveryScoreTarget,
): DiscoveryScore {
  const factors: DiscoveryScoreFactor[] = [];
  const push = (factor: string, points: number, max: number, reason: string) => {
    if (points > 0) factors.push({ factor, points, max, reason });
  };

  const industryMatch = target ? industryMatchesTarget(company.category, company.name, target.industry) : false;
  const locationMatch = target ? locationMatchesTarget(company, target.location) : false;

  if (websiteStatus === "NO_WEBSITE")
    push("No website", 25, 25, "No website (Google authoritative)");
  if (company.phone?.trim())
    push("Phone available", 20, 20, "Phone available");
  if (industryMatch)
    push("Industry match", 15, 15, `Target industry "${target!.industry.trim()}"`);
  if (locationMatch)
    push("Location match", 10, 10, `Target location "${target!.location.trim()}"`);

  const completenessSignals = [
    company.name.trim() ? 1 : 0,
    company.city?.trim() ? 1 : 0,
    company.sourceUrl?.trim() ? 1 : 0,
  ];
  const completeness = completenessSignals.reduce((a, b) => a + b, 0);
  if (completeness === 3)
    push("Data completeness", 10, 10, "Name + city + source URL present");

  if (company.provider === "google-places")
    push("Source confidence", 5, 5, "Google Business (authoritative)");
  if (company.email?.trim())
    push("Email available", 5, 5, "Email available");
  if ((company.rating ?? 0) >= 4.0)
    push("Rating ≥ 4.0", 5, 5, `Rating ${company.rating}`);
  if ((company.reviewCount ?? 0) >= 10)
    push("Reviews ≥ 10", 5, 5, `${company.reviewCount} reviews`);

  const score = Math.min(100, Math.max(0, factors.reduce((a, f) => a + f.points, 0)));
  const scoreReason =
    factors.length > 0
      ? factors.map((f) => `${f.reason} +${f.points}`).join(" · ")
      : "Insufficient verified evidence for scoring signals.";
  return { score, factors, scoreReason };
}

/**
 * Deterministic opportunity classification from verified signals only.
 * - HIGH: no website + phone + target industry match (+ location when present).
 * - MEDIUM: no website with partial signals, or phone + industry match with a website.
 * - LOW: contactable but no strong opportunity signal.
 * - UNKNOWN: not contactable / insufficient evidence.
 */
export function classifyOpportunity(
  company: Pick<
    DiscoveredCompany,
    "name" | "phone" | "category" | "city" | "state" | "country"
  >,
  websiteStatus: WebsiteStatus,
  contactable: boolean,
  target?: DiscoveryScoreTarget,
): OpportunityClassification {
  const noWebsite = websiteStatus === "NO_WEBSITE";
  const hasPhone = !!company.phone?.trim();
  const industryMatch = target ? industryMatchesTarget(company.category, company.name, target.industry) : false;
  const locationMatch = target ? locationMatchesTarget(company, target.location) : false;
  const industryLabel = target?.industry.trim() ? `"${target.industry.trim()}"` : "target industry";
  const locationLabel = target?.location.trim() ? `"${target.location.trim()}"` : "target location";

  if (noWebsite && hasPhone && industryMatch) {
    const parts = ["No website", "phone available", `target industry ${industryLabel}`];
    if (locationMatch) parts.push(`target location ${locationLabel}`);
    return { tier: "HIGH", reason: parts.join(" + ") };
  }
  if (noWebsite && (hasPhone || industryMatch || locationMatch)) {
    const parts = ["No website"];
    if (hasPhone) parts.push("phone available");
    if (industryMatch) parts.push(`target industry ${industryLabel}`);
    if (locationMatch) parts.push(`target location ${locationLabel}`);
    return { tier: "MEDIUM", reason: parts.join(" + ") };
  }
  if (!noWebsite && hasPhone && industryMatch) {
    return {
      tier: "MEDIUM",
      reason: `Phone available + target industry ${industryLabel} (has website — improvement/SEO prospect)`,
    };
  }
  if (contactable) {
    return { tier: "LOW", reason: "Contactable, no strong opportunity signal from verified data." };
  }
  return { tier: "UNKNOWN", reason: "Insufficient verified data to classify opportunity." };
}

function domainOfWebsite(website: string | undefined): string | undefined {
  if (!website) return undefined;
  try {
    return new URL(website).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

function phoneKey(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = normalizePhoneDigits(phone).replace(/\D/g, "");
  return digits.length >= 7 ? digits : undefined;
}

/**
 * Compute websiteStatus from verified evidence only.
 * authoritative=true (Google Places): absent websiteUri = NO_WEBSITE.
 * authoritative=false: absent website = UNKNOWN (data sparsity, not proof).
 */
export function computeWebsiteStatus(
  company: Pick<DiscoveredCompany, "website">,
  websiteAuthoritative: boolean,
): WebsiteStatus {
  if (company.website) return "HAS_WEBSITE";
  return websiteAuthoritative ? "NO_WEBSITE" : "UNKNOWN";
}

/**
 * True when at least one legitimate contact signal exists: phone, email,
 * website (contact page/form is a real channel), or a social/profile URL.
 * A directory/maps listing URL alone does NOT count.
 */
export function computeContactable(
  company: Pick<
    DiscoveredCompany,
    "phone" | "email" | "website" | "instagramUrl" | "facebookUrl" | "linkedinUrl"
  >,
): boolean {
  return !!(
    company.phone ||
    company.email ||
    company.website ||
    company.instagramUrl ||
    company.facebookUrl ||
    company.linkedinUrl
  );
}

export function computeOpportunityType(websiteStatus: WebsiteStatus): OpportunityType {
  // Deprecated: kept for backward compatibility in tests/import paths that
  // pass a bare websiteStatus. Prefer classifyOpportunity() with target context.
  if (websiteStatus === "NO_WEBSITE") return "MEDIUM";
  return "UNKNOWN";
}

/**
 * Enrich one company in place (mutates and returns it). providerAuthority
 * comes from the provider's declared capabilities; target (the run's
 * industry/location) powers the deterministic opportunity score.
 */
export function enrichCandidate(
  company: DiscoveredCompany,
  providerAuthority: "authoritative" | "unreliable" = "unreliable",
  target?: DiscoveryScoreTarget,
): DiscoveredCompany {
  const websiteStatus = computeWebsiteStatus(company, providerAuthority === "authoritative");
  const contactable = computeContactable(company);
  const { tier, reason: opportunityReason } = classifyOpportunity(company, websiteStatus, contactable, target);
  company.websiteStatus = websiteStatus;
  company.contactable = contactable;
  company.opportunityType = tier;
  company.opportunityReason = opportunityReason;
  company.lastVerifiedAt = company.discoveredAt;
  if (!company.recentEvidenceDate) {
    // The source re-confirmed this listing at search time — recent SOURCE
    // evidence, never a company creation date.
    company.recentEvidenceDate = company.discoveredAt;
  }

  // Deterministic opportunity score from verified data only.
  // No website inspection at discovery time (§9): NO_WEBSITE candidates
  // never trigger crawling — only verified contact/business data is kept.
  const scored = scoreDiscoveredCompany(company, websiteStatus, target);
  company.score = scored.score;
  company.scoreReason = scored.scoreReason;
  company.qualification =
    scored.score >= 60 ? "qualified" : scored.score >= 40 ? "maybe" : scored.score > 0 ? "not_qualified" : "unreviewed";
  return company;
}

export interface DedupResult {
  unique: DiscoveredCompany[];
  /** Number of candidates removed as cross-source duplicates. */
  removed: number;
}

/**
 * Cross-source dedup. Priority: provider+providerId → phone → domain →
 * name+city. First occurrence wins; the survivor keeps its original
 * provider provenance.
 */
export function dedupeCandidates(companies: DiscoveredCompany[]): DedupResult {
  const seenProvider = new Set<string>();
  const seenPhone = new Set<string>();
  const seenDomain = new Set<string>();
  const seenNameLoc = new Set<string>();
  const unique: DiscoveredCompany[] = [];
  let removed = 0;

  for (const c of companies) {
    const pk = `${c.provider}:${c.providerId}`;
    if (seenProvider.has(pk)) {
      removed++;
      continue;
    }
    const ph = phoneKey(c.phone);
    if (ph && seenPhone.has(ph)) {
      removed++;
      continue;
    }
    const dom = domainOfWebsite(c.website);
    if (dom && seenDomain.has(dom)) {
      removed++;
      continue;
    }
    const nameLoc = `${normalizeName(c.name)}|${(c.city ?? "").toLowerCase().trim()}`;
    if (normalizeName(c.name) && seenNameLoc.has(nameLoc)) {
      removed++;
      continue;
    }
    seenProvider.add(pk);
    if (ph) seenPhone.add(ph);
    if (dom) seenDomain.add(dom);
    if (normalizeName(c.name)) seenNameLoc.add(nameLoc);
    unique.push(c);
  }
  return { unique, removed };
}

/**
 * Enrich a batch with the right website authority per provider.
 * providers: map of providerId → provider (for capabilities lookup).
 * target: the run's industry/location — powers deterministic scoring.
 */
export function enrichCandidates(
  companies: DiscoveredCompany[],
  providers: Map<string, LeadDiscoveryProvider>,
  target?: DiscoveryScoreTarget,
): DiscoveredCompany[] {
  return companies.map((c) => {
    const authority = providers.get(c.provider)?.capabilities?.websiteAuthority ?? "unreliable";
    return enrichCandidate(c, authority, target);
  });
}
