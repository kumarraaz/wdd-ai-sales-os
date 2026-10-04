/**
 * Automation scheduler (Phase 3).
 *
 * Minimal safe foundation over the existing Automation / AutomationTrigger /
 * AutomationCondition / AutomationAction models (no schema changes):
 *
 *   ACTIVE automation → trigger evaluated → conditions evaluated
 *       → action mapped to a known job type → enqueueJob()
 *
 * Phase 3 scope:
 * - Triggers: only "schedule" ({ intervalMinutes }) is evaluated on tick.
 *   "manual" fires only via explicit invocation (not implemented here);
 *   event triggers (new-lead, lead-qualified, reply-received,
 *   score-changed) need event wiring from a later phase and are skipped.
 * - Conditions: evaluated against a small trigger context with operators
 *   eq/neq/gt/lt/gte/lte/contains. Unknown operators fail closed.
 * - Actions: mapped to Phase 3 job types via ACTION_TO_JOB. Sending
 *   actions (send-email/whatsapp/telegram) are explicitly rejected —
 *   sending is not implemented. Actions without a mapping are skipped
 *   safely with an audit record. No arbitrary code is ever executed from
 *   database values.
 */
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { enqueueJob } from "./runner";
import type { JobTypeName } from "./types";

/** Automation action type → Phase 3 job type. Unlisted actions are skipped. */
const ACTION_TO_JOB: Record<string, JobTypeName> = {
  "research-lead": "research.lead",
  "score-lead": "lead.scoring",
  "generate-message": "message.generate",
  "create-followup": "followup.create",
  "run-instagram-prospecting": "prospecting.instagram.daily",
};

/** Known action types that Phase 3 deliberately refuses (no sending yet). */
const SEND_ACTIONS = new Set(["send-email", "send-whatsapp", "send-telegram"]);

/**
 * Schedule trigger config — two additive variants (existing interval-based
 * configs keep working unchanged):
 * - { intervalMinutes } — fire every N minutes from the last fire.
 * - { atTime: "HH:MM", timezone, daysOfWeek? } — fire once per day when the
 *   wall-clock time in the given timezone has passed. Used by the daily
 *   9:00 AM Instagram prospecting run.
 */
const scheduleTriggerConfig = z.union([
  z.object({ intervalMinutes: z.number().int().min(1).max(525_600) }).strict(),
  z
    .object({
      atTime: z.string().regex(/^\d{2}:\d{2}$/),
      timezone: z.string().min(1).max(60),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    })
    .strict(),
]);

