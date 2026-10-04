/**
 * AI Sales Mind — structured memory layer (Phase 5).
 *
 * Secure, tenant-isolated, JSON-structured memory so the Mind can remember
 * useful sales context across runs. Memory is DATA, not instructions: it is
 * always presented to the model as UNTRUSTED MEMORY DATA and must never be
 * interpreted as system rules.
 *
 * Scopes:
 * - ORG:  org-wide preferences / ICP / business rules (scopeId = organizationId)
 * - RUN:  bounded summary of one Mind run (scopeId = runId, short-lived by default)
 * - LEAD: researched facts about one lead (scopeId = lead id, ownership verified)
 *
 * Security invariants:
 * - organizationId ALWAYS comes from WorkspaceContext, never from the caller.
 * - Secret-like keys and credential-like values are rejected (fail closed).
 * - Values are JSON-compatible and size-bounded.
 * - TTL is bounded; recall never returns expired records.
 * - Every outcome is audited (metadata only, never secrets).
 */
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import type { WorkspaceContext } from "../tenant";
import type { AgentRunResult } from "./types";

// ── Limits (conservative) ──────────────────────────────────────────────
/** Max serialized bytes of a single memory value (raw data, pre-envelope). */
export const MEMORY_MAX_VALUE_BYTES = 8 * 1024;
/** Hard cap on items returned by a single recall. */
export const MEMORY_MAX_RECALL_ITEMS = 20;
/** Default recall size — small on purpose; never dump memory into context. */
export const MEMORY_DEFAULT_RECALL_LIMIT = 5;
/** Max serialized bytes of a run summary. */
export const MEMORY_MAX_RUN_SUMMARY_BYTES = 4 * 1024;
/** TTL bounds. */
export const MEMORY_MIN_TTL_SECONDS = 60;
export const MEMORY_MAX_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year
/** RUN memories are short-lived unless the caller says otherwise. */
export const MEMORY_DEFAULT_RUN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
/** Max keys remembered in one batch operation (currently unused — single writes). */
export const MEMORY_MAX_KEYS_PER_OPERATION = 20;

export type MemoryScope = "ORG" | "RUN" | "LEAD";

export type MemoryProvenance =
  | "VERIFIED DATA"
  | "AI INFERENCE"
  | "USER PROVIDED"
  | "DEMO DATA";

export class MemoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ── Secret protection ──────────────────────────────────────────────────
// Denylist of secret-like key PARTS (split on case/snake/kebab boundaries so
// "secretary" does not match "secret"). Values are rejected only on
// high-confidence credential patterns to avoid false positives on sales data.
const SECRET_KEY_PARTS = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "secrets",
  "token",
  "tokens",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "session",
  "cookie",
  "cookies",
  "authorization",
  "auth",
  "apikey",
  "privatekey",
  "clientsecret",
  "webhooksecret",
  "bearer",
  "credential",
  "credentials",
]);

const SECRET_KEY_COMPOUNDS = [
  "apikey",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "privatekey",
  "clientsecret",
  "webhooksecret",
];

function splitKeyParts(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isSecretKey(key: string): boolean {
  const parts = splitKeyParts(key);
  if (parts.some((p) => SECRET_KEY_PARTS.has(p))) return true;
  const joined = parts.join("");
  return SECRET_KEY_COMPOUNDS.some((c) => joined.includes(c));
}

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/=]{8,}/, // Bearer tokens
  /\bsk-(live|test)-[A-Za-z0-9]{8,}/, // Stripe-style keys
  /\bsk_[A-Za-z0-9]{16,}/, // generic sk_ keys
  /\bghp_[A-Za-z0-9]{20,}/, // GitHub personal access tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/, // GitHub fine-grained PATs
  /\bAIza[A-Za-z0-9_-]{20,}/, // Google API keys
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, // private key blocks
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWTs
];

function assertNoSecrets(key: string, value: unknown, path = "value"): void {
  if (isSecretKey(key)) {
    throw new MemoryError(
      "SECRET_KEY_REJECTED",
      `Memory key "${key}" looks like a credential and was rejected.`,
    );
  }
  walkValue(value, path);
}

