/**
 * CSV export for discovery candidates (and lead rows). Pure functions —
 * shared between the server route and the client download button.
 * No secrets are ever included; nulls stay empty (never "N/A" filler).
 */
import type { DiscoveredCompany } from "./types";

export interface ExportLeadRow {
  company?: string | null;
  contactName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  websiteStatus?: string | null;
  industry?: string | null;
  location?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  googleMapsUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  qualification?: string | null;
  score?: number | null;
  scoreReason?: string | null;
  opportunity?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  recentEvidenceDate?: string | null;
  registrationDate?: string | null;
  registrationStatus?: string | null;
  discoveredAt?: string | null;
  lastVerifiedAt?: string | null;
}

const HEADERS = [
  "Company",
  "Contact Name",
  "Job Title",
  "Phone",
  "Email",
  "Website",
  "Website Status",
  "Industry",
  "Location",
  "Source",
  "Source URL",
  "Google Maps URL",
  "Instagram",
  "Facebook",
  "LinkedIn",
  "Qualification",
  "Score",
  "Score Reason",
  "Opportunity",
  "Rating",
  "Reviews",
  "Recent Evidence",
  "Registration Date",
  "Registration Status",
  "Discovered At",
  "Last Verified At",
] as const;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote when the value contains a comma, quote, or newline.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function candidateToExportRow(c: DiscoveredCompany): ExportLeadRow {
  return {
    company: c.name,
    phone: c.phone,
    email: c.email,
    website: c.website,
    websiteStatus: c.websiteStatus,
    industry: c.category,
    location: [c.city, c.state, c.country].filter(Boolean).join(", "),
    source: c.provider,
    sourceUrl: c.sourceUrl,
    googleMapsUrl: c.googleMapsUrl,
    instagramUrl: c.instagramUrl,
    facebookUrl: c.facebookUrl,
    linkedinUrl: c.linkedinUrl,
    qualification: c.qualification,
    score: c.score,
    scoreReason: c.scoreReason,
    opportunity: c.opportunityType,
    rating: c.rating,
    reviewCount: c.reviewCount,
    recentEvidenceDate: c.recentEvidenceDate,
    registrationDate: c.registrationDate,
    registrationStatus: c.registrationStatus,
    discoveredAt: c.discoveredAt,
    lastVerifiedAt: c.lastVerifiedAt,
  };
}

/** Build the CSV text for export rows. Exported for tests. */
export function buildExportCsv(rows: ExportLeadRow[]): string {
  const lines = [HEADERS.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.company,
        r.contactName,
        r.jobTitle,
        r.phone,
        r.email,
        r.website,
        r.websiteStatus,
        r.industry,
        r.location,
        r.source,
        r.sourceUrl,
        r.googleMapsUrl,
        r.instagramUrl,
        r.facebookUrl,
        r.linkedinUrl,
        r.qualification,
        r.score,
        r.scoreReason,
        r.opportunity,
        r.rating,
        r.reviewCount,
        r.recentEvidenceDate,
        r.registrationDate,
        r.registrationStatus,
        r.discoveredAt,
        r.lastVerifiedAt,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function buildCandidatesCsv(candidates: DiscoveredCompany[]): string {
  return buildExportCsv(candidates.map(candidateToExportRow));
}
