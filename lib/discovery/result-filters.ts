/**
 * Result-table filtering — pure functions shared between the
 * ResultsTable client component and unit tests. No JSX here so tests can
 * import this module directly.
 */
import type { DiscoveredCompany } from "./types";

export interface ResultsFilters {
  source: string;
  websiteStatus: string;
  contactable: string;
  industry: string;
  location: string;
  qualification: string;
  opportunity: string;
  score: string;
  recentEvidence: string;
}

export const EMPTY_FILTERS: ResultsFilters = {
  source: "",
  websiteStatus: "",
  contactable: "",
  industry: "",
  location: "",
  qualification: "",
  opportunity: "",
  score: "",
  recentEvidence: "",
};

/** Pure filter — exported for unit tests. */
export function filterCandidates(
  candidates: DiscoveredCompany[],
  f: ResultsFilters,
): DiscoveredCompany[] {
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  return candidates.filter((c) => {
    if (f.source && c.provider !== f.source) return false;
    if (f.websiteStatus && c.websiteStatus !== f.websiteStatus) return false;
    if (f.contactable === "yes" && !c.contactable) return false;
    if (f.contactable === "no" && c.contactable) return false;
    if (f.industry && !(c.category ?? "").toLowerCase().includes(f.industry.toLowerCase()))
      return false;
    const loc = [c.city, c.state, c.country].filter(Boolean).join(" ").toLowerCase();
    if (f.location && !loc.includes(f.location.toLowerCase())) return false;
    if (f.qualification && c.qualification !== f.qualification) return false;
    if (f.opportunity && c.opportunityType !== f.opportunity) return false;
    if (f.score === "80" && (c.score ?? 0) < 80) return false;
    if (f.score === "60" && (c.score ?? 0) < 60) return false;
    if (f.score === "40" && (c.score ?? 0) < 40) return false;
    if (f.score === "below40" && (c.score ?? 0) >= 40) return false;
    if (f.recentEvidence) {
      const ev = c.recentEvidenceDate ? new Date(c.recentEvidenceDate).getTime() : NaN;
      const windows: Record<string, number> = {
        "30d": 30 * day,
        "90d": 90 * day,
        "6m": 182 * day,
        "1y": 365 * day,
      };
      const w = windows[f.recentEvidence];
      if (w != null && (!Number.isFinite(ev) || now - ev > w)) return false;
    }
    return true;
  });
}