function walkValue(value: unknown, path: string): void {
  if (typeof value === "string") {
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        throw new MemoryError(
          "SECRET_VALUE_REJECTED",
          `Memory value at "${path}" looks like a credential and was rejected.`,
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkValue(item, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        throw new MemoryError(
          "SECRET_KEY_REJECTED",
          `Memory value key "${path}.${k}" looks like a credential and was rejected.`,
        );
      }
      walkValue(v, `${path}.${k}`);
    }
  }
}

// ── Validation schemas ─────────────────────────────────────────────────
const scopeEnum = z.enum(["ORG", "RUN", "LEAD"]);
const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Memory key may only contain letters, numbers, dots, underscores and hyphens.",
  );

const rememberSchema = z
  .object({
    scope: scopeEnum,
    scopeId: z.string().trim().min(1).max(200),
    key: keySchema,
    value: z.unknown(),
    ttlSeconds: z.number().int().min(MEMORY_MIN_TTL_SECONDS).max(MEMORY_MAX_TTL_SECONDS).optional(),
    provenance: z.enum(["VERIFIED DATA", "AI INFERENCE", "USER PROVIDED", "DEMO DATA"]).optional(),
    source: z.string().trim().max(300).optional(),
    sourceUrl: z.string().trim().max(500).optional(),
  })
  .strict();

const recallSchema = z
  .object({
    scope: scopeEnum,
    scopeId: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(MEMORY_MAX_RECALL_ITEMS).optional(),
    keyPrefix: z
      .string()
      .trim()
      .max(120)
      .regex(/^[a-zA-Z0-9._-]*$/, "Invalid key prefix.")
      .optional(),
  })
  .strict();

// ── Types ──────────────────────────────────────────────────────────────
export interface RememberInput {
  scope: MemoryScope;
  scopeId: string;
  key: string;
  value: unknown;
  ttlSeconds?: number;
  provenance?: MemoryProvenance;
  source?: string;
  sourceUrl?: string;
}

/** Memory record as returned to consumers (envelope unwrapped). */
export interface RecalledMemory {
  key: string;
  value: unknown;
  provenance: MemoryProvenance;
  source?: string;
  sourceUrl?: string;
  observedAt: string;
  expiresAt: string | null;
  updatedAt: string;
}

interface MemoryEnvelope {
  v: 1;
  data: unknown;
  provenance: MemoryProvenance;
  source?: string;
  sourceUrl?: string;
  observedAt: string;
}

function unwrapEnvelope(raw: unknown, fallbackKey: string): Omit<RecalledMemory, "key" | "expiresAt" | "updatedAt"> {
  if (
    raw !== null &&
    typeof raw === "object" &&
    (raw as { v?: unknown }).v === 1 &&
    "data" in (raw as object)
  ) {
    const env = raw as MemoryEnvelope;
    return {
      value: env.data,
      provenance: env.provenance ?? "AI INFERENCE",
      ...(env.source ? { source: env.source } : {}),
      ...(env.sourceUrl ? { sourceUrl: env.sourceUrl } : {}),
      observedAt: env.observedAt ?? new Date(0).toISOString(),
    };
  }
  // Tolerate legacy/plain values written without an envelope.
  return { value: raw, provenance: "AI INFERENCE", observedAt: new Date(0).toISOString() };
}

// ── Audit ──────────────────────────────────────────────────────────────
export type MemoryAuditEvent =
  | "memory.created"
  | "memory.updated"
  | "memory.recalled"
  | "memory.rejected"
  | "memory.expired"
  | "memory.failed";

