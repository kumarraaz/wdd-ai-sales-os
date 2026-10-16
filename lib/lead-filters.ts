/**
 * Lead-list filters as URL state. The /leads URL is the single source of truth:
 * it is shareable, survives refresh, and is what dashboard drill-down links point
 * at. Everything read from the URL is validated here, so a hand-edited or stale
 * link degrades to "no filter" instead of a failing API request.
 */
import { leadSourceTypeSchema, leadStatusSchema } from "./validators";

export interface LeadFilters {
  q: string;
  status: string;
  sourceType: string;
  verification: string;
  /** digits only, "0"–"100" */
  minScore: string;
  followUp: "" | "due";
  contactable: "" | "true";
  websiteStatus: "" | "NO_WEBSITE" | "HAS_WEBSITE" | "UNKNOWN";
  page: number;
}

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  q: "",
  status: "",
  sourceType: "",
  verification: "",
  minScore: "",
  followUp: "",
  contactable: "",
  websiteStatus: "",
  page: 1,
};

const VERIFICATION_VALUES = ["HIGH", "MEDIUM", "LOW", "REJECTED", "UNVERIFIED"] as const;
const WEBSITE_VALUES = ["NO_WEBSITE", "HAS_WEBSITE", "UNKNOWN"] as const;

type ParamSource = { get(name: string): string | null };

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | "" {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

export function parseLeadFilters(params: ParamSource): LeadFilters {
  const rawScore = params.get("minScore");
  const score = rawScore !== null && /^\d{1,3}$/.test(rawScore) && Number(rawScore) <= 100 ? String(Number(rawScore)) : "";
  const rawPage = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").trim().slice(0, 200),
    status: oneOf(params.get("status"), leadStatusSchema.options),
    sourceType: oneOf(params.get("sourceType"), leadSourceTypeSchema.options),
    verification: oneOf(params.get("verification"), VERIFICATION_VALUES),
    minScore: score,
    followUp: oneOf(params.get("followUp"), ["due"] as const),
    contactable: oneOf(params.get("contactable"), ["true"] as const),
    websiteStatus: oneOf(params.get("websiteStatus"), WEBSITE_VALUES),
    page: Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100_000 ? rawPage : 1,
  };
}

/** Only non-default values are written, so the default view keeps a clean `/leads` URL. */
export function leadFiltersToParams(f: LeadFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.sourceType) p.set("sourceType", f.sourceType);
  if (f.verification) p.set("verification", f.verification);
  if (f.minScore) p.set("minScore", f.minScore);
  if (f.followUp) p.set("followUp", f.followUp);
  if (f.contactable) p.set("contactable", f.contactable);
  if (f.websiteStatus) p.set("websiteStatus", f.websiteStatus);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

/** Number of narrowing filters in effect (the page number is not a filter). */
export function activeFilterCount(f: LeadFilters): number {
  const { page: _page, ...rest } = f;
  void _page;
  return Object.values(rest).filter(Boolean).length;
}

/** Human labels for LeadSourceType values (the enum names are internal). */
export const SOURCE_LABELS: Record<string, string> = {
  GOOGLE_BUSINESS: "Google Maps",
  GEOAPIFY: "Geoapify",
  OPENSTREETMAP: "OpenStreetMap",
  WEB_SEARCH: "Web search",
  WEBSITE_SEARCH: "Website search",
  DIRECTORY: "Directory",
  META: "Meta",
  GOVERNMENT_REGISTRY: "Government registry",
  CSV: "CSV import",
  MANUAL: "Added by hand",
  API: "API",
  DEMO: "Demo data",
  INSTAGRAM: "Instagram",
};

export function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType.replace(/_/g, " ").toLowerCase();
}
