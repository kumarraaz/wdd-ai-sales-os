/**
 * Deterministic duplicate matching for discovery → CRM import (Phase 2 Step 5).
 *
 * Matching hierarchy (first definitive match wins):
 *   1. External provider ID + provider (e.g. Google place_id + GOOGLE_BUSINESS)
 *   2. Canonical website URL (normalized: protocol/www/case/trailing slash)
 *   3. Normalized phone (digits only)
 *   4. Business name + location → POSSIBLE duplicate (review required, never
 *      auto-merged)
 *
 * Name-only matching is NEVER definitive. Original source values are never
 * modified — matching works on normalized copies.
 */

/** Normalize a business name for comparison: lowercase, strip punctuation. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/["'‘’“”`.,;:!?()[\]{}|/\\—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a location for comparison: lowercase, trimmed. */
export function normalizeLocation(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Normalize a phone to digits with leading + preserved. */
export function normalizePhoneDigits(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return raw.trim().startsWith("+") ? `+${digits}` : digits;
}

export type MatchKind =
  | "external_id"
  | "website"
  | "phone"
  | "name_location";

export interface MatchResult {
  kind: MatchKind;
  /** Definitive matches block a second import; possible matches only flag. */
  definitive: boolean;
  reason: string;
}

export interface MatchCandidate {
  providerId?: string | null;
  sourceType?: string | null;
  website?: string | null;
  phone?: string | null;
  name?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface MatchExisting {
  id: string;
  externalId?: string | null;
  sourceType?: string | null;
  website?: string | null;
  domain?: string | null;
  phone?: string | null;
  name?: string | null;
  companyName?: string | null;
  city?: string | null;
  country?: string | null;
  status?: string | null;
}

function canonicalDomain(website: string | null | undefined): string {
  if (!website) return "";
  try {
    const url = new URL(website.includes("://") ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Pure duplicate matcher — no DB access, fully unit-testable.
 * Returns the strongest match or null.
 */
export function matchDuplicate(
  candidate: MatchCandidate,
  existing: MatchExisting | null,
  providerLabel: string,
): MatchResult | null {
  if (!existing) return null;

  // 1) External provider ID + provider — strongest signal.
  if (
    candidate.providerId &&
    candidate.sourceType &&
    existing.externalId === candidate.providerId &&
    existing.sourceType === candidate.sourceType
  ) {
    return {
      kind: "external_id",
      definitive: true,
      reason: `Already in CRM — same ${providerLabel} listing is already imported.`,
    };
  }

  // 2) Canonical website URL.
  const candDomain = canonicalDomain(candidate.website);
  const existDomain =
    existing.domain || canonicalDomain(existing.website);
  if (candDomain && existDomain && candDomain === existDomain) {
    return {
      kind: "website",
      definitive: true,
      reason: `Already in CRM — website ${candDomain} already exists.`,
    };
  }

  // 3) Normalized phone.
  const candPhone = normalizePhoneDigits(candidate.phone).replace(/\D/g, "");
  const existPhone = normalizePhoneDigits(existing.phone).replace(/\D/g, "");
  if (candPhone && existPhone && candPhone === existPhone) {
    return {
      kind: "phone",
      definitive: true,
      reason: `Already in CRM — phone ${candidate.phone} already exists.`,
    };
  }

  // 4) Business name + location — POSSIBLE duplicate, review required.
  //    Name-only is never enough.
  const candName = normalizeName(candidate.name);
  const existName = normalizeName(existing.name || existing.companyName);
  if (candName && existName && candName === existName) {
    const candLoc = normalizeLocation(candidate.city) || normalizeLocation(candidate.country);
    const existLoc = normalizeLocation(existing.city) || normalizeLocation(existing.country);
    if (candLoc && existLoc && candLoc === existLoc) {
      return {
        kind: "name_location",
        definitive: false,
        reason:
          `Possible duplicate — review required: "${candidate.name}" matches an ` +
          `existing lead in ${candidate.city || candidate.country}. Not merged.`,
      };
    }
  }

  return null;
}
