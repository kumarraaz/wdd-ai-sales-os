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
 * - opportunityType: NO_WEBSITE when websiteStatus is NO_WEBSITE;
 *   otherwise UNKNOWN until a website inspection is explicitly run.
 * - recentEvidenceDate: provider value, else the search time (the source
 *   re-confirmed the listing — this is "recent source evidence", NEVER a
 *   company creation/registration date).
 * - score/scoreReason: deterministic score via the existing scoring engine
 *   (no inspection/intelligence inputs at discovery time).
 * - qualification: derived from score bands; INFORMATIONAL ONLY — it never
 *   blocks import.
 *
 * Also: cross-source deduplication (pure, testable) keyed by
 * provider+providerId → normalized phone → normalized domain →
 * normalized name+city. First occurrence wins.
 */
import { normalizePhoneDigits, normalizeName } from "./matching";
import { calculateScore } from "../intelligence/scoring";
import type {
  DiscoveredCompany,
  LeadDiscoveryProvider,
  OpportunityType,
  WebsiteStatus,
} from "./types";

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
  if (websiteStatus === "NO_WEBSITE") return "NO_WEBSITE";
  return "UNKNOWN";
}

/**
 * Enrich one company in place (mutates and returns it). providerAuthority
 * comes from the provider's declared capabilities.
 */
export function enrichCandidate(
  company: DiscoveredCompany,
  providerAuthority: "authoritative" | "unreliable" = "unreliable",
): DiscoveredCompany {
  const websiteStatus = computeWebsiteStatus(company, providerAuthority === "authoritative");
  const contactable = computeContactable(company);
  company.websiteStatus = websiteStatus;
  company.contactable = contactable;
  company.opportunityType = computeOpportunityType(websiteStatus);
  company.lastVerifiedAt = company.discoveredAt;
  if (!company.recentEvidenceDate) {
    // The source re-confirmed this listing at search time — recent SOURCE
    // evidence, never a company creation date.
    company.recentEvidenceDate = company.discoveredAt;
  }

  // Deterministic score from verified data only (no inspection at discovery).
  try {
    const result = calculateScore(
      {
        id: company.providerId,
        website: company.website ?? null,
        phone: company.phone ?? null,
        email: company.email ?? null,
        industry: company.category ?? null,
        city: company.city ?? null,
        country: company.country ?? null,
        rating: company.rating ?? null,
        reviewCount: company.reviewCount ?? null,
        externalId: company.providerId,
        sourceUrl: company.sourceUrl ?? null,
        company: {
          id: company.providerId,
          name: company.name,
          website: company.website ?? null,
          industry: company.category ?? null,
          city: company.city ?? null,
          country: company.country ?? null,
        },
      },
      null,
      null,
    );
    company.score = result.score;
    const top = result.factors
      .filter((f) => f.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 2)
      .map((f) => f.explanation);
    company.scoreReason = top.length > 0 ? top.join(" · ") : "Insufficient evidence for scoring signals.";
    company.qualification =
      result.score >= 60 ? "qualified" : result.score >= 40 ? "maybe" : result.score > 0 ? "not_qualified" : "unreviewed";
  } catch {
    company.score = 0;
    company.scoreReason = "Scoring unavailable.";
    company.qualification = "unreviewed";
  }
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
 */
export function enrichCandidates(
  companies: DiscoveredCompany[],
  providers: Map<string, LeadDiscoveryProvider>,
): DiscoveredCompany[] {
  return companies.map((c) => {
    const authority = providers.get(c.provider)?.capabilities?.websiteAuthority ?? "unreliable";
    return enrichCandidate(c, authority);
  });
}
