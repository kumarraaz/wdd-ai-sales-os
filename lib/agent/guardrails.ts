/**
 * AI Sales Mind — budgets and guardrails (Phase 4).
 *
 * Every runAgentGoal invocation is bounded. Requested budgets are clamped
 * to hard ceilings so a caller can never request unlimited execution.
 */
import type { AgentBudget } from "./types";

/** Sensible defaults per the architecture spec. */
export const DEFAULT_BUDGETS: AgentBudget = {
  maxSteps: 20,
  maxToolCalls: 20,
  maxPlanSteps: 20,
  maxRuntimeMs: 120_000,
};

/**
 * Hard ceilings. Requested values above these are clamped down; the
 * agent can never be configured for unbounded execution.
 */
export const HARD_CEILINGS: AgentBudget = {
  maxSteps: 50,
  maxToolCalls: 50,
  maxPlanSteps: 50,
  maxRuntimeMs: 300_000,
};

export class BudgetError extends Error {
  readonly code = "BUDGET_INVALID";
  constructor(message: string) {
    super(message);
  }
}

function clampBudgetValue(
  name: keyof AgentBudget,
  value: unknown,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BudgetError(`Budget "${name}" must be a finite number.`);
  }
  const int = Math.floor(value);
  if (int < 1) {
    throw new BudgetError(`Budget "${name}" must be at least 1.`);
  }
  return Math.min(int, HARD_CEILINGS[name]);
}

/**
 * Normalize a caller-supplied budget: fill defaults, floor to integers,
 * and clamp every field to its hard ceiling. Throws BudgetError on
 * non-numeric or non-positive values.
 */
export function normalizeBudget(
  requested?: Partial<AgentBudget> | null,
): AgentBudget {
  const r = requested ?? {};
  return {
    maxSteps: clampBudgetValue("maxSteps", r.maxSteps, DEFAULT_BUDGETS.maxSteps),
    maxToolCalls: clampBudgetValue(
      "maxToolCalls",
      r.maxToolCalls,
      DEFAULT_BUDGETS.maxToolCalls,
    ),
    maxPlanSteps: clampBudgetValue(
      "maxPlanSteps",
      r.maxPlanSteps,
      DEFAULT_BUDGETS.maxPlanSteps,
    ),
    maxRuntimeMs: clampBudgetValue(
      "maxRuntimeMs",
      r.maxRuntimeMs,
      DEFAULT_BUDGETS.maxRuntimeMs,
    ),
  };
}
