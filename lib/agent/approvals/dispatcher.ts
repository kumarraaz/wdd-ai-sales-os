/**
 * Phase 7 — approval action dispatcher.
 *
 * The ONLY way an approved action executes. A small allowlist maps approval
 * action types to existing Phase-2 registry tools. The dispatcher:
 *   - accepts only known action types (never a client-supplied tool name),
 *   - re-validates the STORED snapshot against the tool's CURRENT schema,
 *   - executes through executeTool() with the caller's WorkspaceContext,
 *   - never accepts replacement input, never touches eval/import/shell/SQL.
 */

import type { WorkspaceContext } from "../../tenant";
import { executeTool, getTool } from "../tools/registry";
import {
  APPROVAL_ACTION_TOOL,
  type ApprovalActionType,
} from "./types";

export class ApprovalDispatchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApprovalDispatchError";
    this.code = code;
  }
}

export interface DispatchedAction {
  tool: string;
  /** Opaque result id when the tool returns one (e.g. created draft id). */
  resultId: string | null;
}

function extractResultId(data: unknown): string | null {
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    // Known tool result shapes: { lead: { id } }, { id }, { draft/message: { id } }.
    for (const key of ["id", "draftId", "messageId", "followUpId", "taskId"]) {
      if (typeof rec[key] === "string") return rec[key] as string;
    }
    for (const nested of ["lead", "draft", "message", "task", "followUp"]) {
      const inner = rec[nested];
      if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).id === "string") {
        return (inner as Record<string, unknown>).id as string;
      }
    }
  }
  return null;
}

/**
 * Execute an approved action snapshot. `proposedInput` must be the STORED
 * snapshot from the approval record — never client input.
 */
export async function executeApprovedAction(
  ctx: WorkspaceContext,
  actionType: ApprovalActionType,
  proposedInput: unknown,
): Promise<DispatchedAction> {
  const toolName = APPROVAL_ACTION_TOOL[actionType];
  if (!toolName) {
    throw new ApprovalDispatchError("UNKNOWN_ACTION_TYPE", `Unknown approval action type "${actionType}".`);
  }
  const tool = getTool(toolName);
  if (!tool) {
    throw new ApprovalDispatchError("TOOL_NOT_REGISTERED", `Tool "${toolName}" is not registered.`);
  }
  // Re-validate the snapshot against the tool's CURRENT schema. If the schema
  // changed since the proposal, fail closed rather than executing blindly.
  const parsed = tool.inputSchema.safeParse(proposedInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApprovalDispatchError(
      "ACTION_SCHEMA_MISMATCH",
      `Approved input no longer matches "${toolName}" schema: ${first ? `${first.path.join(".") || "(root)"} — ${first.message}` : "invalid"}.`,
    );
  }
  const result = await executeTool(toolName, ctx, parsed.data);
  if (!result.success) {
    throw new ApprovalDispatchError(
      result.error?.code ?? "TOOL_EXECUTION_FAILED",
      result.error?.message ?? `Tool "${toolName}" failed.`,
    );
  }
  return { tool: toolName, resultId: extractResultId(result.data) };
}
