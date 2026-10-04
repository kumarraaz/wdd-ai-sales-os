/**
 * POST /api/agent/run route tests (Phase 4).
 *
 * withWorkspace and rate-limit are stubbed; the real runAgentGoal runs
 * against mocked provider/tools/registry/db.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { fakeCtx } = vi.hoisted(() => ({
  fakeCtx: {
    user: { id: "user-1", email: "u@example.com", name: "U" },
    organization: { id: "org-A", name: "Org A", slug: "org-a" },
    membership: { id: "m1", role: "SALES_EXECUTIVE" as const },
  },
}));

vi.mock("../lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tenant")>();
  return {
    ...actual,
    withWorkspace: (handler: any, _opts: any) => async (req: any, routeParams: any) =>
      handler(req, fakeCtx, routeParams ?? { params: Promise.resolve({}) }),
  };
});

const { mockCheckRateLimit } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(async () => ({ success: true })),
}));

vi.mock("../lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  LIMITS: { ai: { limit: 30, windowMs: 60_000 } },
}));

const { scriptedResponses, mockGenerateJson, mockExecuteTool, auditCalls } = vi.hoisted(() => {
  const scriptedResponses: string[] = [];
  const auditCalls: any[] = [];
  const mockGenerateJson: any = vi.fn(async (): Promise<any> => {
    const next = scriptedResponses.shift();
    if (next === undefined) throw new Error("No scripted response left");
    return { text: next, model: "mock", usage: { inputTokens: 1, outputTokens: 1 } };
  });
  const mockExecuteTool: any = vi.fn(async (): Promise<any> => ({
    success: true,
    data: { ok: true },
  }));
  return { scriptedResponses, mockGenerateJson, mockExecuteTool, auditCalls };
});

const mockProviderInstance = {
  name: "mock",
  isConfigured: () => true,
  generateJson: mockGenerateJson,
  generateText: vi.fn(),
  supportsTools: () => false,
};

vi.mock("../lib/ai/registry", () => ({
  getAIProvider: () => mockProviderInstance,
  resolveAIProvider: () => mockProviderInstance,
}));

vi.mock("../lib/agent/tools/registry", () => ({
  getTool: (name: string) =>
    name === "discovery.search"
      ? {
          name,
          requiresApproval: false,
          inputSchema: {
            safeParse: (v: any) =>
              v && typeof v.keyword === "string"
                ? { success: true, data: v }
                : {
                    success: false,
                    error: { issues: [{ path: ["keyword"], message: "Required." }] },
                  },
          },
        }
      : undefined,
  listTools: () => ["discovery.search"],
  listToolDefinitions: () => [
    { name: "discovery.search", description: "Search prospects.", requiresApproval: false },
  ],
  executeTool: mockExecuteTool,
}));

vi.mock("../lib/automation/runner", () => ({
  enqueueJob: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  db: {
    auditLog: {
      create: vi.fn(async (args: any) => {
        auditCalls.push(args);
        return {};
      }),
    },
  },
}));

import { POST } from "../app/api/agent/run/route";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/agent/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  scriptedResponses.length = 0;
  auditCalls.length = 0;
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ success: true });
});

describe("POST /api/agent/run", () => {
  it("runs the agent and returns a sanitized result", async () => {
    scriptedResponses.push(
      JSON.stringify({
        goal: "Find manufacturers",
        steps: [{ tool: "discovery.search", input: { keyword: "m" }, reason: "x" }],
      }),
      JSON.stringify({ action: "execute_tool", tool: "discovery.search", input: { keyword: "m" }, reason: "x" }),
      JSON.stringify({ action: "complete", reason: "done" }),
    );
    const res = await POST(post({ goal: "Find manufacturers" }), {} as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.status).toBe("COMPLETED");
    expect(body.result.runId).toBeTruthy();
    expect(body.result.summary).toContain("Tool calls: 1");
    // No provider selection from the client; no secrets in the response.
    expect(JSON.stringify(body)).not.toContain("sk-");
  });

  it("rejects invalid input", async () => {
    const res = await POST(post({ goal: "" }), {} as any);
    expect(res.status).toBe(400);
    const res2 = await POST(post({ goal: "x", budget: { maxSteps: "lots" } }), {} as any);
    expect(res2.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ success: false });
    const res = await POST(post({ goal: "Find some" }), {} as any);
    expect(res.status).toBe(429);
  });

  it("clamps caller-supplied budgets server-side", async () => {
    scriptedResponses.push(
      JSON.stringify({
        goal: "g",
        steps: [{ tool: "discovery.search", input: { keyword: "m" }, reason: "x" }],
      }),
      JSON.stringify({ action: "complete", reason: "done" }),
    );
    const res = await POST(
      post({ goal: "Find some", budget: { maxSteps: 1_000_000 } }),
      {} as any,
    );
    const body = await res.json();
    expect(body.result.budgets.maxSteps).toBe(50);
  });
});
