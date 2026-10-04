/**
 * Zero-spend mode + provider usage ledger (discovery workspace).
 *
 * HARD RULES:
 * - ZERO_SPEND_MODE is ON by default. The app never intentionally moves to
 *   paid usage — there is no paid-fallback code path anywhere in discovery.
 * - Every metered provider has a conservative INTERNAL safety ceiling BELOW
 *   the vendor's published free tier. The application stops BEFORE the
 *   ceiling is reached. Vendor billing alerts are not relied upon.
 * - When a ceiling is hit the provider returns FREE_LIMIT_REACHED with a
 *   clear reason — no silent retries, no degraded paid calls.
 *
 * Usage is tracked per organization × provider × period in ProviderUsage:
 * - "month" period for monthly free tiers (Google Places, Tavily, Groq)
 * - "day" period for daily free tiers (Geoapify, Gemini grounding)
 *
 * All limits are configurable through server-side env vars (see
 * .env.example). Nothing here is client-configurable.
 */
import { db } from "../db";

function envText(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

function envInt(key: string, fallback: number): number {
  const raw = envText(key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Global kill-switch for paid usage. Defaults to "true" (ON). Set
 * ZERO_SPEND_MODE=false only if you fully understand that the per-provider
 * safety ceilings below are still hard-enforced.
 */
export function isZeroSpendMode(): boolean {
  return envText("ZERO_SPEND_MODE")?.toLowerCase() !== "false";
}

export type CeilingPeriod = "month" | "day";

export interface ProviderCeiling {
  /** Max billable HTTP requests in the period (Google, Gemini grounding, Groq). */
  requests?: number;
  /** Max provider credits in the period (Tavily, Geoapify). */
  credits?: number;
  period: CeilingPeriod;
  /** Human note shown in the Integrations UI. */
  note: string;
}

/**
 * Conservative internal safety ceilings — deliberately BELOW vendor free
 * allowances so the app stops first:
 * - Google Places: $200/mo platform credit; Text Search Enterprise ≈
 *   $35/1K → 4,000 req ≈ $140, safely under the credit.
 * - Tavily: 1,000 free credits/mo → 900 leaves headroom for manual tests.
 * - Geoapify: 3,000 free credits/day → 2,500.
 * - Gemini search grounding: 400 grounded prompts/day.
 * - Groq: conservative app-level daily ceiling (rate-limit headers honored
 *   separately where the API returns them).
 */
export function getProviderCeilings(): Record<string, ProviderCeiling> {
  return {
    "google-places": {
      requests: envInt("GOOGLE_PLACES_MONTHLY_CEILING", 4000),
      period: "month",
      note: "Internal safety ceiling below the Maps Platform monthly credit. Text Search bills at the Enterprise tier when website/phone/rating fields are requested.",
    },
    tavily: {
      credits: envInt("TAVILY_MONTHLY_CEILING", 900),
      period: "month",
      note: "900 credits/month safety ceiling; reserves capacity for manual testing.",
    },
    geoapify: {
      credits: envInt("GEOAPIFY_DAILY_CEILING", 2500),
      period: "day",
      note: "2,500 credits/day safety ceiling (vendor free tier is 3,000/day).",
    },
    "gemini-grounding": {
      requests: envInt("GEMINI_GROUNDING_DAILY_CEILING", 400),
      period: "day",
      note: "400 grounded prompts/day internal ceiling.",
    },
    groq: {
      requests: envInt("GROQ_DAILY_CEILING", 1000),
      period: "day",
      note: "Conservative per-day app ceiling; API rate-limit headers are honored too.",
    },
    openstreetmap: {
      // Unmetered API, but Overpass has a fair-use policy — the provider
      // itself rate-limits and backs off; no app ceiling needed.
      period: "day",
      note: "Free public API — no key, no billing. Fair-use limits enforced by Overpass.",
    },
  };
}

function periodStartFor(period: CeilingPeriod, now = new Date()): Date {
  if (period === "day") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function resetLabelFor(period: CeilingPeriod, periodStart: Date): string {
  if (period === "day") {
    const next = new Date(periodStart.getTime() + 24 * 3600 * 1000);
    return `Resets ${next.toISOString().slice(0, 10)} (UTC)`;
  }
  const next = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
  return `Resets ${next.toISOString().slice(0, 7)} (UTC)`;
}

export interface BudgetCheck {
  allowed: boolean;
  /** Set when blocked — shown to the user verbatim. */
  reason?: string;
  code?: "FREE_LIMIT_REACHED";
  usedRequests: number;
  usedCredits: number;
  ceilingRequests?: number;
  ceilingCredits?: number;
  period: CeilingPeriod;
  resetLabel: string;
  zeroSpendMode: boolean;
}

/**
 * Check whether the org may make another metered call to this provider.
 * Reads the current period's usage row; blocks BEFORE the ceiling.
 */
export async function checkProviderBudget(
  organizationId: string,
  providerId: string,
): Promise<BudgetCheck> {
  const ceilings = getProviderCeilings();
  const ceiling = ceilings[providerId];
  const zeroSpend = isZeroSpendMode();
  const period: CeilingPeriod = ceiling?.period ?? "month";
  const start = periodStartFor(period);

  let row: { requests: number; credits: number } | null = null;
  try {
    row = await db.providerUsage.findUnique({
      where: {
        organizationId_provider_period_periodStart: {
          organizationId,
          provider: providerId,
          period,
          periodStart: start,
        },
      },
      select: { requests: true, credits: true },
    });
  } catch {
    // If the usage table is unavailable (migration not yet deployed),
    // fail CLOSED for metered providers: block with a clear reason rather
    // than risk untracked spend.
    if (ceiling && (ceiling.requests || ceiling.credits)) {
      return {
        allowed: false,
        reason:
          "Usage tracking is unavailable (database migration pending). " +
          "Discovery is paused to protect your free-tier budget — run `prisma migrate deploy` and retry.",
        code: "FREE_LIMIT_REACHED",
        usedRequests: 0,
        usedCredits: 0,
        ceilingRequests: ceiling.requests,
        ceilingCredits: ceiling.credits,
        period,
        resetLabel: resetLabelFor(period, start),
        zeroSpendMode: zeroSpend,
      };
    }
  }

  const usedRequests = row?.requests ?? 0;
  const usedCredits = row?.credits ?? 0;
  const resetLabel = resetLabelFor(period, start);

  if (ceiling?.requests && usedRequests >= ceiling.requests) {
    return {
      allowed: false,
      code: "FREE_LIMIT_REACHED",
      reason:
        `Free-tier safety budget exhausted for this provider ` +
        `(${usedRequests.toLocaleString()} / ${ceiling.requests.toLocaleString()} requests this ${period}). ` +
        `${resetLabel}. No paid usage will be attempted.`,
      usedRequests,
      usedCredits,
      ceilingRequests: ceiling.requests,
      ceilingCredits: ceiling.credits,
      period,
      resetLabel,
      zeroSpendMode: zeroSpend,
    };
  }
  if (ceiling?.credits && usedCredits >= ceiling.credits) {
    return {
      allowed: false,
      code: "FREE_LIMIT_REACHED",
      reason:
        `Free-tier safety budget exhausted for this provider ` +
        `(${usedCredits.toLocaleString()} / ${ceiling.credits.toLocaleString()} credits this ${period}). ` +
        `${resetLabel}. No paid usage will be attempted.`,
      usedRequests,
      usedCredits,
      ceilingRequests: ceiling.requests,
      ceilingCredits: ceiling.credits,
      period,
      resetLabel,
      zeroSpendMode: zeroSpend,
    };
  }
  return {
    allowed: true,
    usedRequests,
    usedCredits,
    ceilingRequests: ceiling?.requests,
    ceilingCredits: ceiling?.credits,
    period,
    resetLabel,
    zeroSpendMode: zeroSpend,
  };
}

/** Record billable usage after a successful provider call. Never throws. */
export async function recordProviderUsage(
  organizationId: string,
  providerId: string,
  usage: { requests?: number; credits?: number },
): Promise<void> {
  const period: CeilingPeriod = getProviderCeilings()[providerId]?.period ?? "month";
  const start = periodStartFor(period);
  try {
    await db.providerUsage.upsert({
      where: {
        organizationId_provider_period_periodStart: {
          organizationId,
          provider: providerId,
          period,
          periodStart: start,
        },
      },
      create: {
        organizationId,
        provider: providerId,
        period,
        periodStart: start,
        requests: usage.requests ?? 0,
        credits: usage.credits ?? 0,
      },
      update: {
        requests: { increment: usage.requests ?? 0 },
        credits: { increment: usage.credits ?? 0 },
      },
    });
  } catch {
    // Usage recording must never break discovery — the pre-call budget
    // check is the enforcement point.
  }
}

/** Record a blocked attempt (for visibility in Integrations). Never throws. */
export async function recordBlockedAttempt(
  organizationId: string,
  providerId: string,
): Promise<void> {
  const period: CeilingPeriod = getProviderCeilings()[providerId]?.period ?? "month";
  const start = periodStartFor(period);
  try {
    await db.providerUsage.upsert({
      where: {
        organizationId_provider_period_periodStart: {
          organizationId,
          provider: providerId,
          period,
          periodStart: start,
        },
      },
      create: {
        organizationId,
        provider: providerId,
        period,
        periodStart: start,
        blockedRequests: 1,
      },
      update: { blockedRequests: { increment: 1 } },
    });
  } catch {
    /* non-fatal */
  }
}

/** Current-period usage snapshot for the Integrations UI. */
export async function getProviderUsageSnapshot(
  organizationId: string,
  providerId: string,
): Promise<{
  usedRequests: number;
  usedCredits: number;
  blockedRequests: number;
  ceilingRequests?: number;
  ceilingCredits?: number;
  period: CeilingPeriod;
  resetLabel: string;
}> {
  const ceiling = getProviderCeilings()[providerId];
  const period: CeilingPeriod = ceiling?.period ?? "month";
  const start = periodStartFor(period);
  let row: { requests: number; credits: number; blockedRequests: number } | null = null;
  try {
    row = await db.providerUsage.findUnique({
      where: {
        organizationId_provider_period_periodStart: {
          organizationId,
          provider: providerId,
          period,
          periodStart: start,
        },
      },
      select: { requests: true, credits: true, blockedRequests: true },
    });
  } catch {
    row = null;
  }
  return {
    usedRequests: row?.requests ?? 0,
    usedCredits: row?.credits ?? 0,
    blockedRequests: row?.blockedRequests ?? 0,
    ceilingRequests: ceiling?.requests,
    ceilingCredits: ceiling?.credits,
    period,
    resetLabel: resetLabelFor(period, start),
  };
}
