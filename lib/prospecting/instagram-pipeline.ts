/**
 * Instagram prospecting — daily run pipeline.
 *
 * Flow per run:
 *   plan day → quota check → username discovery (compliant web search)
 *   → GLOBAL DEDUPLICATION → per-profile research → pitch decision
 *   → AI message (quality-gated) → CRM import → run statistics.
 *
 * Global dedup (canonical normalized usernames) covers:
 *   1. today's discovery set
 *   2. existing CRM leads (instagramUsername, plus instagramUrl fallback)
 *   3. existing Instagram Outreach batch items
 * Database-level uniqueness backs the run identity (one run per org/day).
 *
 * Failure isolation: one bad profile never stops the run — it is counted
 * as failed and the run continues. Kill switch and quotas are respected.
 *
 * This phase does NOT implement reply handling or automatic sending.
 * Messages are drafts stored on the Lead; the user sends manually.
 */
import { db } from "../db";
import { audit } from "../audit";
import { createLead } from "../leads";
import { isKillSwitchOn } from "../automation/types";
import { checkDiscoveryQuota, recordDiscoveryUsage } from "../quotas";
import { instagramProfileUrl } from "../outreach/instagram";
import { researchAndDraft } from "../outreach/instagram-service";
import { scoreDiscoveredCompany } from "../discovery/candidates";
import type { PitchAngle } from "../outreach/instagram-pitch";
import { getTodayDay } from "./instagram-plan";
import {
  discoverInstagramUsernames,
  type DiscoveryDeps,
  type ProspectingDayTarget,
} from "./instagram-discovery";
import type { ResearchDeps } from "../outreach/instagram-research";

export interface DailyRunStats {
  runId: string;
  runDate: string;
  dayOfWeek: number;
  industry: string;
  targetCount: number;
  found: number;
  newCount: number;
  duplicatesSkipped: number;
  researched: number;
  messagesGenerated: number;
  crmImported: number;
  failed: number;
  status: "COMPLETED" | "FAILED";
  triggeredBy: string;
}

