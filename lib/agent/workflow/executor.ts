/**
 * Phase 6 — workflow executor.
 *
 * Executes a declarative workflow one stage at a time through the EXISTING
 * safe infrastructure:
 *   - Phase-2 tool registry (executeTool) — stages may only call the tools
 *     declared in their definition; approval-required tools are never invoked.
 *   - Phase-3 job engine — bulk/long-running discovery is delegated via
 *     enqueueJob, never re-implemented.
 *   - Phase-4 guardrail principles — budgets are clamped, kill switch and
 *     cancellation are checked before planning, between stages, and the
 *     executor never trusts model output blindly.
 *   - Phase-5 memory — org/lead memory recalled before execution context is
 *     built; a bounded RUN summary persisted after meaningful completion.
 *
 * Outreach safety: the only outreach action this layer can propose is a DRAFT,
 * and it pauses with WAITING_FOR_APPROVAL before anything is created.
 * Nothing here sends real messages.
 */

import { randomUUID } from "crypto";
import type { WorkspaceContext } from "../../tenant";
import { executeTool } from "../tools/registry";
import { getWorkflowDefinition } from "./registry";
import { recall, remember } from "../memory";
import { isKillSwitchOn } from "../../automation/types";
import { enqueueJob } from "../../automation/runner";
import { audit } from "../../audit";
import { calculateScore } from "../../intelligence/scoring";
import { db } from "../../db";
import { getLead } from "../../leads";
import type { DiscoveredCompany } from "../../discovery/types";
import {
  WORKFLOW_REQUEST_SCHEMA,
  clampBudget,
  resolveDesiredLeads,
  type ApprovalProposal,
  type StageDefinition,
  type StageOutcome,
  type WorkflowBudget,
  type WorkflowCounts,
  type WorkflowProspect,
  type WorkflowRequest,
  type WorkflowResult,
  type WorkflowStatus,
} from "./types";

export class WorkflowExecutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkflowExecutionError";
    this.code = code;
  }
}

export interface RunWorkflowOptions {
  ctx: WorkspaceContext;
  request: WorkflowRequest;
  budget?: Partial<WorkflowBudget>;
  signal?: AbortSignal;
}

// ─── audit helper (metadata only — never secrets, prompts, or reasoning) ─────

async function logWorkflowEvent(
  ctx: WorkspaceContext,
  event: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: event,
      resource: "workflow",
      metadata: { ...metadata, workflowLayer: "phase6" },
    });
  } catch {
    // Audit failure must never break execution.
  }
}

// ─── deterministic qualification ─────────────────────────────────────────────

interface WebsiteSignals {
  hasWebsite: boolean;
  weaknesses: string[];
}

function extractWebsiteSignals(research: Record<string, unknown> | null): WebsiteSignals {
  if (!research || typeof research !== "object") {
    return { hasWebsite: false, weaknesses: [] };
  }
  const get = (k: string): unknown => (research as Record<string, unknown>)[k];
  const weaknesses: string[] = [];
  if (get("https") === false) weaknesses.push("no-https");
  if (!get("title")) weaknesses.push("missing-title");
  if (!get("metaDescription")) weaknesses.push("missing-meta-description");
  if (!get("viewportMeta")) weaknesses.push("not-mobile-friendly");
  const favicon = get("favicon") as { available?: boolean } | null;
  if (favicon && favicon.available === false) weaknesses.push("missing-favicon");
  const sitemap = get("sitemap") as { available?: boolean } | null;
  if (sitemap && sitemap.available === false) weaknesses.push("missing-sitemap");
  const robotsTxt = get("robotsTxt") as { available?: boolean } | null;
  if (robotsTxt && robotsTxt.available === false) weaknesses.push("missing-robots-txt");
  const openGraph = get("openGraph") as { title?: string | null; image?: string | null } | null;
  if (openGraph && !openGraph.title && !openGraph.image) weaknesses.push("missing-open-graph");
  const responseTimeMs = get("responseTimeMs");
  if (typeof responseTimeMs === "number" && responseTimeMs > 3000) weaknesses.push("slow-response");
  const imagesMissingAlt = get("imagesMissingAlt");
  if (typeof imagesMissingAlt === "number" && imagesMissingAlt > 5) weaknesses.push("images-missing-alt");
  return { hasWebsite: true, weaknesses };
}

