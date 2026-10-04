/**
 * Instagram prospecting — 7-day weekly plan service.
 *
 * A plan holds one prospecting target per weekday (0=Sunday…6=Saturday).
 * The daily 9:00 AM run is driven by the EXISTING automation scheduler:
 * this module keeps a single Automation row in sync with the plan
 * (schedule trigger with wall-clock atTime + timezone, action
 * "run-instagram-prospecting" → job "prospecting.instagram.daily").
 *
 * Tenant isolation: every read/write is scoped to organizationId.
 * Nothing here touches Instagram — discovery uses compliant public web
 * search only (see lib/prospecting/instagram-discovery.ts).
 */
import { db } from "../db";
import { audit } from "../audit";
import type { ProspectingPlanInput } from "../validators";

export const DEFAULT_RUN_TIME = "09:00";
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface PlanDayInput {
  dayOfWeek: number;
  industry: string;
  location?: string;
  country?: string;
  businessType?: string;
  targetAudience?: string;
  websitePreference?: "ANY" | "NO_WEBSITE" | "HAS_WEBSITE";
  followerThreshold?: number;
  targetCount?: number;
  isActive?: boolean;
}

export function dayOfWeekInTimezone(now: Date, timezone: string): number {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).format(now);
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return map[weekday] ?? now.getDay();
  } catch {
    return now.getDay();
  }
}

/** YYYY-MM-DD in the plan timezone — the run's identity. */
export function runDateInTimezone(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export async function getPlan(organizationId: string) {
  return db.instagramProspectingPlan.findFirst({
    where: { organizationId },
    include: { days: { orderBy: { dayOfWeek: "asc" } } },
  });
}

/** Resolve today's active day config in the plan's timezone (null when none). */
export async function getTodayDay(organizationId: string, now = new Date()) {
  const plan = await getPlan(organizationId);
  if (!plan || !plan.isActive) return null;
  const dow = dayOfWeekInTimezone(now, plan.timezone);
  const day = plan.days.find((d) => d.dayOfWeek === dow && d.isActive);
  if (!day) return null;
  return { plan, day, runDate: runDateInTimezone(now, plan.timezone), dayOfWeek: dow };
}

/**
 * Create or update the weekly plan (days are replaced wholesale).
 * SALES_MANAGER+ only (enforced at the route layer).
 */
export async function upsertPlan(
  organizationId: string,
  actorId: string,
  input: ProspectingPlanInput,
) {
  const existing = await getPlan(organizationId);

  const plan = existing
    ? await db.instagramProspectingPlan.update({
        where: { id: existing.id },
        data: {
          name: input.name ?? existing.name,
          isActive: input.isActive ?? existing.isActive,
          timezone: input.timezone ?? existing.timezone,
          runAtTime: input.runAtTime ?? existing.runAtTime,
        },
      })
    : await db.instagramProspectingPlan.create({
        data: {
          organizationId,
          name: input.name ?? "Weekly Instagram Prospecting",
          isActive: input.isActive ?? true,
          timezone: input.timezone ?? DEFAULT_TIMEZONE,
          runAtTime: input.runAtTime ?? DEFAULT_RUN_TIME,
          createdById: actorId,
        },
      });

  if (input.days) {
    await db.instagramProspectingDay.deleteMany({ where: { planId: plan.id } });
    if (input.days.length > 0) {
      await db.instagramProspectingDay.createMany({
        data: input.days.map((d) => ({
          planId: plan.id,
          dayOfWeek: d.dayOfWeek,
          industry: d.industry.trim(),
          location: d.location?.trim() || null,
          country: d.country?.trim() || null,
          businessType: d.businessType?.trim() || null,
          targetAudience: d.targetAudience?.trim() || null,
          websitePreference: d.websitePreference ?? "ANY",
          followerThreshold: d.followerThreshold ?? null,
          targetCount: d.targetCount ?? 75,
          isActive: d.isActive ?? true,
        })),
      });
    }
  }

  await syncPlanAutomation(organizationId, actorId, plan.id);

  await audit({
    organizationId,
    actorId,
    action: "prospecting.instagram.plan_updated",
    resource: "instagram_prospecting_plan",
    resourceId: plan.id,
    metadata: {
      isActive: plan.isActive,
      runAtTime: plan.runAtTime,
      timezone: plan.timezone,
      days: input.days?.length ?? "unchanged",
    },
  });

  return getPlan(organizationId);
}

const AUTOMATION_NAME = "Instagram daily prospecting";

/**
 * Keep exactly one Automation row driving the daily run. Uses the existing
 * scheduler's wall-clock trigger ({ atTime, timezone }) — no new scheduler.
 */
export async function syncPlanAutomation(
  organizationId: string,
  actorId: string,
  planId: string,
) {
  const plan = await db.instagramProspectingPlan.findFirst({
    where: { id: planId, organizationId },
  });
  if (!plan) return;

  const existing = await db.automation.findFirst({
    where: { organizationId, name: AUTOMATION_NAME },
    include: { triggers: true, actions: true },
  });

  if (!plan.isActive) {
    if (existing && existing.status !== "PAUSED") {
      await db.automation.update({
        where: { id: existing.id },
        data: { status: "PAUSED" },
      });
      await audit({
        organizationId,
        actorId,
        action: "prospecting.instagram.automation_paused",
        resource: "automation",
        resourceId: existing.id,
      });
    }
    return;
  }

  const triggerConfig = { atTime: plan.runAtTime, timezone: plan.timezone };
  if (!existing) {
    const created = await db.automation.create({
      data: {
        organizationId,
        name: AUTOMATION_NAME,
        description:
          "Daily 9:00 AM Instagram prospecting run for the active weekly plan. Drafts only — nothing is sent.",
        status: "ACTIVE",
        createdById: actorId,
        triggers: { create: [{ type: "schedule", config: triggerConfig }] },
        actions: {
          create: [
            {
              type: "run-instagram-prospecting",
              order: 0,
              config: { planId: plan.id },
              requiresApproval: false,
            },
          ],
        },
      },
    });
    await audit({
      organizationId,
      actorId,
      action: "prospecting.instagram.automation_created",
      resource: "automation",
      resourceId: created.id,
      metadata: triggerConfig,
    });
    return;
  }

  // Keep the existing row in sync with the plan (time/timezone/plan id).
  const trigger = existing.triggers.find((t) => t.type === "schedule");
  const action = existing.actions.find((a) => a.type === "run-instagram-prospecting");
  const updates: Promise<unknown>[] = [];
  if (existing.status !== "ACTIVE") {
    updates.push(db.automation.update({ where: { id: existing.id }, data: { status: "ACTIVE" } }));
  }
  if (trigger) {
    updates.push(
      db.automationTrigger.update({ where: { id: trigger.id }, data: { config: triggerConfig } }),
    );
  } else {
    updates.push(
      db.automationTrigger.create({
        data: { automationId: existing.id, type: "schedule", config: triggerConfig },
      }),
    );
  }
  if (action) {
    updates.push(
      db.automationAction.update({
        where: { id: action.id },
        data: { config: { planId: plan.id } },
      }),
    );
  } else {
    updates.push(
      db.automationAction.create({
        data: {
          automationId: existing.id,
          type: "run-instagram-prospecting",
          order: existing.actions.length,
          config: { planId: plan.id },
          requiresApproval: false,
        },
      }),
    );
  }
  await Promise.all(updates);
}

export async function listRuns(organizationId: string, take = 30) {
  return db.instagramProspectingRun.findMany({
    where: { organizationId },
    orderBy: { startedAt: "desc" },
    take,
  });
}