export interface DailyRunDeps {
  discoveryDeps?: DiscoveryDeps;
  researchDeps?: ResearchDeps;
  now?: Date;
}

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
  await db.instagramProspectingRun.update({
    where: { id: runId },
    data: { status: "FAILED", error, finishedAt: new Date(), ...partial },
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
    status: "FAILED",
    triggeredBy: "SCHEDULED",
    ...partial,
  } as DailyRunStats;
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
  // double-run while RUNNING, allow retry after FAILED.
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
      status: "COMPLETED",
      triggeredBy: s.triggeredBy,
    };
  }
  if (existingRun?.status === "RUNNING") {
    throw new Error("RUN_ALREADY_IN_PROGRESS");
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
          found: 0,
          newCount: 0,
          duplicatesSkipped: 0,
          researched: 0,
          messagesGenerated: 0,
          crmImported: 0,
          failed: 0,
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

  const stats = {
    found: 0,
    newCount: 0,
    duplicatesSkipped: 0,
    researched: 0,
    messagesGenerated: 0,
    crmImported: 0,
    failed: 0,
  };

  try {
    // ── 1. Discovery ──────────────────────────────────────────────
    const target: ProspectingDayTarget = {
      industry: day.industry,
      location: day.location,
      country: day.country,
      businessType: day.businessType,
      targetAudience: day.targetAudience,
      websitePreference: day.websitePreference,
      targetCount: day.targetCount,
    };
    const discovery = await discoverInstagramUsernames(target, deps.discoveryDeps);
    stats.found = discovery.usernames.length;

    // ── 2–4. Dedup → research → message → CRM import (per-item isolation) ──
    const seenInRun = new Set<string>();
    let index = 0;
    for (const username of discovery.usernames) {
      index++;
      if (seenInRun.has(username)) {
        stats.duplicatesSkipped++;
        continue;
      }
      seenInRun.add(username);

      try {
        const existing = await findExistingInstagramProspect(organizationId, username);
        if (existing) {
          stats.duplicatesSkipped++;
          continue;
        }

        const { research, decision, generated } = await researchAndDraft(
          username,
          deps.researchDeps,
          index % 5,
        );
        stats.researched++;

        // Website preference filter from the day config (applied after
        // research, since website presence is only known then). Filtered
        // profiles are simply skipped — not counted as new or duplicates.
        const hasWebsite = !!research.website;
        if (day.websitePreference === "NO_WEBSITE" && hasWebsite) continue;
        if (day.websitePreference === "HAS_WEBSITE" && !hasWebsite) continue;

        stats.newCount++;

        // Deterministic score via the existing discovery scorer (verified
        // fields only). The scorer's "Google authoritative" wording is
        // corrected — our no-website signal comes from research.
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

        const profileUrl = instagramProfileUrl(username);
        const { lead, duplicate } = await createLead(
          organizationId,
          actorId,
          {
            fullName: research.businessName?.trim() || undefined,
            companyName: research.businessName?.trim() || undefined,
            industry: research.category?.trim() || day.industry,
            location: research.location?.trim() || day.location || undefined,
            country: day.country || undefined,
            city: day.location || undefined,
            website: research.website?.trim() || undefined,
            instagramUrl: profileUrl,
            instagramUsername: username,
            // Connection status is never guessed — UNKNOWN until verified.
            instagramConnectionStatus: "UNKNOWN",
            aiMessage: generated.text,
            aiMessageSource: generated.source,
            websiteStatus: hasWebsite ? "HAS_WEBSITE" : "UNKNOWN",
            opportunityType: opportunity.type as never,
            opportunityReason: `${opportunity.reason} Pitch angle: ${decision.angle}.`,
            contactable: true,
            leadScore: scored.score,
            scoreReason: scored.scoreReason.replace(
              "No website (Google authoritative)",
              "No website found in research",
            ),
            sourceType: "INSTAGRAM",
            sourceDetail: `Instagram prospecting ${runDate}: @${username} — ${day.industry}`,
            sourceUrl: profileUrl,
            discoveredAt: new Date().toISOString(),
          },
          { sourceType: "INSTAGRAM", dataLabel: "AI_INFERENCE" },
        );

        if (duplicate) {
          // Same business already in CRM (matched by website domain) —
          // enrich missing Instagram fields instead of double-counting.
          stats.duplicatesSkipped++;
          stats.newCount--;
          const updates: Record<string, unknown> = {};
          if (!lead.instagramUsername) updates.instagramUsername = username;
          if (!lead.instagramUrl) updates.instagramUrl = profileUrl;
          if (!lead.aiMessage) {
            updates.aiMessage = generated.text;
            updates.aiMessageSource = generated.source;
          }
          if (Object.keys(updates).length > 0) {
            await db.lead.update({ where: { id: lead.id }, data: updates });
          }
        } else {
          stats.crmImported++;
        }

        await db.leadActivity.create({
          data: {
            organizationId,
            leadId: lead.id,
            type: "instagram_prospected",
            title: `Instagram prospecting: @${username} discovered (${runDate})`,
            detail: `Pitch angle: ${decision.angle}. Message: ${generated.source}.`,
            actorId,
          },
        });

        stats.messagesGenerated++;
      } catch {
        stats.failed++;
      }
    }

    await recordDiscoveryUsage(organizationId, {
      searches: discovery.searchesMade,
      records: stats.newCount,
      imports: stats.crmImported,
    });

    await db.instagramProspectingRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", finishedAt: new Date(), ...stats },
    });
    await audit({
      organizationId,
      actorId,
      action: "prospecting.instagram.run_completed",
      resource: "instagram_prospecting_run",
      resourceId: run.id,
      metadata: { runDate, triggeredBy, ...stats },
    });

    return {
      runId: run.id,
      runDate,
      dayOfWeek,
      industry: day.industry,
      targetCount: day.targetCount,
      status: "COMPLETED",
      triggeredBy,
      ...stats,
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
    });
  }
}