/** Current wall-clock time parts in a target timezone (no date-fns needed). */
function tzParts(now: Date, timezone: string): { ymd: string; hm: string; dow: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
    const ymd = `${parts.year}-${parts.month}-${parts.day}`;
    const hm = `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
    const dowMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return { ymd, hm, dow: dowMap[parts.weekday] ?? -1 };
  } catch {
    return null; // invalid timezone — fail closed
  }
}

/** YYYY-MM-DD of the last fire, expressed in the target timezone. */
function lastFireYmd(last: Date, timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(last);
  } catch {
    return null;
  }
}

type ConditionContext = Record<string, unknown>;

function getPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

/** All conditions are ANDed. Unknown operators fail closed (false). */
export function evaluateCondition(
  field: string,
  operator: string,
  value: string,
  context: ConditionContext,
): boolean {
  const actual = getPath(context, field);
  switch (operator) {
    case "eq":
      return String(actual ?? "") === value;
    case "neq":
      return String(actual ?? "") !== value;
    case "gt":
      return Number(actual) > Number(value);
    case "lt":
      return Number(actual) < Number(value);
    case "gte":
      return Number(actual) >= Number(value);
    case "lte":
      return Number(actual) <= Number(value);
    case "contains":
      return String(actual ?? "").includes(value);
    default:
      return false;
  }
}

export interface SchedulerStats {
  evaluated: number;
  fired: number;
  enqueued: number;
  skipped: number;
}

export interface AtTimeTriggerConfig {
  atTime: string;
  timezone: string;
  daysOfWeek?: number[];
}

/**
 * Pure wall-clock check: has today's atTime passed in the timezone, and did
 * the last fire happen before today's atTime? Exported for unit testing.
 */
export function isAtTimeTriggerDue(
  cfg: AtTimeTriggerConfig,
  lastFireAt: Date | null,
  now: Date,
): boolean {
  const parts = tzParts(now, cfg.timezone);
  if (!parts) return false;
  if (cfg.daysOfWeek && !cfg.daysOfWeek.includes(parts.dow)) return false;
  if (parts.hm < cfg.atTime) return false; // today's run time not reached yet
  if (!lastFireAt) return true;
  const lastYmd = lastFireYmd(lastFireAt, cfg.timezone);
  return lastYmd !== null && lastYmd < parts.ymd; // not yet fired today
}

async function shouldScheduleTriggerFire(
  automationId: string,
  config: unknown,
): Promise<boolean> {
  const parsed = scheduleTriggerConfig.safeParse(config ?? {});
  if (!parsed.success) return false;
  // Last fire = most recent job enqueued for this automation (any type).
  const last = await db.job.findFirst({
    where: { payload: { path: ["automationId"], equals: automationId } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const cfg = parsed.data;
  if ("intervalMinutes" in cfg) {
    if (!last) return true;
    return Date.now() - last.createdAt.getTime() >= cfg.intervalMinutes * 60_000;
  }

  // Wall-clock variant: fire once per day after atTime in the timezone.
  return isAtTimeTriggerDue(cfg, last?.createdAt ?? null, new Date());
}

export async function evaluateAutomations(
  organizationId: string,
): Promise<SchedulerStats> {
  const stats: SchedulerStats = { evaluated: 0, fired: 0, enqueued: 0, skipped: 0 };
  const automations = await db.automation.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      triggers: true,
      conditions: { orderBy: { order: "asc" } },
      actions: { orderBy: { order: "asc" } },
    },
  });

  for (const automation of automations) {
    for (const trigger of automation.triggers) {
      // Only schedule triggers are tick-evaluated in Phase 3.
      if (trigger.type !== "schedule") continue;
      const due = await shouldScheduleTriggerFire(automation.id, trigger.config);
      if (!due) continue;

      stats.evaluated++;
      const context: ConditionContext = {
        automationId: automation.id,
        organizationId,
        trigger: trigger.type,
        firedAt: new Date().toISOString(),
      };
      const conditionsPass = automation.conditions.every((c) =>
        evaluateCondition(c.field, c.operator, c.value, context),
      );
      if (!conditionsPass) {
        stats.skipped++;
        continue;
      }
      stats.fired++;

      for (const action of automation.actions) {
        const jobType = ACTION_TO_JOB[action.type];
        if (!jobType) {
          await audit({
            organizationId,
            action: "automation.action_skipped",
            resource: "Automation",
            resourceId: automation.id,
            result: "DENIED",
            metadata: {
              actionType: action.type,
              reason: SEND_ACTIONS.has(action.type)
                ? "sending is not implemented in Phase 3"
                : "no Phase 3 job mapping for this action type",
            },
          });
          stats.skipped++;
          continue;
        }
        try {
          await enqueueJob({
            organizationId,
            type: jobType,
            payload: {
              ...((action.config as Record<string, unknown> | null) ?? {}),
              automationId: automation.id,
              automationActionId: action.id,
              requiresApproval: action.requiresApproval,
            },
            actorId: automation.createdById,
          });
          stats.enqueued++;
        } catch (err) {
          await audit({
            organizationId,
            action: "automation.action_failed",
            resource: "Automation",
            resourceId: automation.id,
            result: "FAILED",
            metadata: {
              actionType: action.type,
              error: err instanceof Error ? err.message : "unknown error",
            },
          });
          stats.skipped++;
        }
      }
    }
  }
  return stats;
}