export async function logMemoryEvent(args: {
  ctx: WorkspaceContext;
  event: MemoryAuditEvent;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await audit({
    organizationId: args.ctx.organization.id,
    actorId: args.ctx.user.id,
    action: args.event,
    resource: "AgentMemory",
    result: args.event === "memory.rejected" || args.event === "memory.failed" ? "FAILED" : "SUCCESS",
    metadata: args.metadata ?? {},
  });
}

// ── TTL ────────────────────────────────────────────────────────────────
/**
 * Resolve expiresAt for a remember() call.
 * - Explicit ttlSeconds always wins (within bounds).
 * - RUN memories default to 7 days (short-lived by design).
 * - ORG/LEAD memories persist (null) unless a TTL is given.
 */
export function resolveExpiresAt(
  scope: MemoryScope,
  ttlSeconds: number | undefined,
  now: Date = new Date(),
): Date | null {
  if (ttlSeconds !== undefined) {
    return new Date(now.getTime() + ttlSeconds * 1000);
  }
  if (scope === "RUN") {
    return new Date(now.getTime() + MEMORY_DEFAULT_RUN_TTL_SECONDS * 1000);
  }
  return null;
}

// ── remember ───────────────────────────────────────────────────────────
/**
 * Store (upsert) one memory record. organizationId is ALWAYS derived from
 * ctx — never from caller input. Fails closed on any security violation.
 */
export async function remember(
  ctx: WorkspaceContext,
  input: unknown,
): Promise<{ key: string; scope: MemoryScope; updated: boolean }> {
  const organizationId = ctx.organization.id;
  const parsed = rememberSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    await logMemoryEvent({
      ctx,
      event: "memory.rejected",
      metadata: {
        reason: "INVALID_INPUT",
        detail: first ? `${first.path.join(".") || "(root)"} — ${first.message}` : "Invalid input.",
      },
    });
    throw new MemoryError(
      "INVALID_INPUT",
      first
        ? `Invalid memory input: ${first.path.join(".") || "(root)"} — ${first.message}`
        : "Invalid memory input.",
    );
  }
  const { scope, scopeId, key, value, ttlSeconds, source, sourceUrl } = parsed.data;
  const provenance: MemoryProvenance = parsed.data.provenance ?? "AI INFERENCE";

  try {
    // Scope rules.
    let effectiveScopeId = scopeId;
    if (scope === "ORG") {
      if (scopeId !== organizationId) {
        throw new MemoryError(
          "SCOPE_MISMATCH",
          "ORG memory scopeId must equal the current organization id.",
        );
      }
      effectiveScopeId = organizationId;
    }
    if (scope === "LEAD") {
      const lead = await db.lead.findFirst({
        where: { id: scopeId, organizationId },
        select: { id: true },
      });
      if (!lead) {
        throw new MemoryError(
          "LEAD_NOT_FOUND",
          "Lead not found in this organization. Cross-tenant lead memory is not allowed.",
        );
      }
    }

    // Value must be JSON-compatible…
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new MemoryError("VALUE_NOT_JSON", "Memory value must be JSON-serializable.");
    }
    if (serialized === undefined) {
      throw new MemoryError("VALUE_NOT_JSON", "Memory value must be JSON-serializable.");
    }
    // …bounded…
    if (Buffer.byteLength(serialized, "utf8") > MEMORY_MAX_VALUE_BYTES) {
      throw new MemoryError(
        "VALUE_TOO_LARGE",
        `Memory value exceeds ${MEMORY_MAX_VALUE_BYTES} bytes.`,
      );
    }
    // …and secret-free (fail closed).
    assertNoSecrets(key, value);

    const envelope: MemoryEnvelope = {
      v: 1,
      data: value,
      provenance,
      ...(source ? { source } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      observedAt: new Date().toISOString(),
    };
    const expiresAt = resolveExpiresAt(scope, ttlSeconds);

    const existing = await db.agentMemory.findFirst({
      where: { organizationId, scope, scopeId: effectiveScopeId, key },
      select: { id: true },
    });
    await db.agentMemory.upsert({
      where: {
        organizationId_scope_scopeId_key: {
          organizationId,
          scope,
          scopeId: effectiveScopeId,
          key,
        },
      },
      create: {
        organizationId,
        scope,
        scopeId: effectiveScopeId,
        key,
        value: envelope as object,
        expiresAt,
      },
      update: { value: envelope as object, expiresAt },
    });
    await logMemoryEvent({
      ctx,
      event: existing ? "memory.updated" : "memory.created",
      metadata: { scope, key, provenance, ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}) },
    });
    return { key, scope, updated: Boolean(existing) };
  } catch (err) {
    if (err instanceof MemoryError) {
      // Security/validation rejections are already audited where raised;
      // audit here for scope/lead/value failures raised inside try.
      if (
        err.code === "SCOPE_MISMATCH" ||
        err.code === "LEAD_NOT_FOUND" ||
        err.code === "VALUE_NOT_JSON" ||
        err.code === "VALUE_TOO_LARGE" ||
        err.code === "SECRET_KEY_REJECTED" ||
        err.code === "SECRET_VALUE_REJECTED"
      ) {
        await logMemoryEvent({
          ctx,
          event: "memory.rejected",
          metadata: { reason: err.code, scope, key },
        }).catch(() => {});
      }
      throw err;
    }
    await logMemoryEvent({
      ctx,
      event: "memory.failed",
      metadata: { operation: "remember", scope, key },
    }).catch(() => {});
    throw new MemoryError("MEMORY_BACKEND_FAILED", "Memory backend unavailable. Please try again later.");
  }
}

