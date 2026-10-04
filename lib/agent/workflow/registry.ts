/**
 * Phase 6 — built-in sales workflow registry.
 *
 * Declarative workflow definitions only. Stage definitions declare which
 * Phase-2 registry tools they may call; the executor enforces that allowlist.
 * No executable code, SQL, shell, or network access lives here.
 */

import type {
  StageDefinition,
  WorkflowBudget,
  WorkflowDefinition,
  WorkflowId,
} from "./types";
import { WORKFLOW_BUDGET_DEFAULTS } from "./types";

function stage(
  id: string,
  type: StageDefinition["type"],
  description: string,
  tools: string[],
  opts?: Partial<Pick<StageDefinition, "approvalRequired" | "maxToolCalls" | "continueOnError" | "timeoutMs">>,
): StageDefinition {
  return {
    id,
    type,
    description,
    tools,
    approvalRequired: opts?.approvalRequired ?? false,
    maxToolCalls: opts?.maxToolCalls ?? 40,
    continueOnError: opts?.continueOnError ?? false,
    timeoutMs: opts?.timeoutMs ?? 120_000,
  };
}

const DISCOVER = (id = "discover-prospects") =>
  stage(
    id,
    "DISCOVER",
    "Find prospect businesses via the compliant discovery provider (discovery.search).",
    ["discovery.search"],
    { maxToolCalls: 5, timeoutMs: 90_000 },
  );

const RESEARCH = (id = "research-prospects") =>
  stage(
    id,
    "RESEARCH",
    "Inspect each prospect website with the SSRF-safe research tool (research.website). Failure-isolated per prospect.",
    ["research.website"],
    { maxToolCalls: 60, continueOnError: true, timeoutMs: 180_000 },
  );

const QUALIFY = (id = "qualify-prospects") =>
  stage(
    id,
    "QUALIFY",
    "Apply deterministic qualification rules to researched prospects. No AI, no tools.",
    [],
    { continueOnError: true },
  );

const SCORE = (id = "score-prospects") =>
  stage(
    id,
    "SCORE",
    "Compute the deterministic lead score (existing scoring infrastructure) per prospect. No AI, no tools.",
    [],
    { continueOnError: true },
  );

const CREATE_LEAD = (id = "create-crm-leads") =>
  stage(
    id,
    "CREATE_LEAD",
    "Create CRM leads for qualified prospects via crm.createLead (built-in duplicate detection). Failure-isolated per prospect.",
    ["crm.createLead"],
    { maxToolCalls: 60, continueOnError: true, timeoutMs: 120_000 },
  );

const OUTREACH_DRAFT = (id = "draft-outreach") =>
  stage(
    id,
    "OUTREACH_DRAFT",
    "Prepare an outreach DRAFT proposal. The executor pauses with WAITING_FOR_APPROVAL — the draft is never created or sent without human approval.",
    ["outreach.createDraft"],
    { approvalRequired: true, maxToolCalls: 1 },
  );

const FOLLOW_UP = (id = "schedule-followup") =>
  stage(
    id,
    "FOLLOW_UP",
    "Schedule a CRM follow-up for the lead via crm.createFollowUp. Schedules only — never sends.",
    ["crm.createFollowUp"],
    { maxToolCalls: 5, continueOnError: true },
  );

const LOAD_CONTEXT = (id = "load-lead-context") =>
  stage(
    id,
    "LOAD_CONTEXT",
    "Load the existing CRM lead plus its LEAD-scope agent memory for context.",
    ["research.lead"],
    { maxToolCalls: 2 },
  );

const COMPLETE = (id = "complete") =>
  stage(
    id,
    "COMPLETE",
    "Build the deterministic final result: counts, provenance, and status.",
    [],
    {},
  );

const DEFAULT_BUDGET: WorkflowBudget = { ...WORKFLOW_BUDGET_DEFAULTS };

const DEFINITIONS: Record<WorkflowId, WorkflowDefinition> = {
  "lead-discovery-qualification": {
    id: "lead-discovery-qualification",
    name: "Lead Discovery & Qualification",
    description:
      "Find relevant prospects, research them, qualify them deterministically, score them, and create CRM leads for the qualified ones.",
    goal: "Build a qualified, scored prospect list in the CRM ready for sales action.",
    // Note: CREATE_LEAD is included (beyond the minimal 5-stage sketch) so the
    // workflow can materialize "prepare qualified prospects for sales action"
    // using only the existing crm.createLead tool.
    stages: [DISCOVER(), RESEARCH(), QUALIFY(), SCORE(), CREATE_LEAD(), COMPLETE()],
    defaultBudget: DEFAULT_BUDGET,
    approvalPolicy: "none",
  },
  "website-improvement-prospecting": {
    id: "website-improvement-prospecting",
    name: "Website Improvement Prospecting",
    description:
      "Find businesses whose websites have identifiable improvement opportunities, qualify and score them, and prepare an outreach draft for approval.",
    goal: "Surface weak-website prospects and prepare an approved outreach draft — never send automatically.",
    stages: [DISCOVER(), RESEARCH(), QUALIFY(), SCORE(), OUTREACH_DRAFT(), COMPLETE()],
    defaultBudget: DEFAULT_BUDGET,
    approvalPolicy: "outreach-only",
  },
  "reengage-existing-lead": {
    id: "reengage-existing-lead",
    name: "Re-engage Existing Lead",
    description:
      "Use existing CRM and agent-memory context to prepare a follow-up action for an existing lead.",
    goal: "Prepare a context-aware follow-up (draft + scheduled follow-up) for one existing lead.",
    stages: [LOAD_CONTEXT(), QUALIFY(), OUTREACH_DRAFT(), FOLLOW_UP(), COMPLETE()],
    defaultBudget: { ...DEFAULT_BUDGET, maxLeads: 1 },
    approvalPolicy: "outreach-only",
  },
};

/** Look up a registered workflow. Unknown ids return null — callers fail safely. */
export function getWorkflowDefinition(id: string): WorkflowDefinition | null {
  return (DEFINITIONS as Record<string, WorkflowDefinition>)[id] ?? null;
}

export function listWorkflowDefinitions(): WorkflowDefinition[] {
  return Object.values(DEFINITIONS);
}

/** All tool names any registered workflow stage may reference. */
export function getWorkflowToolAllowlist(): string[] {
  const names = new Set<string>();
  for (const def of listWorkflowDefinitions()) {
    for (const s of def.stages) {
      for (const t of s.tools) names.add(t);
    }
  }
  return [...names];
}
