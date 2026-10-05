/**
 * AI sales agent — daily prospecting pipeline (multi-source).
 *
 * Flow per run:
 *   plan day → quota check → MULTI-SOURCE ACQUISITION (Google Places,
 *   Instagram via public web search, public web) with a research pool
 *   ~3x the target → CROSS-SOURCE ENTITY MERGE → GLOBAL DEDUPLICATION
 *   → INDUSTRY CLASSIFICATION (AI + deterministic) → VERIFICATION
 *   (HIGH/MEDIUM/LOW/REJECTED) → per-profile research → pitch decision
 *   → AI message (quality-gated, draft only) → best-N CRM import
 *   → run statistics + notification.
 *
 * Source honesty is preserved end to end:
 * - Instagram discovery is public web search (Tavily), never the Instagram
 *   API; profiles are LISTED, never fetched; follower counts and connection
 *   status are never guessed (UNKNOWN unless a compliant source provides
 *   them, marked UNVERIFIED when a threshold is configured but unverifiable).
 * - Google Places is business discovery, not an Instagram source.
 * - Every imported lead carries verification confidence, reason, sources,
 *   and industry classification provenance. Missing fields stay null.
 *
 * Global dedup (canonical normalized usernames + phone/domain/email) covers:
 *   1. today's merged candidate set
 *   2. existing CRM leads
 *   3. existing Instagram Outreach batch items
 * Database-level uniqueness backs the run identity (one run per org/day).
 *
 * Failure isolation: one bad candidate never stops the run — it is counted
 * as failed and the run continues. Kill switch and quotas are respected.
 * No source is ever faked: an empty pool yields FAILED with an honest
 * reason; a partially-failed acquisition yields PARTIAL.
 *
 * This phase does NOT implement reply handling or automatic sending.
 * Messages are drafts stored on the Lead; the user sends manually.
 */
import { db } from "../db";
import { audit } from "../audit";
import { createLead, findDuplicate } from "../leads";
import { isKillSwitchOn } from "../automation/types";
import { checkDiscoveryQuota, recordDiscoveryUsage } from "../quotas";
import { instagramProfileUrl } from "../outreach/instagram";
import { researchAndDraft } from "../outreach/instagram-service";
import { scoreDiscoveredCompany } from "../discovery/candidates";
import type { PitchAngle } from "../outreach/instagram-pitch";
import { decidePitchAngle } from "../outreach/instagram-pitch";
import {
  analyzeWebsite,
  summarizeWebsiteAnalysis,
  type WebsiteAnalysis,
} from "../outreach/instagram-website";
import { generateBusinessMessage } from "../outreach/instagram-message";
import { getTodayDay } from "./instagram-plan";
import {
  type DiscoveryDeps,
  type ProspectingDayTarget,
} from "./instagram-discovery";
import type { ResearchDeps } from "../outreach/instagram-research";
import { acquireCandidates, mergeCandidates, type AgentCandidate } from "./acquire";
import {
  verifyCandidate,
  type VerificationResult,
  type VerificationConfidence,
  type SourceRef,
} from "./verification";
import { classifyIndustry, type IndustryClassification } from "./industry-classify";
import {
  matchEntities,
  normalizeBusinessName,
  normalizeDomainOf,
  type EntityIdentity,
} from "./entity-match";
import { notifyRunCompleted } from "./notifications";

export interface DailyRunStats {
  runId: string;
  runDate: string;
  dayOfWeek: number;
  industry: string;
  targetCount: number;
  /** Merged candidates researched (research pool, ~3x target). */
  found: number;
  /** Candidates that passed dedup + verification (import-eligible). */
  newCount: number;
  duplicatesSkipped: number;
  researched: number;
  messagesGenerated: number;
  crmImported: number;
  failed: number;
  /** HIGH + acceptable MEDIUM candidates. */
  verified: number;
  /** LOW/REJECTED + website-preference filtered. */
  rejected: number;
  /** Imported leads per primary source type. */
  sourceBreakdown: Record<string, number>;
  /** Wall-clock run duration in ms (null when unknown). */
  durationMs: number | null;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  triggeredBy: string;
}

