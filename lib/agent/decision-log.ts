/**
 * AI Sales Mind — decision log (Phase 4).
 *
 * Uses the existing audit infrastructure (lib/audit.ts). Metadata only:
 * never logs secrets, credentials, full payloads, or stack traces.
 */
import { audit } from "../audit";
import type { WorkspaceContext } from "../tenant";

export type AgentEvent =
  | "goal.started"
  | "plan.created"
  | "plan.failed"
  | "tool.proposed"
  | "tool.executed"
  | "tool.failed"
  | "tool.deferred"
  | "approval.required"
  | "completed"
  | "stopped"
  | "budget_exceeded"
  | "cancelled"
  | "kill_switch_blocked";

const EVENT_RESULT: Record<AgentEvent, "SUCCESS" | "DENIED" | "FAILED"> = {
  "goal.started": "SUCCESS",
  "plan.created": "SUCCESS",
  "plan.failed": "FAILED",
  "tool.proposed": "SUCCESS",
  "tool.executed": "SUCCESS",
  "tool.failed": "FAILED",
  "tool.deferred": "SUCCESS",
  "approval.required": "DENIED",
  "completed": "SUCCESS",
  "stopped": "DENIED",
  "budget_exceeded": "DENIED",
  "cancelled": "DENIED",
  "kill_switch_blocked": "DENIED",
};

const SECRET_KEY_PATTERN =
  /api[_-]?key|secret|token|password|passwd|credential|authorization|cookie|session/i;

/** Defensive scrub: metadata must never carry secret-shaped values. */
function scrubMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubMetadata);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? "[REDACTED]" : scrubMetadata(v);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) {
    return value.slice(0, 2000) + "…[truncated]";
  }
  return value;
}

export async function logAgentEvent(args: {
  ctx: WorkspaceContext;
  runId: string;
  event: AgentEvent;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await audit({
    organizationId: args.ctx.organization.id,
    actorId: args.ctx.user.id,
    action: `agent.${args.event}`,
    resource: "AgentGoal",
    resourceId: args.runId,
    result: EVENT_RESULT[args.event],
    metadata: {
      runId: args.runId,
      ...(scrubMetadata(args.metadata ?? {}) as Record<string, unknown>),
    },
  });
}