function qualifyProspect(
  prospect: WorkflowProspect,
  websiteRequirement: "weak" | "any" | "none" | undefined,
): { qualified: boolean; reasons: string[] } {
  const req = websiteRequirement ?? "any";
  const signals = extractWebsiteSignals(prospect.research);
  if (req === "none") {
    if (!prospect.website) {
      return { qualified: true, reasons: ["no-website-found"] };
    }
    return { qualified: false, reasons: ["has-website"] };
  }
  if (req === "weak") {
    if (!prospect.website) {
      return { qualified: false, reasons: ["no-website-to-assess"] };
    }
    if (!prospect.research) {
      return { qualified: false, reasons: ["website-unreachable"] };
    }
    if (signals.weaknesses.length >= 2) {
      return { qualified: true, reasons: signals.weaknesses.slice(0, 6) };
    }
    return { qualified: false, reasons: ["website-appears-healthy"] };
  }
  // "any": discovery returned the prospect; research failure does not disqualify.
  return { qualified: true, reasons: prospect.research ? ["researched"] : ["discovered"] };
}

// ─── deterministic draft template (proposal only — never sent) ──────────────

function buildDraftBody(prospect: WorkflowProspect, weaknesses: string[]): string {
  const site = prospect.website ?? "your website";
  const weakNote =
    weaknesses.length > 0
      ? `I noticed a few quick wins on ${site} (${weaknesses.slice(0, 3).join(", ").replaceAll("-", " ")}).`
      : `I took a quick look at ${site}.`;
  return (
    `Hi ${prospect.name} team,\n\n` +
    `${weakNote} I'm Raj, a freelance web developer. A polished, fast website helps turn visitors into genuine enquiries.\n\n` +
    `Would you be open to a brief chat about improving your online presence?\n\n` +
    `— DRAFT for human review, not sent —`
  );
}

// ─── executor ────────────────────────────────────────────────────────────────

interface ExecutionState {
  ctx: WorkspaceContext;
  request: WorkflowRequest;
  budget: WorkflowBudget;
  budgetClampedNotes: string[];
  workflowRunId: string;
  startedAt: number;
  toolCalls: number;
  prospects: WorkflowProspect[];
  stages: StageOutcome[];
  deferredJobId?: string;
  approval?: ApprovalProposal;
  leadContext: Record<string, unknown> | null;
  signal?: AbortSignal;
}

function emptyCounts(): WorkflowCounts {
  return { requested: 0, processed: 0, successful: 0, failed: 0, skipped: 0, deferred: 0 };
}

