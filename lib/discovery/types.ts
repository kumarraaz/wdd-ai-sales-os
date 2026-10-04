/**
 * Lead discovery provider abstraction (Phase 2).
 *
 * A discovery provider finds companies from a compliant source and returns
 * them in a normalized shape. Google Places is one provider; additional
 * compliant providers (directories, official APIs) can be added later by
 * implementing LeadDiscoveryProvider and registering it in registry.ts.
 *
 * COMPLIANCE: providers must only use official/publicly permitted APIs and
 * data. Web scraping, CAPTCHA/bot-protection bypass, proxy rotation for
 * evasion, fake accounts, and scraping private/personal information are
 * prohibited. Every discovered company carries its source URL and
 * provenance so VERIFIED_DATA, AI_INFERENCE, USER_PROVIDED and DEMO_DATA
 * are never mixed.
 */

import type { LeadSourceType } from "@prisma/client";

export type DataProvenance = "VERIFIED_DATA" | "AI_INFERENCE" | "USER_PROVIDED" | "DEMO_DATA";

/** How a lead's website presence was determined. Never invented. */
export type WebsiteStatus = "NO_WEBSITE" | "HAS_WEBSITE" | "UNKNOWN";

/** Sales opportunity tier derived from verified evidence (never from guesses). */
export type OpportunityType = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/** Human qualification state — informational only, NEVER blocks import. */
export type LeadQualification = "qualified" | "maybe" | "not_qualified" | "unreviewed";

/** Normalized query understood by every discovery provider. */
export interface DiscoveryQuery {
  keyword: string;
  country?: string;
  state?: string;
  city?: string;
  /** Search radius in meters — applied only where the provider supports it. */
  radiusMeters?: number;
  /** 1..20 for Google Places (API page limit). */
  maxResults: number;
  /** Optional business category / type, e.g. "manufacturer", "gym". */
  category?: string;
  /** Optional center for radius-based providers (never geocoded here). */
  latitude?: number;
  longitude?: number;
}

/**
 * One discovered company, normalized. Fields are populated ONLY from data
 * the provider actually returned — missing fields stay undefined and the UI
 * must render them as "not provided", never invented.
 *
 * Enrichment fields (websiteStatus, contactable, opportunityType, …) are
 * computed by lib/discovery/candidates.ts from verified evidence only.
 */
export interface DiscoveredCompany {
  /** Provider id, e.g. "google-places". */
  provider: string;
  /** Provider-scoped id, e.g. Google place_id — used for dedup. */
  providerId: string;
  name: string;
  category?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  /** Only when publicly returned by the provider. */
  phone?: string;
  /** Only when publicly returned by the provider. */
  email?: string;
  /** Only when publicly returned by the provider. */
  website?: string;
  /** Source URL, e.g. Google Maps link — provenance, not fetched. */
  sourceUrl?: string;
  /** Google Maps link when the provider is Google Places. */
  googleMapsUrl?: string;
  /** Social/profile URLs — only when the provider returned them. */
  instagramUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  /** Only when returned by the provider. */
  rating?: number;
  /** Only when returned by the provider. */
  reviewCount?: number;
  /** ISO timestamp of discovery. */
  discoveredAt: string;
  /** ISO timestamp of the last source confirmation (fresh API response = now). */
  lastVerifiedAt?: string;
  provenance: DataProvenance;
  // ── Enrichment (computed, never invented) ────────────────────────────
  websiteStatus?: WebsiteStatus;
  /** True when phone, email, or a social/contact URL exists. */
  contactable?: boolean;
  opportunityType?: OpportunityType;
  /** Deterministic opportunity reason — verified signals only, never invented. */
  opportunityReason?: string;
  /**
   * Recent-evidence date (ISO). For live API providers this is the search
   * time (the source re-confirmed the listing); for web results it is the
   * page/article date when available. NEVER a company creation date.
   */
  recentEvidenceDate?: string;
  /** Official registration evidence (government registry provider only). */
  registrationDate?: string;
  registrationStatus?: string;
  registrationSource?: string;
  /** Deterministic opportunity score 0–100 with a human-readable reason. */
  score?: number;
  scoreReason?: string;
  qualification?: LeadQualification;
  /** Whether this company already exists in the workspace CRM. */
  inCrm?: boolean;
  matchedLeadId?: string;
}

export interface DiscoveryResult {
  provider: string;
  companies: DiscoveredCompany[];
  searchedAt: string; // ISO
  /**
   * Metering info for zero-spend enforcement. requestsMade = billable HTTP
   * requests; creditsUsed = provider credits consumed.
   */
  meta?: { requestsMade?: number; creditsUsed?: number };
}

export type DiscoveryErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "PROVIDER_UNREACHABLE"
  | "RATE_LIMITED"
  | "FREE_LIMIT_REACHED"
  | "SEARCH_UNSUPPORTED"
  | "INVALID_QUERY";

export class DiscoveryError extends Error {
  code: DiscoveryErrorCode;
  /** Safe detail for logs — must NEVER contain API keys. */
  detail?: string;
  constructor(code: DiscoveryErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
    this.detail = detail;
  }
}

/** Declared provider capabilities — the UI never branches on provider ids. */
export interface ProviderCapabilities {
  /** Whether an absent website field is authoritative (Google) or not (OSM). */
  websiteAuthority: "authoritative" | "unreliable";
  supportsPhone: boolean;
  supportsEmail: boolean;
  supportsSocial: boolean;
  supportsPagination: boolean;
  /** Whether the provider returns evidence/registration timestamps. */
  supportsRecentEvidence: boolean;
  /** Whether the provider can be used for business discovery at all. */
  discoverySupported: boolean;
  /** Human reason when discoverySupported is false. */
  discoveryUnsupportedReason?: string;
}

export interface LeadDiscoveryProvider {
  /** Stable id, e.g. "google-places". Used in DiscoveryRun.providerId. */
  readonly id: string;
  /** Human label for the UI. */
  readonly label: string;
  /** LeadSourceType used when importing this provider's results. */
  readonly sourceType: LeadSourceType;
  /** Whether this provider can run discovery searches (CSV ingest cannot). */
  readonly searchable: boolean;
  /** Declared capabilities — optional for backward compatibility. */
  readonly capabilities?: ProviderCapabilities;
  /** Whether the provider can run searches right now. */
  isConfigured(): boolean;
  /** Setup instructions shown when isConfigured() is false. Never include secrets. */
  setupInstructions(): string[];
  /**
   * Discover companies. Providers that cannot search (e.g. CSV ingest)
   * throw DiscoveryError with code SEARCH_UNSUPPORTED.
   */
  search(query: DiscoveryQuery): Promise<DiscoveryResult>;
  /**
   * Optional cheap connectivity check for the Integrations UI. Must use the
   * cheapest possible call (e.g. an id-only field mask) and count usage.
   */
  testConnection?(): Promise<{ ok: boolean; message: string }>;
}
