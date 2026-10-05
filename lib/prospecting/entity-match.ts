/**
 * Cross-source entity matching — deterministic signals first.
 *
 * Example: Google Places "ABC Plastics Pvt Ltd" + web "ABC Plastics
 * Ahmedabad" + Instagram "@abcplastics" should become ONE candidate with
 * merged sources, not three CRM leads.
 *
 * Signals (deterministic, never invented):
 *   - normalized phone digits
 *   - normalized website domain
 *   - provider-scoped id (e.g. Google place_id)
 *   - instagram username
 *   - normalized business name + city
 *
 * Outcomes:
 *   MATCHED  (confidence 75–100) — merged into one candidate
 *   POSSIBLE (confidence 50–74)  — recorded, NOT merged (no false merges)
 *   UNKNOWN  — not enough signal to judge
 *   NOT_MATCHED — compared and clearly different
 *
 * AI reasoning is deliberately not used here yet: deterministic signals are
 * auditable and cannot hallucinate a match.
 */

export type EntityMatchStatus = "MATCHED" | "POSSIBLE" | "UNKNOWN" | "NOT_MATCHED";

export interface EntityIdentity {
  businessName: string | null;
  phone: string | null;
  website: string | null;
  providerId: string | null;
  instagramUsername: string | null;
  city: string | null;
}

export interface EntityMatch {
  status: EntityMatchStatus;
  /** 0–100. */
  confidence: number;
  /** Which signals fired, e.g. ["phone", "domain"]. */
  signals: string[];
}

const LEGAL_SUFFIXES = new Set([
  "pvt", "ltd", "limited", "inc", "llc", "co", "company", "companies",
  "enterprises", "enterprise", "group", "industries", "industry", "corp",
  "corporation", "llp", "opc", "studio", "studios",
]);

const STOPWORDS = new Set(["the", "and", "of", "for", "a", "an", "&"]);

/** Lowercase, strip punctuation + legal suffixes: "ABC Plastics Pvt Ltd" → "abc plastics". */
export function normalizeBusinessName(raw: string | null | undefined): string {
  const tokens = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !LEGAL_SUFFIXES.has(t) && !STOPWORDS.has(t));
  return tokens.join(" ");
}

export function normalizePhoneDigits(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export function normalizeDomainOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/** Significant tokens for overlap comparison. */
function significantTokens(normalized: string): string[] {
  return normalized.split(/\s+/).filter((t) => t.length >= 3);
}

/**
 * Directory listings often append the city ("ABC Plastics Ahmedabad").
 * Strip city tokens before comparing names so the same business matches.
 */
function stripCityTokens(normalizedName: string, city: string | null): string {
  const cityTokens = new Set(significantTokens(normalizeBusinessName(city ?? "")));
  if (cityTokens.size === 0) return normalizedName;
  return significantTokens(normalizedName)
    .filter((t) => !cityTokens.has(t))
    .join(" ");
}

export function matchEntities(a: EntityIdentity, b: EntityIdentity): EntityMatch {
  const signals: string[] = [];

  const phoneA = normalizePhoneDigits(a.phone);
  const phoneB = normalizePhoneDigits(b.phone);
  if (phoneA && phoneB && phoneA === phoneB && phoneA.length >= 7) {
    signals.push("phone");
  }

  const domainA = normalizeDomainOf(a.website);
  const domainB = normalizeDomainOf(b.website);
  if (domainA && domainB && domainA === domainB) {
    signals.push("domain");
  }

  if (a.providerId && b.providerId && a.providerId === b.providerId) {
    signals.push("provider_id");
  }

  const igA = (a.instagramUsername ?? "").toLowerCase();
  const igB = (b.instagramUsername ?? "").toLowerCase();
  if (igA && igB && igA === igB) {
    signals.push("instagram_username");
  }

  const nameA = normalizeBusinessName(a.businessName);
  const nameB = normalizeBusinessName(b.businessName);
  // Compare with city tokens stripped ("ABC Plastics Ahmedabad" → "abc plastics").
  const bareA = stripCityTokens(nameA, a.city ?? b.city);
  const bareB = stripCityTokens(nameB, b.city ?? a.city);
  const namesEqual = !!(
    (nameA && nameB && nameA === nameB) ||
    (bareA && bareB && bareA === bareB)
  );

  const cityA = (a.city ?? "").trim().toLowerCase();
  const cityB = (b.city ?? "").trim().toLowerCase();
  const sameCity = !!(cityA && cityB && (cityA.includes(cityB) || cityB.includes(cityA)));

  if (namesEqual) signals.push("name_exact");

  // ── Decision ──────────────────────────────────────────────────
  // Strong identity signals → MATCHED regardless of name spelling.
  const strong = signals.filter((s) =>
    ["phone", "domain", "provider_id", "instagram_username"].includes(s),
  );
  if (strong.length > 0) {
    return { status: "MATCHED", confidence: 95, signals };
  }
  // Same normalized name + same city → MATCHED (the ABC Plastics case).
  if (namesEqual && sameCity) {
    return { status: "MATCHED", confidence: 82, signals };
  }
  if (namesEqual) {
    return { status: "POSSIBLE", confidence: 65, signals };
  }
  // Token overlap: ≥2 significant shared tokens + same city → POSSIBLE.
  const tokensA = new Set(significantTokens(nameA));
  const overlap = significantTokens(nameB).filter((t) => tokensA.has(t));
  if (overlap.length >= 2 && sameCity) {
    return {
      status: "POSSIBLE",
      confidence: 58,
      signals: [...signals, `name_tokens:${overlap.slice(0, 3).join("+")}`],
    };
  }
  // IG username ≈ name slug → POSSIBLE (e.g. @abcplastics vs "ABC Plastics").
  const slugA = nameA.replace(/\s+/g, "");
  const slugB = nameB.replace(/\s+/g, "");
  if ((igA && slugB && igA.includes(slugB)) || (igB && slugA && igB.includes(slugA))) {
    return { status: "POSSIBLE", confidence: 55, signals: [...signals, "instagram_name_slug"] };
  }

  // Compared with enough identity to judge, but nothing matched.
  if (nameA && nameB) {
    return { status: "NOT_MATCHED", confidence: 80, signals };
  }
  return { status: "UNKNOWN", confidence: 0, signals };
}