export async function runWorkflow(options: RunWorkflowOptions): Promise<WorkflowResult> {
  const { ctx, signal } = options;

  // 1. Validate the request (defense in depth — the planner already validated).
  const parsed = WORKFLOW_REQUEST_SCHEMA.safeParse(options.request);
  if (!parsed.success) {
    throw new WorkflowExecutionError("INVALID_WORKFLOW_REQUEST", "Workflow request failed validation.");
  }
  const request = parsed.data;
  const definition = getWorkflowDefinition(request.workflowId);
  if (!definition) {
    throw new WorkflowExecutionError("UNKNOWN_WORKFLOW", `Unknown workflow "${request.workflowId}".`);
  }

  // 2. Normalize + clamp budgets. Never trust a provided budget blindly.
  const { budget, clamped } = clampBudget({ ...definition.defaultBudget, ...options.budget });
  const desired = resolveDesiredLeads(request.params.desiredLeads);
  if (desired.clamped) {
    clamped.push(`desiredLeads clamped from ${desired.requested} to ${desired.target}`);
  }
  if (desired.target > budget.maxLeads) {
    clamped.push(`desiredLeads ${desired.target} exceeds maxLeads ${budget.maxLeads}; capped`);
  }
  const target = Math.min(desired.target, budget.maxLeads);

  const workflowRunId = randomUUID();
  const startedAt = Date.now();
  const state: ExecutionState = {
    ctx,
    request,
    budget,
    budgetClampedNotes: clamped,
    workflowRunId,
    startedAt,
    toolCalls: 0,
    prospects: [],
    stages: [],
    leadContext: null,
    signal,
  };

  const finish = (
    status: WorkflowStatus,
    extra?: Partial<WorkflowResult>,
  ): WorkflowResult => {
    const finishedAt = new Date().toISOString();
    return {
      status,
      workflowId: request.workflowId,
      workflowRunId,
      requested: request,
      effectiveBudget: budget,
      budgetClampedNotes: clamped,
      stages: state.stages,
      counts: finalizeCounts(state, target),
      prospects: state.prospects,
      memoryRecalled: 0,
      memoryPersisted: false,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt,
      durationMs: Date.now() - startedAt,
      ...extra,
    };
  };

  // 3. Kill switch — checked before any work.
  if (isKillSwitchOn()) {
    await logWorkflowEvent(ctx, "workflow.stopped", { workflowId: request.workflowId, reason: "kill-switch" });
    return finish("STOPPED", { errorCode: "KILL_SWITCH_ACTIVE", errorMessage: "Automation kill switch is active." });
  }

  await logWorkflowEvent(ctx, "workflow.started", {
    workflowId: request.workflowId,
    runId: workflowRunId,
    target,
    budgetClamped: clamped,
  });

  // Recall org memory for execution context (failure-isolated; informational only).
  let memoryRecalled = 0;
  try {
    const mems = await recall(ctx, "ORG", ctx.organization.id, { limit: 5 });
    memoryRecalled = mems.length;
  } catch {
    // ignore
  }

  // 4. Execute one stage at a time.
  const stages = definition.stages.slice(0, budget.maxStages);
  let halted = false;

  for (const stageDef of stages) {
    if (halted) {
      state.stages.push(skippedOutcome(stageDef, "halted after deferral"));
      continue;
    }
    if (signal?.aborted) {
      await logWorkflowEvent(ctx, "workflow.cancelled", { workflowId: request.workflowId, runId: workflowRunId });
      return finish("CANCELLED", { memoryRecalled, errorCode: "CANCELLED", errorMessage: "Workflow cancelled." });
    }
    if (isKillSwitchOn()) {
      await logWorkflowEvent(ctx, "workflow.stopped", { workflowId: request.workflowId, runId: workflowRunId });
      return finish("STOPPED", { memoryRecalled, errorCode: "KILL_SWITCH_ACTIVE", errorMessage: "Kill switch activated mid-run." });
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed > budget.maxRuntimeMs) {
      await logWorkflowEvent(ctx, "workflow.budget_exceeded", { workflowId: request.workflowId, runId: workflowRunId, reason: "runtime" });
      return finish("BUDGET_EXCEEDED", { memoryRecalled, errorCode: "RUNTIME_BUDGET_EXCEEDED", errorMessage: `Runtime budget of ${budget.maxRuntimeMs}ms exceeded.` });
    }
    if (state.toolCalls >= budget.maxToolCalls) {
      await logWorkflowEvent(ctx, "workflow.budget_exceeded", { workflowId: request.workflowId, runId: workflowRunId, reason: "tool-calls" });
      return finish("BUDGET_EXCEEDED", { memoryRecalled, errorCode: "TOOL_CALL_BUDGET_EXCEEDED", errorMessage: `Tool-call budget of ${budget.maxToolCalls} exceeded.` });
    }

    const outcome = await executeStage(state, stageDef, target);
    state.stages.push(outcome);

    if (outcome.status === "waiting_approval") {
      await logWorkflowEvent(ctx, "workflow.waiting_approval", {
        workflowId: request.workflowId,
        runId: workflowRunId,
        stageId: stageDef.id,
      });
      return finish("WAITING_FOR_APPROVAL", { memoryRecalled, approval: state.approval });
    }
    if (outcome.status === "deferred") {
      // Bulk work delegated to the Phase-3 job engine; remaining stages cannot
      // run without its results. Finalize as PARTIAL — honestly.
      halted = true;
      continue;
    }
    if (outcome.status === "failed" && !stageDef.continueOnError) {
      await logWorkflowEvent(ctx, "workflow.failed", {
        workflowId: request.workflowId,
        runId: workflowRunId,
        stageId: stageDef.id,
        error: outcome.error,
      });
      return finish("FAILED", { memoryRecalled, errorCode: "STAGE_FAILED", errorMessage: outcome.error });
    }
  }

  // 5. Deterministic final status. Prospects filtered out by qualification
  // rules ("skipped") are a normal outcome — PARTIAL is reserved for real
  // failures and background deferrals.
  const counts = finalizeCounts(state, target);
  const status: WorkflowStatus =
    counts.deferred > 0 || counts.failed > 0 ? "PARTIAL" : "COMPLETED";
  await logWorkflowEvent(ctx, status === "COMPLETED" ? "workflow.completed" : "workflow.partial", {
    workflowId: request.workflowId,
    runId: workflowRunId,
    counts,
    deferredJobId: state.deferredJobId,
  });

  // 6. Persist a bounded RUN summary (failure-isolated; never raw state).
  let memoryPersisted = false;
  try {
    await remember(ctx, {
      scope: "RUN",
      scopeId: workflowRunId,
      key: "workflow.summary",
      value: {
        v: 1,
        workflowId: request.workflowId,
        status,
        counts,
        stages: state.stages.map((s) => `${s.stageId}:${s.status}`),
        deferredJobId: state.deferredJobId ?? null,
        budgetClamped: clamped,
        finishedAt: new Date().toISOString(),
      },
    });
    memoryPersisted = true;
  } catch {
    // ignore
  }

  return finish(status, {
    memoryRecalled,
    memoryPersisted,
    deferredJobId: state.deferredJobId,
  });
}