export interface DailyRunDeps {
  discoveryDeps?: DiscoveryDeps;
  researchDeps?: ResearchDeps;
  now?: Date;
}

/**
 * How long a RUNNING run may go without finishing before a new trigger is
 * allowed to take it over. Aligned with the job engine's stale-job recovery
 * (15 min): if the worker died mid-run (e.g. serverless timeout), the next
 * manual press or scheduled tick resumes instead of 409-blocking forever.
 * A genuinely live run is always younger than this, so one-run-per-day
 * protection is preserved.
 */
export const STALE_RUN_TAKEOVER_MS = 15 * 60_000;

/** Pitch angle → deterministic CRM opportunity tier. */
function opportunityForAngle(angle: PitchAngle): { type: string; reason: string } {
  switch (angle) {
    case "NEW_WEBSITE":
      return {
        type: "HIGH",
        reason: "No website found in public research — first-website opportunity.",
      };
    case "REDESIGN":
    case "UX_CONVERSION":
    case "SEO":
    case "LOCAL_SEO":
    case "PERFORMANCE":
    case "CONTENT":
      return {
        type: "MEDIUM",
        reason: `Genuine website improvement opportunity observed (${angle.toLowerCase().replace(/_/g, " ")}).`,
      };
    default:
      return {
        type: "LOW",
        reason: "Contactable Instagram profile; no specific website problem observed.",
      };
  }
}

/**
 * Global duplicate check for a normalized username (org-scoped):
 * existing CRM leads (username field + profile-URL fallback) and
 * existing Instagram Outreach batch items.
 */
