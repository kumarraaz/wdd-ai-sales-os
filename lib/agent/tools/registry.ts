/**
 * Agent Tool Registry (Phase 2).
 *
 * Server-side only. A typed, org-scoped registry of callable sales tools.
 * The future AI Sales Mind will call executeTool(); nothing here executes
 * anything by itself.
 *
 * Safety rules:
 * - Tool names are unique; duplicates are rejected at registration.
 * - Handlers are registered by server code only — never from client input.
 * - Every handler receives a WorkspaceContext (from lib/tenant.ts) and
 *   MUST scope all data access to ctx.organization.id. Tool input is never
 *   trusted for organizationId.
 * - Inputs are validated with Zod before the handler runs.
 * - Errors are returned as typed { code, message } — never stack traces,
 *   never secrets.
 */
import { z } from "zod";
import type { WorkspaceContext } from "../../tenant";

// Re-exported so tool authors and callers share one context type.
// The tenant system itself lives in lib/tenant.ts — this module does not
// define any auth or membership logic.
export type { WorkspaceContext } from "../../tenant";

export type ToolResult<T = unknown> =
  | { success: true; data: T; requiresApproval?: boolean }
  | {
      success: false;
      error: { code: string; message: string };
      requiresApproval?: boolean;
    };

/** Typed error thrown inside handlers; mapped to a safe result by executeTool. */
export class ToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export interface ToolDefinition<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = unknown,
> {
  /** Stable dotted name, e.g. "discovery.search". Unique across the registry. */
  name: string;
  /** Human-readable description for the future planner. */
  description: string;
  /** Zod schema validating raw input before the handler runs. */
  inputSchema: TInput;
  /**
   * True when the tool's effect is externally visible (e.g. outreach).
   * Phase 2 semantics: the future Agent Mind must obtain human approval
   * before the visible action happens. executeTool surfaces this flag on
   * the result; it does not silently execute-then-ask.
   */
  requiresApproval: boolean;
  /**
   * Server-side handler. Receives the authenticated workspace context and
   * the validated input (the schema's output type — defaults applied).
   * Must scope every read/write to ctx.organization.id.
   */
  handler: (ctx: WorkspaceContext, input: z.infer<TInput>) => Promise<TOutput>;
}

type AnyTool = ToolDefinition<z.ZodTypeAny, unknown>;

const tools = new Map<string, AnyTool>();

const TOOL_NAME_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/**
 * Register a tool. Called by server code at startup (lib/agent/tools/index.ts).
 * Throws on duplicate or malformed names — fail fast, never silently replace.
 */
export function registerTool<TInput extends z.ZodTypeAny, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
): void {
  if (!TOOL_NAME_RE.test(definition.name)) {
    throw new ToolError(
      "INVALID_TOOL_NAME",
      `Tool name "${definition.name}" must be dotted camelCase starting lowercase, e.g. "discovery.search" or "crm.createLead".`,
    );
  }
  if (tools.has(definition.name)) {
    throw new ToolError(
      "DUPLICATE_TOOL",
      `Tool "${definition.name}" is already registered.`,
    );
  }
  tools.set(definition.name, definition as unknown as AnyTool);
}

/** Look up a registered tool. Returns undefined for unknown names. */
export function getTool(name: string): AnyTool | undefined {
  return tools.get(name);
}

/** Names of all registered tools, in registration order. */
export function listTools(): string[] {
  return [...tools.keys()];
}

/** Metadata for all registered tools (no handlers — safe to inspect). */
export function listToolDefinitions(): Array<
  Pick<ToolDefinition, "name" | "description" | "requiresApproval">
> {
  return [...tools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    requiresApproval: t.requiresApproval,
  }));
}

/**
 * Execute a tool by name with server-side workspace context.
 *
 * - Unknown tool → { success: false, error: { code: "UNKNOWN_TOOL", ... } }
 * - Invalid input → { success: false, error: { code: "VALIDATION_ERROR", ... } }
 * - Handler ToolError → mapped code/message
 * - Unexpected errors → { code: "INTERNAL_TOOL_ERROR" } with a generic
 *   message (no stack traces, no internals leaked).
 */
export async function executeTool<T = unknown>(
  name: string,
  ctx: WorkspaceContext,
  rawInput: unknown,
): Promise<ToolResult<T>> {
  const tool = tools.get(name);
  if (!tool) {
    return {
      success: false,
      error: {
        code: "UNKNOWN_TOOL",
        message: `Unknown tool "${name}". Available tools: ${listTools().join(", ") || "(none)"}.`,
      },
    };
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: first
          ? `Invalid input for tool "${name}": ${first.path.join(".") || "(root)"} — ${first.message}`
          : `Invalid input for tool "${name}".`,
      },
    };
  }

  try {
    const data = (await tool.handler(ctx, parsed.data)) as T;
    return {
      success: true,
      data,
      ...(tool.requiresApproval ? { requiresApproval: true as const } : {}),
    };
  } catch (err) {
    if (err instanceof ToolError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }
    // Known domain errors carry a safe `code`; reuse it, but never leak
    // detail/stack. Everything else becomes a generic internal error.
    const code =
      err instanceof Error && "code" in err && typeof err.code === "string"
        ? (err.code as string)
        : "INTERNAL_TOOL_ERROR";
    const message =
      code === "INTERNAL_TOOL_ERROR"
        ? `Tool "${name}" failed unexpectedly.`
        : err instanceof Error
          ? err.message
          : `Tool "${name}" failed.`;
    return { success: false, error: { code, message } };
  }
}