// ─── stage execution ─────────────────────────────────────────────────────────

function skippedOutcome(stageDef: StageDefinition, note: string): StageOutcome {
  return {
    stageId: stageDef.id,
    type: stageDef.type,
    status: "skipped",
    toolCalls: 0,
    itemsProcessed: 0,
    itemsSucceeded: 0,
    itemsFailed: 0,
    durationMs: 0,
    note,
  };
}

async function executeStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  target: number,
): Promise<StageOutcome> {
  const { ctx } = state;
  const stageStart = Date.now();
  const outcome: StageOutcome = {
    stageId: stageDef.id,
    type: stageDef.type,
    status: "completed",
    toolCalls: 0,
    itemsProcessed: 0,
    itemsSucceeded: 0,
    itemsFailed: 0,
    durationMs: 0,
  };
  await logWorkflowEvent(ctx, "workflow.stage.started", {
    workflowId: state.request.workflowId,
    runId: state.workflowRunId,
    stageId: stageDef.id,
    type: stageDef.type,
  });

  const callTool = async <T = unknown>(name: string, input: unknown): Promise<T> => {
    if (!stageDef.tools.includes(name)) {
      throw new WorkflowExecutionError(
        "TOOL_NOT_ALLOWED",
        `Stage "${stageDef.id}" may not call tool "${name}".`,
      );
    }
    if (state.toolCalls >= state.budget.maxToolCalls || outcome.toolCalls >= stageDef.maxToolCalls) {
      throw new WorkflowExecutionError("STAGE_TOOL_BUDGET_EXCEEDED", `Tool budget exceeded in stage "${stageDef.id}".`);
    }
    state.toolCalls += 1;
    outcome.toolCalls += 1;
    // executeTool never throws for tool failures — it returns a
    // { success, data, error } envelope. Unwrap it here so stage logic can
    // rely on try/catch for failure isolation.
    const result = await executeTool<T>(name, ctx, input);
    if (!result.success) {
      throw new WorkflowExecutionError(
        result.error?.code ?? "TOOL_FAILED",
        result.error?.message ?? `Tool "${name}" failed.`,
      );
    }
    return result.data as T;
  };

  try {
    switch (stageDef.type) {
      case "DISCOVER":
        await runDiscoverStage(state, stageDef, target, callTool, outcome);
        break;
      case "RESEARCH":
        await runResearchStage(state, stageDef, callTool, outcome);
        break;
      case "QUALIFY":
        runQualifyStage(state, outcome);
        break;
      case "SCORE":
        runScoreStage(state, outcome);
        break;
      case "LOAD_CONTEXT":
        await runLoadContextStage(state, stageDef, callTool, outcome);
        break;
      case "CREATE_LEAD":
        await runCreateLeadStage(state, stageDef, callTool, outcome);
        break;
      case "CREATE_TASK":
        await runCreateTaskStage(state, stageDef, callTool, outcome);
        break;
      case "OUTREACH_DRAFT":
        runOutreachDraftStage(state, stageDef, outcome);
        break;
      case "FOLLOW_UP":
        await runFollowUpStage(state, stageDef, callTool, outcome);
        break;
      case "LOG_ACTIVITY":
        await runLogActivityStage(state, stageDef, callTool, outcome);
        break;
      case "COMPLETE":
        outcome.note = "final summary built";
        break;
    }
  } catch (err) {
    outcome.status = "failed";
    outcome.error = err instanceof Error ? err.message : "Unknown stage error.";
  }

  outcome.durationMs = Date.now() - stageStart;
  await logWorkflowEvent(ctx, outcome.status === "failed" ? "workflow.stage.failed" : "workflow.stage.completed", {
    workflowId: state.request.workflowId,
    runId: state.workflowRunId,
    stageId: stageDef.id,
    status: outcome.status,
    toolCalls: outcome.toolCalls,
    error: outcome.error,
  });
  return outcome;
}