export async function findExistingInstagramProspect(
  organizationId: string,
  username: string,
): Promise<{ kind: "lead" | "outreach_item"; id: string } | null> {
  const lead = await db.lead.findFirst({
    where: {
      organizationId,
      OR: [
        { instagramUsername: username },
        { instagramUrl: { contains: username, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (lead) return { kind: "lead", id: lead.id };
  const item = await db.instagramOutreachItem.findFirst({
    where: { organizationId, username },
    select: { id: true },
  });
  if (item) return { kind: "outreach_item", id: item.id };
  return null;
}

async function failRun(
  organizationId: string,
  actorId: string,
  runId: string,
  error: string,
  partial: Partial<DailyRunStats>,
): Promise<DailyRunStats> {
  const finishedAt = new Date();
  await db.instagramProspectingRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      error,
      finishedAt,
      verified: partial.verified ?? 0,
      rejected: partial.rejected ?? 0,
      sourceBreakdown: partial.sourceBreakdown ?? {},
      durationMs: partial.durationMs ?? null,
      ...partial,
    },
  });
  await audit({
    organizationId,
    actorId,
    action: "prospecting.instagram.run_failed",
    resource: "instagram_prospecting_run",
    resourceId: runId,
    result: "FAILED",
    metadata: { error },
  });
  // Best-effort: a notification failure must never fail the run itself.
  try {
    await notifyRunCompleted(organizationId, {
      runId,
      runDate: partial.runDate ?? "",
      status: "FAILED",
      triggeredBy: partial.triggeredBy ?? "SCHEDULED",
      targetCount: partial.targetCount ?? 0,
      candidates: partial.found ?? 0,
      verified: partial.verified ?? 0,
      imported: partial.crmImported ?? 0,
      duplicates: partial.duplicatesSkipped ?? 0,
      rejected: partial.rejected ?? 0,
      failed: partial.failed ?? 0,
      error,
      sourceBreakdown: partial.sourceBreakdown ?? {},
    });
  } catch {
    /* notification is best-effort */
  }
  return {
    runId,
    runDate: "",
    dayOfWeek: -1,
    industry: "",
    targetCount: 0,
    found: 0,
    newCount: 0,
    duplicatesSkipped: 0,
    researched: 0,
    messagesGenerated: 0,
    crmImported: 0,
    failed: 0,
    verified: 0,
    rejected: 0,
    sourceBreakdown: {},
    durationMs: null,
    status: "FAILED",
    triggeredBy: "SCHEDULED",
    ...partial,
  } as DailyRunStats;
}

/**
 * Global duplicate check for a business candidate (org-scoped): existing
 * CRM leads by email/phone/website-domain, plus the Instagram checks when
 * the candidate carries a username. Name-only matches are intentionally
 * not pre-checked here — createLead's duplicate detection is the backstop
 * at import time.
 */
export async function findExistingBusinessProspect(
  organizationId: string,
  candidate: AgentCandidate,
): Promise<{ kind: "lead" | "outreach_item"; id: string } | null> {
  const dup = await findDuplicate(organizationId, {
    email: candidate.email ?? undefined,
    phone: candidate.phone ?? undefined,
    website: candidate.website ?? undefined,
  });
  if (dup) return { kind: "lead", id: dup.id };
  if (candidate.instagramUsername) {
    return findExistingInstagramProspect(organizationId, candidate.instagramUsername);
  }
  return null;
}

/**
 * "Acceptable MEDIUM": verified by one strong source AND relevant enough.
 * HIGH is always importable; LOW/REJECTED never are.
 */
function isImportable(verification: VerificationResult, relevance: number): boolean {
  if (verification.confidence === "HIGH") return true;
  if (verification.confidence === "MEDIUM" && relevance >= 60) return true;
  return false;
}

export async function runDailyProspecting(
  organizationId: string,
  actorId: string,
  opts: {
    triggeredBy?: "SCHEDULED" | "MANUAL";
    now?: Date;
    deps?: DailyRunDeps;
  } = {},
): Promise<DailyRunStats> {
  const triggeredBy = opts.triggeredBy ?? "SCHEDULED";
  const now = opts.now ?? new Date();
  const deps = opts.deps ?? {};

  if (isKillSwitchOn()) {
    throw new Error("KILL_SWITCH_ACTIVE");
  }

  const today = await getTodayDay(organizationId, now);
  if (!today) {
    throw new Error("NO_ACTIVE_PLAN_DAY");
  }
  const { plan, day, runDate, dayOfWeek } = today;

  // One run per org per day: reuse a completed run (idempotent), refuse to
  // double-run while one is queued or freshly running, allow retry after
  // FAILED, and take over a stale RUNNING/QUEUED run whose worker died
  // (e.g. serverless timeout) instead of blocking forever.
  const existingRun = await db.instagramProspectingRun.findUnique({
    where: { organizationId_runDate: { organizationId, runDate } },
  });
  if (existingRun?.status === "COMPLETED") {
    const s = existingRun;
    return {
      runId: s.id,
      runDate: s.runDate,
      dayOfWeek: s.dayOfWeek,
      industry: day.industry,
      targetCount: s.targetCount,
      found: s.found,
      newCount: s.newCount,
      duplicatesSkipped: s.duplicatesSkipped,
      researched: s.researched,
      messagesGenerated: s.messagesGenerated,
      crmImported: s.crmImported,
      failed: s.failed,
      verified: s.verified,
      rejected: s.rejected,
      sourceBreakdown: (s.sourceBreakdown as Record<string, number> | null) ?? {},
      durationMs: s.durationMs,
      status: "COMPLETED",
      triggeredBy: s.triggeredBy,
    };
  }
  const isStale = (startedAt: Date) => now.getTime() - startedAt.getTime() > STALE_RUN_TAKEOVER_MS;
  if (existingRun?.status === "RUNNING" && !isStale(existingRun.startedAt)) {
    throw new Error("RUN_ALREADY_IN_PROGRESS");
  }

  const takeOver =
    existingRun?.status === "QUEUED" ||
    (existingRun?.status === "RUNNING" && isStale(existingRun.startedAt));
  if (takeOver && existingRun) {
    await audit({
      organizationId,
      actorId,
      action: "prospecting.instagram.run_takeover",
      resource: "instagram_prospecting_run",
      resourceId: existingRun.id,
      result: "SUCCESS",
      metadata: {
        runDate,
        previousStatus: existingRun.status,
        previousStartedAt: existingRun.startedAt.toISOString(),
        triggeredBy,
      },
    });
  }

  // Quota gate — respects the existing per-day discovery quotas.
  const quota = await checkDiscoveryQuota(organizationId, day.targetCount);
  if (!quota.allowed) {
    await audit({
      organizationId,
      actorId,
      action: "prospecting.instagram.quota_blocked",
      metadata: { reason: quota.reason, runDate },
      result: "DENIED",
    });
    throw new Error(`QUOTA_EXCEEDED: ${quota.reason ?? "daily discovery quota reached"}`);
  }

  const run = existingRun
    ? await db.instagramProspectingRun.update({
        where: { id: existingRun.id },
        data: {
          status: "RUNNING",
          error: null,
          finishedAt: null,
          startedAt: now,
          found: 0,
          newCount: 0,
          duplicatesSkipped: 0,
          researched: 0,
          messagesGenerated: 0,
          crmImported: 0,
          failed: 0,
          verified: 0,
          rejected: 0,
          sourceBreakdown: {},
          durationMs: null,
          triggeredBy,
          targetCount: day.targetCount,
          dayOfWeek,
          planId: plan.id,
        },
      })
    : await db.instagramProspectingRun.create({
        data: {
          organizationId,
          planId: plan.id,
          dayOfWeek,
          runDate,
          targetCount: day.targetCount,
          triggeredBy,
        },
      });

  await audit({
    organizationId,
    actorId,
    action: "prospecting.instagram.run_started",
    resource: "instagram_prospecting_run",
    resourceId: run.id,
    metadata: { runDate, industry: day.industry, targetCount: day.targetCount, triggeredBy },
  });

  const startedAtMs = Date.now();
  const elapsedMs = () => Date.now() - startedAtMs;
  const stats = {
    found: 0,
    newCount: 0,
    duplicatesSkipped: 0,
    researched: 0,
    messagesGenerated: 0,
    crmImported: 0,
    failed: 0,
    verified: 0,
    rejected: 0,
  };
  const sourceBreakdown: Record<string, number> = {};

  interface VerifiedItem {
    candidate: AgentCandidate;
    verification: VerificationResult;
    classification: IndustryClassification;
    primarySourceType: string;
    message: { text: string; source: "ai" | "template" };
    hasWebsite: boolean;
    website: string | null;
    score: number;
    scoreReason: string;
    opportunityType: string;
    opportunityReason: string;
    researchLabel: string;
    activityType: string;
  }

  try {
    // ── 1. Multi-source acquisition (research pool ~3x target) ──────
    const target: ProspectingDayTarget = {
      industry: day.industry,
      location: day.location,
      country: day.country,
      businessType: day.businessType,
      targetAudience: day.targetAudience,
      websitePreference: day.websitePreference,
      targetCount: day.targetCount,
    };
    const poolSize = Math.min(Math.max(day.targetCount * 3, 1), 200);
    const acquired = await acquireCandidates(target, {
      discoveryDeps: deps.discoveryDeps,
      poolSize,
    });

    // ── 2. Cross-source entity merge ───────────────────────────────
    const merged = mergeCandidates(acquired.candidates);
    stats.found = merged.length;

    const anySourceError = acquired.sourceNotes.some((n) => n.status === "error");
    const allSkipped = acquired.sourceNotes.every((n) => n.status === "skipped");

    // ── 2b. Empty pool: honest FAILED — never fake data ────────────
    if (merged.length === 0) {
      const reason = allSkipped
        ? "No discovery sources configured — set TAVILY_API_KEY and/or GOOGLE_PLACES_API_KEY to enable the AI sales agent."
        : `Discovery returned no candidates. ${acquired.sourceNotes
            .map((n) => `${n.provider}: ${n.note}`)
            .join(" ")}`;
      return failRun(organizationId, actorId, run.id, reason, {
        runDate,
        dayOfWeek,
        industry: day.industry,
        targetCount: day.targetCount,
        triggeredBy,
        ...stats,
        sourceBreakdown,
        durationMs: elapsedMs(),
      });
    }

    // ── 3. Verify → research → score (per-item failure isolation) ───
    const verifiedItems: VerifiedItem[] = [];
    const seenInRun = new Set<string>();
    let aiClassifications = 0;
    const AI_CLASSIFY_BUDGET = 80; // bounded execution: never an AI call per candidate without limit
    let index = 0;

    for (const candidate of merged) {
      index++;
      try {
        // In-run dedup across sources (identity key).
        const runKey =
          candidate.instagramUsername ??
          candidate.googlePlaceId ??
          normalizeDomainOf(candidate.website) ??
          `${normalizeBusinessName(candidate.businessName)}|${(candidate.city ?? "").toLowerCase()}`;
        if (!runKey || seenInRun.has(runKey)) {
          stats.duplicatesSkipped++;
          continue;
        }
        seenInRun.add(runKey);

        // Global dedup: CRM leads (+ outreach items for Instagram).
        const existing = candidate.instagramUsername
          ? await findExistingInstagramProspect(organizationId, candidate.instagramUsername)
          : await findExistingBusinessProspect(organizationId, candidate);
        if (existing) {
          stats.duplicatesSkipped++;
          continue;
        }

        const skipAi = aiClassifications >= AI_CLASSIFY_BUDGET;

        if (candidate.instagramUsername) {
          // ── Instagram path: research first (business facts are only
          // known after research), then classify + verify.
          const username = candidate.instagramUsername;
          const { research, decision, generated } = await researchAndDraft(
            username,
            deps.researchDeps,
            index % 5,
          );
          stats.researched++;

          const hasWebsite = !!research.website;
          if (day.websitePreference === "NO_WEBSITE" && hasWebsite) {
            stats.rejected++;
            continue;
          }
          if (day.websitePreference === "HAS_WEBSITE" && !hasWebsite) {
            stats.rejected++;
            continue;
          }

          const classification = await classifyIndustry(
            {
              businessName: research.businessName,
              category: research.category,
              location: research.location,
              website: research.website,
              observations: research.observations,
              sourceLabels: [
                "Tavily public web search",
                ...(research.website ? ["business website"] : []),
              ],
            },
            day.industry,
            { skipAi },
          );
          if (classification.classifiedBy === "ai") aiClassifications++;

          const sources: SourceRef[] = [...candidate.sources];
          if (research.website) {
            sources.push({
              provider: "business-website",
              sourceType: "WEB_SEARCH",
              url: research.website,
              retrievedAt: new Date().toISOString(),
              label: "Business website (found in public research)",
            });
          }
          const verification = verifyCandidate({
            businessName: research.businessName,
            category: research.category,
            city: research.location,
            country: day.country,
            website: research.website,
            phone: null,
            instagramUsername: username,
            targetIndustry: day.industry,
            targetLocation: day.location,
            targetCountry: day.country,
            sources,
            industryRelevance: classification.relevanceScore,
          });
          if (!isImportable(verification, classification.relevanceScore)) {
            stats.rejected++;
            continue;
          }
          stats.verified++;

          const scored = scoreDiscoveredCompany(
            {
              name: research.businessName ?? username,
              phone: undefined,
              email: undefined,
              category: research.category ?? day.industry,
              city: research.location ?? day.location ?? undefined,
              state: undefined,
              country: day.country ?? undefined,
              rating: undefined,
              reviewCount: undefined,
              sourceUrl: research.profileUrl,
              provider: "instagram-prospecting" as never,
            },
            hasWebsite ? "HAS_WEBSITE" : "UNKNOWN",
            { industry: day.industry, location: day.location ?? day.country ?? "" },
          );
          const opportunity = opportunityForAngle(decision.angle);
          verifiedItems.push({
            candidate: {
              ...candidate,
              businessName: research.businessName,
              category: research.category,
              city: research.location,
              website: research.website,
              sources: sources.map((s) => ({
                provider: s.provider,
                sourceType: s.sourceType,
                url: s.url,
                retrievedAt: s.retrievedAt,
                label: s.label ?? s.provider,
              })),
            },
            verification,
            classification,
            primarySourceType: "INSTAGRAM",
            message: generated,
            hasWebsite,
            website: research.website,
            score: scored.score,
            scoreReason: scored.scoreReason.replace(
              "No website (Google authoritative)",
              "No website found in research",
            ),
            opportunityType: opportunity.type,
            opportunityReason: `${opportunity.reason} Pitch angle: ${decision.angle}.`,
            researchLabel: `@${username}`,
            activityType: "instagram_prospected",
          });
        } else {
          // ── Business path (Google Places / web): classify + verify
          // BEFORE expensive research — only verified candidates get a
          // website analysis and a generated message.
          const classification = await classifyIndustry(
            {
              businessName: candidate.businessName,
              category: candidate.category,
              location:
                [candidate.city, candidate.country].filter(Boolean).join(", ") || null,
              website: candidate.website,
              observations: candidate.address,
              sourceLabels: candidate.sources.map((s) => s.label),
            },
            day.industry,
            { skipAi },
          );
          if (classification.classifiedBy === "ai") aiClassifications++;

          const verification = verifyCandidate({
            businessName: candidate.businessName,
            category: candidate.category,
            city: candidate.city,
            country: candidate.country,
            website: candidate.website,
            phone: candidate.phone,
            instagramUsername: null,
            providerId: candidate.googlePlaceId,
            targetIndustry: day.industry,
            targetLocation: day.location,
            targetCountry: day.country,
            sources: candidate.sources,
            industryRelevance: classification.relevanceScore,
          });
          if (!isImportable(verification, classification.relevanceScore)) {
            stats.rejected++;
            continue;
          }

          // Research: SSRF-safe website analysis + pitch angle + message.
          let websiteAnalysis: WebsiteAnalysis | null = null;
          if (candidate.website) {
            try {
              websiteAnalysis = await analyzeWebsite(candidate.website);
            } catch {
              websiteAnalysis = null;
            }
          }
          stats.researched++;

          const hasWebsite = !!candidate.website;
          if (day.websitePreference === "NO_WEBSITE" && hasWebsite) {
            stats.rejected++;
            continue;
          }
          if (day.websitePreference === "HAS_WEBSITE" && !hasWebsite) {
            stats.rejected++;
            continue;
          }

          const decision = decidePitchAngle({
            website: candidate.website,
            websiteAnalysis,
            location: candidate.city,
            confidence: verification.confidence,
          });
          const generated = await generateBusinessMessage(
            {
              username: "",
              businessName: candidate.businessName,
              category: candidate.category ?? classification.industry,
              location:
                [candidate.city, candidate.country].filter(Boolean).join(", ") || null,
              website: candidate.website,
              observations: candidate.address,
              pitchAngle: decision.angle,
              websiteSummary: summarizeWebsiteAnalysis(websiteAnalysis),
            },
            undefined,
            { variationSeed: index },
          );
          stats.verified++;

          const scored = scoreDiscoveredCompany(
            {
              name: candidate.businessName ?? "Unknown business",
              phone: candidate.phone ?? undefined,
              email: candidate.email ?? undefined,
              category: candidate.category ?? day.industry,
              city: candidate.city ?? day.location ?? undefined,
              state: undefined,
              country: candidate.country ?? day.country ?? undefined,
              rating: candidate.rating ?? undefined,
              reviewCount: undefined,
              sourceUrl: candidate.googleMapsUrl ?? candidate.website ?? undefined,
              provider: "google-places" as never,
            },
            hasWebsite ? "HAS_WEBSITE" : "UNKNOWN",
            { industry: day.industry, location: day.location ?? day.country ?? "" },
          );
          const opportunity = opportunityForAngle(decision.angle);
          verifiedItems.push({
            candidate,
            verification,
            classification,
            primarySourceType: candidate.sources[0]?.sourceType ?? "WEB_SEARCH",
            message: generated,
            hasWebsite,
            website: candidate.website,
            score: scored.score,
            scoreReason: scored.scoreReason,
            opportunityType: opportunity.type,
            opportunityReason: `${opportunity.reason} Pitch angle: ${decision.angle}.`,
            researchLabel: candidate.businessName ?? candidate.website ?? "business",
            activityType: "prospected",
          });
        }
      } catch {
        stats.failed++;
      }
    }

    // ── 4. Select: best-first, HIGH before MEDIUM, capped at target ──
    stats.newCount = verifiedItems.length;
    const rank = (c: VerificationConfidence) => (c === "HIGH" ? 0 : 1);
    verifiedItems.sort(
      (a, b) =>
        rank(a.verification.confidence) - rank(b.verification.confidence) ||
        b.score - a.score,
    );
    const toImport = verifiedItems.slice(0, Math.max(day.targetCount, 0));

    // ── 5. CRM import (per-item isolation) ──────────────────────────
    for (const item of toImport) {
      try {
        const v = item.verification;
        const c = item.candidate;
        const mergedSourceTypes = [...new Set(c.sources.map((s) => s.sourceType))];
        // Follower honesty: the plan threshold is stored but compliant
        // sources provide no follower counts — mark it, don't invent it.
        const followerNote =
          day.followerThreshold != null && item.primarySourceType === "INSTAGRAM"
            ? " Follower threshold configured but follower count is unverifiable from compliant sources (FOLLOWER_COUNT_UNVERIFIED)."
            : "";
        const { lead, duplicate } = await createLead(
          organizationId,
          actorId,
          {
            fullName: c.businessName?.trim() || undefined,
            companyName: c.businessName?.trim() || undefined,
            industry:
              item.classification.industry !== "Unknown"
                ? item.classification.industry
                : day.industry,
            location: c.city?.trim() || day.location || undefined,
            country: c.country?.trim() || day.country || undefined,
            city: c.city?.trim() || day.location || undefined,
            phone: c.phone?.trim() || undefined,
            email: c.email?.trim() || undefined,
            website: item.website?.trim() || undefined,
            googleMapsUrl: c.googleMapsUrl?.trim() || undefined,
            instagramUrl: c.instagramUrl ?? undefined,
            instagramUsername: c.instagramUsername ?? undefined,
            // Connection status is never guessed — UNKNOWN until verified.
            instagramConnectionStatus: "UNKNOWN",
            aiMessage: item.message.text,
            aiMessageSource: item.message.source,
            websiteStatus: item.hasWebsite ? "HAS_WEBSITE" : "UNKNOWN",
            opportunityType: item.opportunityType as never,
            opportunityReason: item.opportunityReason,
            contactable: !!(c.phone || c.email || item.website || c.instagramUsername),
            leadScore: item.score,
            scoreReason: item.scoreReason,
            verificationConfidence: v.confidence,
            verificationReason: `${v.reason}${followerNote}`.trim(),
            verificationSources: c.sources.slice(0, 5).map((s) => ({
              provider: s.provider,
              sourceType: s.sourceType,
              url: s.url,
              retrievedAt: s.retrievedAt,
              label: s.label,
            })),
            verifiedAt: new Date().toISOString(),
            industryRelevance: item.classification.relevanceScore,
            industryReasoning: item.classification.reasoning,
            followerCountStatus: "UNKNOWN",
            mergedSourceTypes,
            status: v.confidence === "HIGH" ? "VERIFIED" : "NEW",
            sourceType: item.primarySourceType as never,
            sourceDetail: `AI sales agent ${runDate}: ${item.researchLabel} — ${day.industry}`,
            sourceUrl: c.googleMapsUrl ?? item.website ?? c.instagramUrl ?? undefined,
            discoveredAt: new Date().toISOString(),
          },
          { sourceType: item.primarySourceType, dataLabel: "AI_INFERENCE" },
        );

        if (duplicate) {
          // Same business already in CRM (matched by email/phone/domain) —
          // enrich missing Instagram fields instead of double-counting.
          stats.duplicatesSkipped++;
          stats.newCount--;
          stats.verified--;
          if (c.instagramUsername) {
            const updates: Record<string, unknown> = {};
            if (!lead.instagramUsername) updates.instagramUsername = c.instagramUsername;
            if (!lead.instagramUrl && c.instagramUrl) updates.instagramUrl = c.instagramUrl;
            if (!lead.aiMessage) {
              updates.aiMessage = item.message.text;
              updates.aiMessageSource = item.message.source;
            }
            if (Object.keys(updates).length > 0) {
              await db.lead.update({ where: { id: lead.id }, data: updates });
            }
          }
        } else {
          stats.crmImported++;
          sourceBreakdown[item.primarySourceType] =
            (sourceBreakdown[item.primarySourceType] ?? 0) + 1;
        }

        await db.leadActivity.create({
          data: {
            organizationId,
            leadId: lead.id,
            type: item.activityType,
            title: `AI sales agent: ${item.researchLabel} discovered (${runDate})`,
            detail: `Verification: ${v.confidence}. Message: ${item.message.source} (draft — user sends manually).`,
            actorId,
          },
        });

        stats.messagesGenerated++;
      } catch {
        stats.failed++;
      }
    }

    // ── 6. Finish: PARTIAL when a source errored, else COMPLETED ────
    const finalStatus = anySourceError ? "PARTIAL" : "COMPLETED";
    const finalDurationMs = elapsedMs();
    await db.instagramProspectingRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        durationMs: finalDurationMs,
        sourceBreakdown,
        ...stats,
      },
    });
    await audit({
      organizationId,
      actorId,
      action: "prospecting.instagram.run_completed",
      resource: "instagram_prospecting_run",
      resourceId: run.id,
      metadata: { runDate, triggeredBy, ...stats, sourceBreakdown },
    });
    // Best-effort user notification ("47 new verified leads added").
    try {
      await notifyRunCompleted(organizationId, {
        runId: run.id,
        runDate,
        status: finalStatus,
        triggeredBy,
        targetCount: day.targetCount,
        candidates: stats.found,
        verified: stats.verified,
        imported: stats.crmImported,
        duplicates: stats.duplicatesSkipped,
        rejected: stats.rejected,
        failed: stats.failed,
        sourceBreakdown,
      });
    } catch {
      /* notification is best-effort */
    }

    await recordDiscoveryUsage(organizationId, {
      searches: acquired.searchesMade,
      records: stats.newCount,
      imports: stats.crmImported,
    });

    return {
      runId: run.id,
      runDate,
      dayOfWeek,
      industry: day.industry,
      targetCount: day.targetCount,
      status: finalStatus,
      triggeredBy,
      ...stats,
      sourceBreakdown,
      durationMs: finalDurationMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Run failed.";
    return failRun(organizationId, actorId, run.id, message, {
      runDate,
      dayOfWeek,
      industry: day.industry,
      targetCount: day.targetCount,
      triggeredBy,
      ...stats,
      sourceBreakdown,
      durationMs: elapsedMs(),
    });
  }
}
