/**
 * Deterministic WDD Sales Opportunity Score engine (Phase 2 Step 4).
 *
 * WHAT THE SCORE MEANS:
 * "How strong is the currently available evidence that this lead has a
 * relevant WDD sales opportunity?" — it is NOT a judgment of whether the
 * company is "good" or "bad". A weak website scores HIGHER because it
 * signals a service opportunity.
 *
 * ARCHITECTURE:
 * - Pure deterministic function of verified data. No LLM, no network.
 * - Each verified field contributes to EXACTLY ONE factor (no double
 *   counting — enforced by construction and by tests).
 * - Missing data scores 0 for that sub-factor and is reported as
 *   "not available" / "insufficient evidence" — never as a negative fact.
 * - Score is always clamped to 0–100.
 *
 * FACTOR WEIGHTS (v1) — total 100:
 *   Business Fit ......... 25
 *   Website Opportunity .. 30  (gaps = opportunity; inspection required)
 *   Digital Presence ..... 20
 *   Data Completeness .... 15
 *   AI Intelligence ...... 10  (only when a Step 3 report exists)
 */
export const SCORING_VERSION = "v1";

export type ScoreProvenance =
  | "VERIFIED_DATA"
  | "AI_INFERENCE"
  | "USER_PROVIDED"
  | "DEMO_DATA";

export interface ScoreEvidenceRef {
  /** Record type: "Lead" | "Company" | "WebsiteInspection" | "LeadIntelligence" */
  source: string;
  /** Field name within the source, e.g. "metaDescription". */
  field: string;
  /** Traceable pointer, e.g. "WebsiteInspection:<id>". */
  reference: string;
}

export interface ScoreFactor {
  factor: string;
  points: number;
  maximumPoints: number;
  direction: "positive_sales_opportunity" | "neutral" | "informational";
  explanation: string;
  provenance: ScoreProvenance;
  evidence: ScoreEvidenceRef[];
}

export interface ScoreResult {
  score: number;
  scoreBand: "Low Fit" | "Moderate Fit" | "Strong Fit" | "Very Strong Fit";
  factors: ScoreFactor[];
  /** Consolidated unique evidence refs across all factors. */
  evidence: ScoreEvidenceRef[];
  warnings: string[];
  scoringVersion: string;
}

export function scoreBandFor(score: number): ScoreResult["scoreBand"] {
  if (score >= 85) return "Very Strong Fit";
  if (score >= 70) return "Strong Fit";
  if (score >= 40) return "Moderate Fit";
  return "Low Fit";
}