// ─── individual stages ───────────────────────────────────────────────────────

async function runDiscoverStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  target: number,
  callTool: <T = unknown>(name: string, input: unknown) => Promise<T>,
  outcome: StageOutcome,
): Promise<void> {
  const params = state.request.params;

  // Bulk requests exceed the synchronous discovery.search cap (20). Delegate to
  // the Phase-3 discovery.pipeline job instead of looping the tool.
  if (target > 20) {
    const job = await enqueueJob({
      organizationId: state.ctx.organization.id,
      actorId: state.ctx.user.id,
      type: "discovery.pipeline",
      payload: {
        industry: params.target ?? "business",
        location: params.location ?? "anywhere",
        websiteFilter: params.websiteRequirement === "none" ? "no_website" : "any",
        opportunity: params.websiteRequirement === "weak" ? "website_improvement" : "any",
        limit: Math.min(target, 50),
      },
    });
    state.deferredJobId = (job as { id: string }).id;
    outcome.status = "deferred";
    outcome.note = `Bulk discovery (${target} requested) delegated to discovery.pipeline job ${state.deferredJobId}.`;
    return;
  }

  const keyword = [params.target, params.location].filter(Boolean).join(" ") || "business";
  const locationParts = (params.location ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const result = await callTool<{ companies?: DiscoveredCompany[] }>("discovery.search", {
    keyword,
    ...(locationParts.length > 1 ? { city: locationParts[0], state: locationParts[1] } : {}),
    ...(locationParts.length === 1 ? { state: locationParts[0] } : {}),
    maxResults: Math.min(target, 20),
  });

  const companies = (result.companies ?? []).slice(0, Math.min(target, state.budget.maxLeads));
  outcome.itemsProcessed = companies.length;
  outcome.itemsSucceeded = companies.length;

  state.prospects = companies.map((c, i) => ({
    prospectKey: `${state.workflowRunId}-p${i}`,
    name: c.name,
    website: c.website ?? null,
    location: [c.city, c.state, c.country].filter(Boolean).join(", ") || null,
    industry: c.category ?? params.target ?? null,
    provenance: "VERIFIED_DATA" as const,
    source: c.provider,
    sourceUrl: c.sourceUrl ?? null,
    observedAt: c.discoveredAt,
    research: null,
    qualified: false,
    qualificationReasons: [],
    score: null,
    scoreBand: null,
    crmLeadId: null,
    failed: false,
    failureReason: null,
  }));

  if (companies.length === 0) {
    throw new WorkflowExecutionError("NO_PROSPECTS_FOUND", "Discovery returned no prospects.");
  }
}

async function runResearchStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  callTool: <T = unknown>(name: string, input: unknown) => Promise<T>,
  outcome: StageOutcome,
): Promise<void> {
  const withWebsite = state.prospects.filter((p) => p.website && !p.failed);
  for (const prospect of withWebsite) {
    if (state.toolCalls >= state.budget.maxToolCalls || outcome.toolCalls >= stageDef.maxToolCalls) break;
    outcome.itemsProcessed += 1;
    try {
      const findings = await callTool<Record<string, unknown>>("research.website", { url: prospect.website });
      prospect.research = findings;
      outcome.itemsSucceeded += 1;
    } catch (err) {
      // Failure isolation: one bad website never kills the workflow.
      prospect.research = null;
      prospect.failureReason = `research failed: ${err instanceof Error ? err.message : "unknown"}`;
      outcome.itemsFailed += 1;
    }
  }
}

