/**
 * Source catalog — the single place the UI asks "what sources exist and
 * can I use them right now?".
 *
 * Availability is computed per workspace:
 *   CONNECTED      — configured and budget available
 *   NOT_CONFIGURED — credentials/setup missing
 *   FREE_LIMIT_REACHED — safety ceiling hit (blocked, never paid)
 *   LIMITED        — configured but discovery not supported by the
 *                    official API (Meta, India registry)
 *   ERROR          — usage check failed unexpectedly
 *
 * A missing/unconfigured source NEVER breaks the Discover page — it is
 * simply reported and skipped during runs.
 */
import { listDiscoveryProviders } from "./registry";
import { checkProviderBudget, getProviderUsageSnapshot, isZeroSpendMode } from "./cost";

export type SourceAvailability =
  | "CONNECTED"
  | "NOT_CONFIGURED"
  | "FREE_LIMIT_REACHED"
  | "LIMITED"
  | "ERROR";

export interface SourceCatalogEntry {
  id: string;
  label: string;
  kind: "places" | "web" | "social" | "registry" | "import";
  description: string;
  searchable: boolean;
  availability: SourceAvailability;
  configured: boolean;
  /** Human reason for the current availability — shown verbatim. */
  reason?: string;
  usage: {
    usedRequests: number;
    usedCredits: number;
    blockedRequests: number;
    ceilingRequests?: number;
    ceilingCredits?: number;
    period: "month" | "day";
    resetLabel: string;
    /** "2,341 / 60,000" style display, or null when unmetered. */
    display: string | null;
  };
  setupInstructions: string[];
  costNote?: string;
}

const KIND_BY_ID: Record<string, SourceCatalogEntry["kind"]> = {
  "google-places": "places",
  geoapify: "places",
  openstreetmap: "places",
  tavily: "web",
  "gemini-grounding": "web",
  meta: "social",
  "india-registry": "registry",
  "csv-import": "import",
};

const DESCRIPTIONS: Record<string, string> = {
  "google-places": "Official Google Places API (New). Best coverage; phone + website detection.",
  geoapify: "Geoapify Places API. Secondary POI source / top-up when Google is unavailable.",
  openstreetmap: "OpenStreetMap via Overpass. Free fallback — no key, best-effort coverage.",
  tavily: "Tavily web search. Directory-oriented discovery with source URLs.",
  "gemini-grounding": "Gemini with Google Search grounding. AI research — every result needs a cited source.",
  meta: "Instagram / Facebook. Official APIs only — no automated discovery; manual outreach via profile links.",
  "india-registry": "MCA company registry evidence. No free public API — manual verification for now.",
  "csv-import": "Upload your own CSV of businesses. Always available.",
};

function formatUsage(
  used: number,
  ceiling?: number,
): string | null {
  if (ceiling == null) return null;
  return `${used.toLocaleString()} / ${ceiling.toLocaleString()}`;
}

export async function getSourceCatalog(organizationId: string): Promise<{
  zeroSpendMode: boolean;
  sources: SourceCatalogEntry[];
}> {
  const zeroSpendMode = isZeroSpendMode();
  const sources: SourceCatalogEntry[] = [];

  for (const p of listDiscoveryProviders()) {
    const configured = (() => {
      try {
        return p.isConfigured();
      } catch {
        return false;
      }
    })();

    let availability: SourceAvailability;
    let reason: string | undefined;
    let usage;
    try {
      const budget = await checkProviderBudget(organizationId, p.id);
      const snap = await getProviderUsageSnapshot(organizationId, p.id);
      const display =
        formatUsage(snap.usedRequests, snap.ceilingRequests) ??
        formatUsage(snap.usedCredits, snap.ceilingCredits);
      usage = {
        usedRequests: snap.usedRequests,
        usedCredits: snap.usedCredits,
        blockedRequests: snap.blockedRequests,
        ceilingRequests: snap.ceilingRequests,
        ceilingCredits: snap.ceilingCredits,
        period: snap.period,
        resetLabel: snap.resetLabel,
        display,
      };
      if (!configured) {
        availability = "NOT_CONFIGURED";
        reason = p.capabilities?.discoverySupported === false
          ? p.capabilities.discoveryUnsupportedReason
          : `${p.label} is not configured.`;
      } else if (!budget.allowed) {
        availability = "FREE_LIMIT_REACHED";
        reason = budget.reason;
      } else if (p.capabilities?.discoverySupported === false) {
        availability = "LIMITED";
        reason = p.capabilities.discoveryUnsupportedReason;
      } else {
        availability = "CONNECTED";
      }
    } catch (err) {
      availability = "ERROR";
      reason = err instanceof Error ? err.message : "Availability check failed.";
      usage = {
        usedRequests: 0,
        usedCredits: 0,
        blockedRequests: 0,
        ceilingRequests: undefined,
        ceilingCredits: undefined,
        period: "month" as const,
        resetLabel: "",
        display: null,
      };
    }

    sources.push({
      id: p.id,
      label: p.label,
      kind: KIND_BY_ID[p.id] ?? "places",
      description: DESCRIPTIONS[p.id] ?? "",
      searchable: p.searchable,
      availability,
      configured,
      reason,
      usage,
      setupInstructions: configured ? [] : p.setupInstructions(),
      costNote:
        p.id === "google-places"
          ? "Text Search bills at the Enterprise tier when website/phone fields are requested — the app caps requests at 4,000/month by default."
          : undefined,
    });
  }

  return { zeroSpendMode, sources };
}