/** Lead/company fields the engine reads (whitelisted, no secrets). */
export interface ScoringLeadInput {
  id: string;
  fullName?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  location?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  externalId?: string | null;
  sourceUrl?: string | null;
  company?: {
    id: string;
    name?: string | null;
    website?: string | null;
    industry?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
}

export interface ScoringInspectionInput {
  id: string;
  findings: Record<string, unknown>;
}

export interface ScoringIntelligenceInput {
  id: string;
  confidence?: string | null;
  intelligence: {
    businessType?: string;
    recommendedServices?: { statement?: string }[];
  };
}

const has = (v: unknown): boolean =>
  v !== null && v !== undefined && String(v).trim() !== "";

// Industries where WDD's services (web, SEO, digital marketing) are
// typically relevant. Keyword match on the industry string.
const WDD_RELEVANT_KEYWORDS = [
  "manufactur",
  "export",
  "trad",
  "retail",
  "wholesale",
  "hospitality",
  "hotel",
  "restaurant",
  "real estate",
  "healthcare",
  "clinic",
  "hospital",
  "education",
  "school",
  "logistic",
  "construction",
  "automot",
  "textile",
  "furniture",
  "jewel",
  "travel",
  "tourism",
  "fitness",
  "gym",
  "salon",
  "spa",
  "legal",
  "consult",
  "service",
];

function industryRelevant(industry: string | null | undefined): boolean {
  if (!industry) return false;
  const lower = industry.toLowerCase();
  return WDD_RELEVANT_KEYWORDS.some((k) => lower.includes(k));
}

function ref(source: string, id: string, field: string): ScoreEvidenceRef {
  return { source, field, reference: `${source}:${id}` };
}

/** Dedupe evidence refs within a factor by source:field. */
function dedupeEvidence(ev: ScoreEvidenceRef[]): ScoreEvidenceRef[] {
  const seen = new Set<string>();
  return ev.filter((e) => {
    const key = `${e.source}:${e.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Deterministic scoring. Pure function — safe to unit test exhaustively.
 */
export function calculateScore(
  lead: ScoringLeadInput,
  inspection: ScoringInspectionInput | null,
  intelligence: ScoringIntelligenceInput | null,
): ScoreResult {
  const warnings: string[] = [];
  const factors: ScoreFactor[] = [];
  const company = lead.company ?? null;

  // ── 1. Business Fit (max 25) ──────────────────────────────────────────
  // Exclusive fields: industry, fullName (not used by any other factor).
  {
    const industry = lead.industry ?? company?.industry ?? null;
    const ev: ScoreEvidenceRef[] = [];
    let points = 0;
    const parts: string[] = [];

    if (has(industry)) {
      points += 8;
      ev.push(ref("Lead", lead.id, "industry"));
      parts.push("business category is known (+8)");
    } else {
      parts.push("business category not available (+0)");
    }
    if (industryRelevant(industry)) {
      points += 10;
      ev.push(ref("Lead", lead.id, "industry"));
      parts.push("category matches WDD service relevance (+10)");
    }
    if (has(lead.fullName) || has(company?.name)) {
      points += 7;
      ev.push(ref("Lead", lead.id, "fullName"));
      parts.push("business identity present (+7)");
    } else {
      parts.push("business identity not available (+0)");
    }

    factors.push({
      factor: "Business Fit",
      points,
      maximumPoints: 25,
      direction: "positive_sales_opportunity",
      explanation: `Category/identity fit for WDD services: ${parts.join("; ")}.`,
      provenance: "USER_PROVIDED",
      evidence: dedupeEvidence(ev),
    });
  }

  // ── 2. Website Opportunity (max 30) — gaps are opportunities ───────────
  {
    const ev: ScoreEvidenceRef[] = [];
    let points = 0;
    const parts: string[] = [];
    const f = inspection?.findings ?? null;

    if (!f) {
      factors.push({
        factor: "Website Opportunity",
        points: 0,
        maximumPoints: 30,
        direction: "neutral",
        explanation:
          "Insufficient evidence — no completed website inspection. Run Website Inspection to unlock this factor.",
        provenance: "VERIFIED_DATA",
        evidence: [],
      });
      warnings.push("Website Opportunity unscored: no website inspection available.");
    } else {
      const iid = inspection!.id;
      const reachable = typeof f.httpStatus === "number" && f.httpStatus >= 200 && f.httpStatus < 300;
      if (reachable) {
        points += 5;
        ev.push(ref("WebsiteInspection", iid, "httpStatus"));
        parts.push("website reachable (+5)");
      } else {
        parts.push("website not reachable (+0)");
      }
      if (f.metaDescription === null || f.metaDescription === undefined || f.metaDescription === "") {
        points += 5;
        ev.push(ref("WebsiteInspection", iid, "metaDescription"));
        parts.push("missing meta description — SEO opportunity (+5)");
      }
      if (f.title === null || f.title === undefined || String(f.title).trim() === "") {
        points += 4;
        ev.push(ref("WebsiteInspection", iid, "title"));
        parts.push("missing/weak title — SEO opportunity (+4)");
      }
      if (typeof f.imagesMissingAlt === "number" && f.imagesMissingAlt > 0) {
        points += 4;
        ev.push(ref("WebsiteInspection", iid, "imagesMissingAlt"));
        parts.push(`${f.imagesMissingAlt} image(s) missing alt — accessibility/SEO opportunity (+4)`);
      }
      const sitemap = f.sitemap as { available?: boolean } | undefined;
      if (sitemap && sitemap.available === false) {
        points += 3;
        ev.push(ref("WebsiteInspection", iid, "sitemap"));
        parts.push("no sitemap.xml — discoverability opportunity (+3)");
      }
      const og = f.openGraph as Record<string, unknown> | undefined;
      const ogPresent = Boolean(og && (og.title || og.description || og.image));
      if (!ogPresent) {
        points += 2;
        ev.push(ref("WebsiteInspection", iid, "openGraph"));
        parts.push("no Open Graph metadata — social sharing opportunity (+2)");
      }
      const sd = f.structuredData as { present?: boolean } | undefined;
      if (sd && sd.present === false) {
        points += 2;
        ev.push(ref("WebsiteInspection", iid, "structuredData"));
        parts.push("no structured data — rich-results opportunity (+2)");
      }
      const mobile = f.mobile as
        | { viewportPresent?: boolean; responsiveSignal?: boolean }
        | undefined;
      if (mobile && (mobile.viewportPresent === false || mobile.responsiveSignal === false)) {
        points += 3;
        ev.push(ref("WebsiteInspection", iid, "mobile"));
        parts.push("mobile/viewport weakness — mobile optimization opportunity (+3)");
      }
      const robotsTxt = f.robotsTxt as { available?: boolean } | undefined;
      if (robotsTxt && robotsTxt.available === false) {
        points += 2;
        ev.push(ref("WebsiteInspection", iid, "robotsTxt"));
        parts.push("no robots.txt — crawl-control opportunity (+2)");
      }

      factors.push({
        factor: "Website Opportunity",
        points,
        maximumPoints: 30,
        direction: "positive_sales_opportunity",
        explanation:
          parts.length > 0
            ? `Verified website gaps signal service opportunities: ${parts.join("; ")}.`
            : "Website inspected; no significant gaps found in the checked signals.",
        provenance: "VERIFIED_DATA",
        evidence: dedupeEvidence(ev),
      });
    }
  }

  // ── 3. Digital Presence (max 20) ──────────────────────────────────────
  {
    const ev: ScoreEvidenceRef[] = [];
    let points = 0;
    const parts: string[] = [];
    const f = inspection?.findings ?? null;

    const hasPlaces = has(lead.rating) || has(lead.reviewCount) || has(lead.externalId);
    if (hasPlaces) {
      points += 6;
      ev.push(ref("Lead", lead.id, "rating"));
      parts.push("Google Business presence verified (+6)");
    } else {
      parts.push("no Google Business data available (+0)");
    }
    if (typeof lead.rating === "number" && lead.rating >= 4.0) {
      points += 4;
      ev.push(ref("Lead", lead.id, "rating"));
      parts.push(`rating ${lead.rating} indicates an established business (+4)`);
    }
    if (typeof lead.reviewCount === "number" && lead.reviewCount >= 20) {
      points += 4;
      ev.push(ref("Lead", lead.id, "reviewCount"));
      parts.push(`${lead.reviewCount} reviews indicate market activity (+4)`);
    }
    const socialLinks = (f?.socialLinks as { platform?: string }[] | undefined) ?? [];
    if (socialLinks.length > 0) {
      points += 3;
      ev.push(ref("WebsiteInspection", inspection!.id, "socialLinks"));
      parts.push(`${socialLinks.length} social profile link(s) found (+3)`);
    } else if (f) {
      parts.push("no social links found on website (+0)");
    } else {
      parts.push("social presence not checked — no inspection (+0)");
    }
    const contact = f?.contact as
      | { emails?: string[]; phones?: string[] }
      | undefined;
    const contactCount = (contact?.emails?.length ?? 0) + (contact?.phones?.length ?? 0);
    if (contactCount > 0) {
      points += 3;
      ev.push(ref("WebsiteInspection", inspection!.id, "contact"));
      parts.push("public contact paths found on website (+3)");
    } else if (f) {
      parts.push("no public contact paths found (+0)");
    } else {
      parts.push("contact paths not checked — no inspection (+0)");
    }

    factors.push({
      factor: "Digital Presence",
      points,
      maximumPoints: 20,
      direction: "positive_sales_opportunity",
      explanation: `Established digital footprint: ${parts.join("; ")}.`,
      provenance: "VERIFIED_DATA",
      evidence: dedupeEvidence(ev),
    });
  }

  // ── 4. Data Completeness (max 15) — missing = not available, not bad ───
  // Exclusive fields: website, phone, email, city, sourceUrl.
  {
    const ev: ScoreEvidenceRef[] = [];
    let points = 0;
    const missing: string[] = [];

    const checks: [string, unknown, string][] = [
      ["website", lead.website ?? company?.website, "website"],
      ["phone", lead.phone, "phone"],
      ["email", lead.email, "email"],
      ["location", lead.city ?? lead.country ?? lead.location, "city"],
      ["source URL", lead.sourceUrl, "sourceUrl"],
    ];
    for (const [label, value, field] of checks) {
      if (has(value)) {
        points += 3;
        ev.push(ref("Lead", lead.id, field));
      } else {
        missing.push(label);
      }
    }

    factors.push({
      factor: "Data Completeness",
      points,
      maximumPoints: 15,
      direction: "informational",
      explanation:
        missing.length === 0
          ? "All key business data points are available."
          : `Available data scored; not available (not negative): ${missing.join(", ")}.`,
      provenance: "USER_PROVIDED",
      evidence: dedupeEvidence(ev),
    });
  }

  // ── 5. AI Intelligence (max 10) — Step 3 report as evidence layer ──────
  {
    const ev: ScoreEvidenceRef[] = [];
    let points = 0;
    const parts: string[] = [];

    if (!intelligence) {
      factors.push({
        factor: "AI Intelligence",
        points: 0,
        maximumPoints: 10,
        direction: "neutral",
        explanation:
          "Insufficient evidence — no AI intelligence report generated yet.",
        provenance: "AI_INFERENCE",
        evidence: [],
      });
      warnings.push("AI Intelligence unscored: no Step 3 report available.");
    } else {
      const iid = intelligence.id;
      points += 3;
      ev.push(ref("LeadIntelligence", iid, "confidence"));
      parts.push("AI intelligence report available (+3)");
      if (intelligence.confidence === "HIGH") {
        points += 4;
        parts.push("AI confidence HIGH (+4)");
      } else if (intelligence.confidence === "MEDIUM") {
        points += 2;
        parts.push("AI confidence MEDIUM (+2)");
      } else {
        parts.push("AI confidence LOW (+0)");
      }
      const services = intelligence.intelligence.recommendedServices ?? [];
      if (services.length >= 2) {
        points += 3;
        ev.push(ref("LeadIntelligence", iid, "recommendedServices"));
        parts.push(`${services.length} AI-recommended services (+3)`);
      } else if (services.length === 1) {
        ev.push(ref("LeadIntelligence", iid, "recommendedServices"));
        parts.push("1 AI-recommended service (+0)");
      } else {
        parts.push("no AI-recommended services (+0)");
      }

      factors.push({
        factor: "AI Intelligence",
        points,
        maximumPoints: 10,
        direction: "positive_sales_opportunity",
        explanation: `AI-identified opportunities (inference, not fact): ${parts.join("; ")}.`,
        provenance: "AI_INFERENCE",
        evidence: dedupeEvidence(ev),
      });
    }
  }

  // ── Totals ────────────────────────────────────────────────────────────
  const total = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(total)));

  // Consolidated unique evidence.
  const seen = new Set<string>();
  const evidence: ScoreEvidenceRef[] = [];
  for (const f of factors) {
    for (const e of f.evidence) {
      const key = `${e.source}:${e.field}:${e.reference}`;
      if (!seen.has(key)) {
        seen.add(key);
        evidence.push(e);
      }
    }
  }

  return {
    score,
    scoreBand: scoreBandFor(score),
    factors,
    evidence,
    warnings,
    scoringVersion: SCORING_VERSION,
  };
}