function runQualifyStage(state: ExecutionState, outcome: StageOutcome): void {
  const websiteRequirement = state.request.params.websiteRequirement;

  if (state.request.workflowId === "reengage-existing-lead") {
    // Single-lead workflow: qualify from CRM status, not discovery signals.
    const lead = state.leadContext?.lead as { status?: string } | undefined;
    const status = lead?.status ?? "UNKNOWN";
    const qualified = ["NEW", "RESEARCHING", "QUALIFIED", "CONTACTED", "REPLIED"].includes(status);
    outcome.itemsProcessed = 1;
    outcome.itemsSucceeded = qualified ? 1 : 0;
    outcome.note = qualified ? `lead status ${status} — eligible for re-engagement` : `lead status ${status} — not eligible`;
    state.leadContext = { ...state.leadContext, qualified, qualificationReason: `status:${status}` };
    return;
  }

  for (const prospect of state.prospects) {
    if (prospect.failed) continue;
    outcome.itemsProcessed += 1;
    const { qualified, reasons } = qualifyProspect(prospect, websiteRequirement);
    prospect.qualified = qualified;
    prospect.qualificationReasons = reasons;
    if (qualified) outcome.itemsSucceeded += 1;
    else outcome.itemsFailed += 1;
  }
}

function runScoreStage(state: ExecutionState, outcome: StageOutcome): void {
  for (const prospect of state.prospects) {
    if (!prospect.qualified || prospect.failed) continue;
    outcome.itemsProcessed += 1;
    try {
      const inspection: { id: string; findings: Record<string, unknown> } | null = prospect.research
        ? { id: prospect.prospectKey, findings: prospect.research }
        : null;
      const result = calculateScore(
        {
          id: prospect.prospectKey,
          website: prospect.website,
          industry: prospect.industry,
          city: null,
          country: null,
          company: { id: prospect.prospectKey, name: prospect.name, website: prospect.website, industry: prospect.industry },
        },
        inspection,
        null,
      );
      prospect.score = result.score;
      prospect.scoreBand = result.scoreBand;
      outcome.itemsSucceeded += 1;
    } catch (err) {
      prospect.failed = true;
      prospect.failureReason = `scoring failed: ${err instanceof Error ? err.message : "unknown"}`;
      outcome.itemsFailed += 1;
    }
  }
}

async function runLoadContextStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  callTool: <T = unknown>(name: string, input: unknown) => Promise<T>,
  outcome: StageOutcome,
): Promise<void> {
  const leadId = state.request.params.leadId;
  if (!leadId) {
    throw new WorkflowExecutionError("LEAD_ID_REQUIRED", "reengage-existing-lead requires params.leadId.");
  }
  outcome.itemsProcessed = 1;
  const lead = await getLead(state.ctx.organization.id, leadId);
  if (!lead) {
    throw new WorkflowExecutionError("LEAD_NOT_FOUND", "Lead not found in this organization.");
  }
  let intelligence: unknown = null;
  try {
    if (lead.website) {
      intelligence = await callTool("research.lead", { leadId });
    }
  } catch {
    // Research failure is non-fatal for context loading.
  }
  let leadMemory = 0;
  try {
    leadMemory = (await recall(state.ctx, "LEAD", leadId, { limit: 10 })).length;
  } catch {
    // ignore
  }
  state.leadContext = { lead, intelligence, leadMemory };
  outcome.itemsSucceeded = 1;
  outcome.note = `loaded lead ${leadId} + ${leadMemory} LEAD memories`;
}