// ── recall ─────────────────────────────────────────────────────────────
/**
 * Recall bounded, tenant-isolated, non-expired memories for a scope.
 * Deterministic order (updatedAt desc, key asc). Expired rows are deleted
 * lazily. Never throws raw backend errors.
 */
export async function recall(
  ctx: WorkspaceContext,
  scope: MemoryScope,
  scopeId: string,
  options?: { limit?: number; keyPrefix?: string },
): Promise<RecalledMemory[]> {
  const organizationId = ctx.organization.id;
  const parsed = recallSchema.safeParse({ scope, scopeId, ...options });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MemoryError(
      "INVALID_INPUT",
      first
        ? `Invalid recall input: ${first.path.join(".") || "(root)"} — ${first.message}`
        : "Invalid recall input.",
    );
  }
  const { limit = MEMORY_DEFAULT_RECALL_LIMIT, keyPrefix } = parsed.data;
  const effectiveScopeId = parsed.data.scopeId;

  try {
    if (parsed.data.scope === "ORG" && effectiveScopeId !== organizationId) {
      throw new MemoryError("SCOPE_MISMATCH", "ORG memory scopeId must equal the current organization id.");
    }
    if (parsed.data.scope === "LEAD") {
      const lead = await db.lead.findFirst({
        where: { id: effectiveScopeId, organizationId },
        select: { id: true },
      });
      if (!lead) {
        throw new MemoryError("LEAD_NOT_FOUND", "Lead not found in this organization.");
      }
    }

    const now = new Date();
    // Lazy expiry: remove expired rows for this scope (best effort).
    try {
      const expired = await db.agentMemory.deleteMany({
        where: {
          organizationId,
          scope: parsed.data.scope,
          scopeId: effectiveScopeId,
          expiresAt: { lte: now },
        },
      });
      if (expired.count > 0) {
        await logMemoryEvent({
          ctx,
          event: "memory.expired",
          metadata: { scope: parsed.data.scope, count: expired.count },
        });
      }
    } catch {
      // Lazy expiry must never break recall.
    }

    const rows = await db.agentMemory.findMany({
      where: {
        organizationId,
        scope: parsed.data.scope,
        scopeId: effectiveScopeId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        ...(keyPrefix ? { key: { startsWith: keyPrefix } } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { key: "asc" }],
      take: Math.min(limit, MEMORY_MAX_RECALL_ITEMS),
    });

    await logMemoryEvent({
      ctx,
      event: "memory.recalled",
      metadata: { scope: parsed.data.scope, count: rows.length },
    });

    return rows.map((row) => {
      const unwrapped = unwrapEnvelope(row.value, row.key);
      return {
        key: row.key,
        ...unwrapped,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  } catch (err) {
    if (err instanceof MemoryError) throw err;
    await logMemoryEvent({
      ctx,
      event: "memory.failed",
      metadata: { operation: "recall", scope },
    }).catch(() => {});
    throw new MemoryError("MEMORY_BACKEND_FAILED", "Memory backend unavailable. Please try again later.");
  }
}

/** Recall memories for one AI Sales Mind run (scopeId = runId). */
export async function recallRun(
  ctx: WorkspaceContext,
  runId: string,
): Promise<RecalledMemory[]> {
  return recall(ctx, "RUN", runId, { limit: MEMORY_MAX_RECALL_ITEMS });
}

// ── summarizeRun ───────────────────────────────────────────────────────
/**
 * Build a small DETERMINISTIC summary from an AgentRunResult.
 * Never stores: raw tool outputs, prompts, or model chain-of-thought
 * (the result object carries none of these by construction).
 * Model-generated text is quarantined as AI INFERENCE.
 */
export function summarizeRun(result: AgentRunResult): Record<string, unknown> {
  const toolCalls = result.toolCalls ?? [];
  const succeeded = toolCalls.filter((c) => c.status === "success").length;
  const failed = toolCalls.filter((c) => c.status === "failed").length;
  const deferred = toolCalls.filter((c) => c.status === "deferred_to_job");

  const toolOutcomes = toolCalls
    .slice(0, 10)
    .map((c) => `${c.tool}: ${c.status}${c.jobId ? ` (job ${c.jobId})` : ""}`);

  const notableFailures = toolCalls
    .filter((c) => c.status === "failed")
    .slice(0, 5)
    .map((c) => ({ tool: c.tool, detail: c.summary.slice(0, 200) }));

  // Extract the model's closing note from the deterministic summary format.
  let agentNote: string | null = null;
  const noteLine = (result.summary ?? "")
    .split("\n")
    .find((l) => l.startsWith("Agent note (model-generated, unverified):"));
  if (noteLine) {
    agentNote = noteLine.slice("Agent note (model-generated, unverified):".length).trim().slice(0, 500) || null;
  }

  let nextUsefulAction: string;
  if (result.pendingApproval) {
    nextUsefulAction = `Awaiting human approval for tool "${result.pendingApproval.tool}".`;
  } else if (deferred.length > 0) {
    nextUsefulAction = `Background job ${deferred[0].jobId} (${deferred[0].tool}) is running; check its result later.`;
  } else if (notableFailures.length > 0) {
    nextUsefulAction = "Review the failed tool calls and retry with corrected input.";
  } else if (result.status === "COMPLETED") {
    nextUsefulAction = "None — goal completed.";
  } else {
    nextUsefulAction = `Review run status "${result.status}".`;
  }

  const summary: Record<string, unknown> = {
    // USER PROVIDED
    goal: result.goal.slice(0, 500),
    // VERIFIED DATA (system records)
    runId: result.runId,
    status: result.status,
    completedAt: new Date().toISOString(),
    toolCallCounts: { total: toolCalls.length, succeeded, failed, deferred: deferred.length },
    toolOutcomes,
    deferredJobs: deferred.map((d) => ({ tool: d.tool, jobId: d.jobId ?? null })),
    pendingApproval: result.pendingApproval
      ? { tool: result.pendingApproval.tool, reason: result.pendingApproval.reason.slice(0, 300) }
      : null,
    notableFailures,
    nextUsefulAction,
    // AI INFERENCE (quarantined, never presented as fact)
    agentClosingNote: agentNote
      ? { text: agentNote, provenance: "AI INFERENCE" as MemoryProvenance }
      : null,
  };

  // Enforce the byte bound: shrink the least-critical fields first.
  let bytes = Buffer.byteLength(JSON.stringify(summary), "utf8");
  if (bytes > MEMORY_MAX_RUN_SUMMARY_BYTES) {
    if (summary.agentClosingNote && typeof summary.agentClosingNote === "object") {
      (summary.agentClosingNote as Record<string, unknown>).text = (
        ((summary.agentClosingNote as Record<string, unknown>).text as string) ?? ""
      ).slice(0, 200);
    }
    summary.toolOutcomes = (summary.toolOutcomes as string[]).slice(0, 5);
    bytes = Buffer.byteLength(JSON.stringify(summary), "utf8");
  }
  if (bytes > MEMORY_MAX_RUN_SUMMARY_BYTES) {
    // Last resort: keep only the core verified fields.
    const core: Record<string, unknown> = {
      goal: summary.goal,
      runId: summary.runId,
      status: summary.status,
      completedAt: summary.completedAt,
      toolCallCounts: summary.toolCallCounts,
      nextUsefulAction: summary.nextUsefulAction,
    };
    return core;
  }
  return summary;
}
