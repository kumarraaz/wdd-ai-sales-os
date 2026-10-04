/**
 * Pitch decision engine — chooses the single most relevant WDD service
 * angle for a prospect BEFORE any message is written.
 *
 * Deterministic and honest:
 * - No website found → pitch a first website / online presence.
 * - Website found → analyze it, pitch the strongest GENUINE opportunity.
 * - Website found but not analyzable (or already strong) → soft general
 *   opener. Problems are never invented.
 *
 * One angle per message. The message generator must pitch exactly this
 * angle and nothing else.
 */
import type { WebsiteAnalysis } from "./instagram-website";

export type PitchAngle =
  | "NEW_WEBSITE"
  | "REDESIGN"
  | "UX_CONVERSION"
  | "SEO"
  | "LOCAL_SEO"
  | "PERFORMANCE"
  | "CONTENT"
  | "GENERAL";

export const PITCH_ANGLE_LABELS: Record<PitchAngle, string> = {
  NEW_WEBSITE: "New website / online presence",
  REDESIGN: "Website redesign",
  UX_CONVERSION: "UX & enquiry flow",
  SEO: "SEO improvement",
  LOCAL_SEO: "Local SEO",
  PERFORMANCE: "Performance",
  CONTENT: "Content & presentation",
  GENERAL: "General opener",
};

/** What the chosen angle means the message should pitch (internal guidance). */
export const PITCH_ANGLE_BRIEF: Record<PitchAngle, string> = {
  NEW_WEBSITE:
    "Pitch a first professional website / landing page / online presence. Do NOT pitch restructuring — there is nothing to restructure.",
  REDESIGN:
    "Pitch a website redesign / restructuring — the site looks dated or hard to use. Do NOT pitch a brand-new website.",
  UX_CONVERSION:
    "Pitch improving the enquiry/contact flow and on-site conversion — the site exists but reaching out looks harder than it should be.",
  SEO: "Pitch SEO improvement — the site is hard to find through search on observable basics.",
  LOCAL_SEO:
    "Pitch local search visibility — the business serves a location but the site lacks basic local-search signals.",
  PERFORMANCE:
    "Pitch a technical performance cleanup — the site was observably slow to respond.",
  CONTENT:
    "Pitch content and service-presentation improvement — the site is thin or outdated.",
  GENERAL:
    "No specific problem was found. Use a soft, honest general opener. Do NOT invent any problem.",
};

export interface PitchDecision {
  angle: PitchAngle;
  /** Human-readable reason, stored/displayed for transparency. */
  reason: string;
}

export interface PitchInput {
  website: string | null;
  websiteAnalysis: WebsiteAnalysis | null;
  location: string | null;
  /** "INSUFFICIENT" etc. — kept for future use, does not invent angles. */
  confidence: string;
}

/**
 * Decide the single pitch angle. Pure function — fully unit-testable.
 */
export function decidePitchAngle(input: PitchInput): PitchDecision {
  // A. No website found in public research → first-website pitch.
  if (!input.website) {
    return {
      angle: "NEW_WEBSITE",
      reason: "No website found in public research — the opportunity is a first professional website / online presence.",
    };
  }

  const a = input.websiteAnalysis;
  // B. Website exists but could not be analyzed → honest general opener.
  if (!a || !a.fetchedOk) {
    return {
      angle: "GENERAL",
      reason: "A website was found but its homepage could not be analyzed — using a soft general opener instead of inventing problems.",
    };
  }

  // C. Score genuine, observed issues by bucket.
  let redesign = 0;
  let ux = 0;
  let seo = 0;
  let performance = 0;
  let content = 0;

  if (!a.hasViewportMeta) {
    redesign += 2; // mobile rendering is a design-level problem
  }
  if (a.copyrightYear !== null && a.copyrightYear < new Date().getFullYear() - 1) {
    redesign += 2;
    content += 1;
  }
  if (a.ctaSignals.length === 0) {
    ux += 3; // strongest single conversion signal
  }
  if (!a.hasMetaDescription) {
    seo += 2;
  }
  if (!a.title || a.title.length < 10) {
    seo += 2;
  }
  if (a.contentWords !== null && a.contentWords < 150) {
    seo += 1;
    content += 2;
  }
  if (a.fetchMs !== null && a.fetchMs > 8000) {
    performance += 3;
  }

  const scored: Array<[PitchAngle, number]> = [
    ["REDESIGN", redesign],
    ["UX_CONVERSION", ux],
    ["SEO", seo],
    ["PERFORMANCE", performance],
    ["CONTENT", content],
  ];
  // Highest score wins; ties break by listed priority (design first).
  scored.sort((x, y) => y[1] - x[1]);
  const [bestAngle, bestScore] = scored[0];

  if (bestScore > 0) {
    // Local SEO is a specialization of the SEO angle when a location is known.
    if (bestAngle === "SEO" && input.location) {
      return {
        angle: "LOCAL_SEO",
        reason: `Observable search basics are weak and the business is located in ${input.location} — the genuine opportunity is local search visibility.`,
      };
    }
    return {
      angle: bestAngle,
      reason: `Strongest genuine opportunity from website analysis: ${PITCH_ANGLE_LABELS[bestAngle].toLowerCase()}.`,
    };
  }

  // D. Website analyzed and already strong → do not invent problems.
  return {
    angle: "GENERAL",
    reason: "The website's observable basics look solid — using a soft general opener instead of inventing problems.",
  };
}
