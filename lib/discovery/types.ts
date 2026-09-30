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

export type DataProvenance = "VERIFIED_DATA" | "AI_INFERENCE" | "USER_PROVIDED" | "DEMO_DATA";

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
  website?: string;
  /** Source URL, e.g. Google Maps link — provenance, not fetched. */
  sourceUrl?: string;
  /** Only when returned by the provider. */
  rating?: number;
  /** Only when returned by the provider. */
  reviewCount?: number;
  /** ISO timestamp of discovery. */
  discoveredAt: string;
  provenance: DataProvenance;
}

export interface DiscoveryResult {
  provider: string;
  companies: DiscoveredCompany[];
  searchedAt: string; // ISO
}

export type DiscoveryErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "PROVIDER_UNREACHABLE"
  | "RATE_LIMITED"
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

export interface LeadDiscoveryProvider {
  /** Stable id, e.g. "google-places". Used in DiscoveryRun.providerId. */
  readonly id: string;
  /** Human label for the UI. */
  readonly label: string;
  /** LeadSourceType used when importing this provider's results. */
  readonly sourceType: "GOOGLE_BUSINESS" | "CSV" | "DIRECTORY" | "API";
  /** Whether this provider can run discovery searches (CSV ingest cannot). */
  readonly searchable: boolean;
  /** Whether the provider can run searches right now. */
  isConfigured(): boolean;
  /** Setup instructions shown when isConfigured() is false. Never include secrets. */
  setupInstructions(): string[];
  /**
   * Discover companies. Providers that cannot search (e.g. CSV ingest)
   * throw DiscoveryError with code SEARCH_UNSUPPORTED.
   */
  search(query: DiscoveryQuery): Promise<DiscoveryResult>;
}