async function runCreateLeadStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  callTool: <T = unknown>(name: string, input: unknown) => Promise<T>,
  outcome: StageOutcome,
): Promise<void> {
  const params = state.request.params;
  for (const prospect of state.prospects) {
    if (!prospect.qualified || prospect.failed || prospect.crmLeadId) continue;
    if (state.toolCalls >= state.budget.maxToolCalls || outcome.toolCalls >= stageDef.maxToolCalls) break;
    outcome.itemsProcessed += 1;
    try {
      const created = await callTool<{ lead?: { id: string }; duplicate?: boolean }>("crm.createLead", {
        companyName: prospect.name,
        website: prospect.website ?? undefined,
        industry: prospect.industry ?? undefined,
        location: prospect.location ?? undefined,
        sourceType: "AI_DISCOVERY",
        sourceDetail: `workflow:${state.request.workflowId}`,
        sourceUrl: prospect.sourceUrl ?? undefined,
        tags: ["workflow", state.request.workflowId],
      });
      prospect.crmLeadId = created.lead?.id ?? null;
      if (created.duplicate) {
        outcome.note = `${outcome.note ?? ""} duplicate-detected;`.trim();
      }
      outcome.itemsSucceeded += 1;
    } catch (err) {
      // Failure isolation + idempotency: a duplicate or bad record never kills the run.
      prospect.failed = true;
      prospect.failureReason = `lead creation failed: ${err instanceof Error ? err.message : "unknown"}`;
      outcome.itemsFailed += 1;
    }
  }
}

async function runCreateTaskStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  callTool: <T = unknown>(name: string, input: unknown) => Promise<T>,
  outcome: StageOutcome,
): Promise<void> {
  // Generic stage: one task per qualified prospect that has a CRM lead.
  for (const prospect of state.prospects) {
    if (!prospect.crmLeadId || prospect.failed) continue;
    if (state.toolCalls >= state.budget.maxToolCalls || outcome.toolCalls >= stageDef.maxToolCalls) break;
    outcome.itemsProcessed += 1;
    try {
      await callTool("crm.createTask", {
        title: `Follow up: ${prospect.name}`,
        detail: `Qualified via workflow ${state.request.workflowId}. Score: ${prospect.score ?? "n/a"} (${prospect.scoreBand ?? "n/a"}).`,
        leadId: prospect.crmLeadId,
      });
      outcome.itemsSucceeded += 1;
    } catch {
      outcome.itemsFailed += 1;
    }
  }
}

/**
 * OUTREACH_DRAFT never creates the draft here. It builds the proposal and
 * pauses — the executor returns WAITING_FOR_APPROVAL. No bypass exists.
 */
function runOutreachDraftStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  outcome: StageOutcome,
): void {
  const params = state.request.params;
  const channel = params.outreachChannel ?? "WHATSAPP";

  let target: string;
  let proposedInput: Record<string, unknown>;
  let reason: string;

  if (state.request.workflowId === "reengage-existing-lead") {
    const lead = state.leadContext?.lead as { id: string; fullName?: string | null; company?: { name?: string | null } | null } | undefined;
    const qualified = state.leadContext?.qualified as boolean | undefined;
    if (!lead) {
      throw new WorkflowExecutionError("NO_LEAD_CONTEXT", "Cannot draft outreach without loaded lead context.");
    }
    if (!qualified) {
      outcome.status = "skipped";
      outcome.note = "lead not eligible for re-engagement; draft skipped";
      return;
    }
    const name = lead.company?.name ?? lead.fullName ?? "there";
    target = `lead ${lead.id} (${name})`;
    proposedInput = {
      leadId: lead.id,
      channel,
      subject: channel === "EMAIL" ? `Quick follow-up for ${name}` : undefined,
      body: `Hi ${name} team,\n\nFollowing up on our earlier conversation — happy to pick this back up whenever it suits you.\n\n— DRAFT for human review, not sent —`,
    };
    reason = "Re-engagement draft prepared from CRM + memory context; requires human approval before creation.";
  } else {
    const qualified = state.prospects.filter((p) => p.qualified && !p.failed);
    if (qualified.length === 0) {
      outcome.status = "skipped";
      outcome.note = "no qualified prospects; draft skipped";
      return;
    }
    const top = [...qualified].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
    const weaknesses = extractWebsiteSignals(top[0].research).weaknesses;
    target = top.map((p) => p.name).join(", ");
    proposedInput = {
      ...(top[0].crmLeadId ? { leadId: top[0].crmLeadId } : {}),
      channel,
      subject: channel === "EMAIL" ? `Ideas for ${top[0].name}'s website` : undefined,
      body: buildDraftBody(top[0], weaknesses),
    };
    reason = `Outreach draft proposal for top qualified prospect(s); requires human approval. ${qualified.length} qualified in total.`;
  }

  state.approval = {
    workflowId: state.request.workflowId,
    stageId: stageDef.id,
    action: "outreach.createDraft",
    proposedInput,
    target,
    reason,
  };
  outcome.status = "waiting_approval";
  outcome.itemsProcessed = 1;
  outcome.note = "paused for approval — draft NOT created";
}

async function runFollowUpStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  callTool: <T = unknown>(name: string, input: unknown) => Promise<T>,
  outcome: StageOutcome,
): Promise<void> {
  const lead = state.leadContext?.lead as { id: string } | undefined;
  const qualified = state.leadContext?.qualified as boolean | undefined;
  if (!lead || !qualified) {
    outcome.status = "skipped";
    outcome.note = "no eligible lead; follow-up skipped";
    return;
  }
  // Idempotency: never schedule a duplicate follow-up for the same lead.
  const existing = await db.followUp.findFirst({
    where: { organizationId: state.ctx.organization.id, leadId: lead.id, status: "SCHEDULED" },
    select: { id: true },
  });
  if (existing) {
    outcome.status = "skipped";
    outcome.note = `follow-up already scheduled (${existing.id}); not duplicated`;
    return;
  }
  outcome.itemsProcessed = 1;
  const channel = state.request.params.outreachChannel ?? "WHATSAPP";
  await callTool("crm.createFollowUp", {
    leadId: lead.id,
    channel,
    scheduledAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
    body: `Re-engagement follow-up prepared by workflow ${state.request.workflowId}.`,
  });
  outcome.itemsSucceeded = 1;
}

async function runLogActivityStage(
  state: ExecutionState,
  stageDef: StageDefinition,
  callTool: <T = unknown>(name: string, input: unknown) => Promise<T>,
  outcome: StageOutcome,
): Promise<void> {
  for (const prospect of state.prospects) {
    if (!prospect.crmLeadId || prospect.failed) continue;
    if (state.toolCalls >= state.budget.maxToolCalls || outcome.toolCalls >= stageDef.maxToolCalls) break;
    outcome.itemsProcessed += 1;
    try {
      await callTool("crm.logActivity", {
        leadId: prospect.crmLeadId,
        type: "discovered",
        title: `Workflow ${state.request.workflowId}`,
        detail: `Qualified=${prospect.qualified} score=${prospect.score ?? "n/a"}`,
      });
      outcome.itemsSucceeded += 1;
    } catch {
      outcome.itemsFailed += 1;
    }
  }
}

// ─── final counts (honest — never inflate) ───────────────────────────────────

function finalizeCounts(state: ExecutionState, target: number): WorkflowCounts {
  const counts = emptyCounts();
  counts.requested = target;
  const prospects = state.prospects;
  counts.processed = prospects.length;
  for (const p of prospects) {
    if (p.failed) counts.failed += 1;
    else if (p.qualified) counts.successful += 1;
    else counts.skipped += 1; // processed but filtered out by qualification rules
  }
  if (state.deferredJobId) {
    counts.deferred = target;
  }
  return counts;
}
