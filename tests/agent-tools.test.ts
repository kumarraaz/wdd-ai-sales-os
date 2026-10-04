/**
 * Agent Tool Registry tests (Phase 2).
 *
 * Covers: registration, duplicates, unknown tools, validation, execution,
 * org-context propagation, tenant isolation, approval metadata,
 * draft-only outreach, SSRF-safe research delegation, and provider-backed
 * discovery. All external/provider operations are mocked — no live
 * Google/OSM/Gemini/website calls.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Hoisted mocks ──────────────────────────────────────────────────────
const {
  mockSearch,
  mockProvider,
  mockGetDiscoveryProvider,
  mockListDiscoveryProviders,
  mockImportDiscoveredCompanies,
  mockRunWebsiteInspection,
  mockGenerateLeadIntelligence,
  mockCreateLead,
  mockGetLead,
  mockIsOrgMember,
  mockTaskCreate,
  mockFollowUpCreate,
  mockActivityCreate,
  mockMessageCreate,
} = vi.hoisted(() => {
  const mockSearch = vi.fn();
  const mockProvider = {
    id: "test-provider",
    label: "Test Provider",
    sourceType: "DIRECTORY",
    searchable: true,
    isConfigured: () => true,
    setupInstructions: () => [],
    search: mockSearch,
  };
  return {
    mockSearch,
    mockProvider,
    mockGetDiscoveryProvider: vi.fn(
      (id: string) => (id === "test-provider" ? mockProvider : undefined),
    ),
    mockListDiscoveryProviders: vi.fn(() => [mockProvider]),
    mockImportDiscoveredCompanies: vi.fn(async () => ({
      imported: [],
      alreadyExists: [],
      possibleDuplicates: [],
      skipped: [],
      failed: [],
    })),
    mockRunWebsiteInspection: vi.fn(),
    mockGenerateLeadIntelligence: vi.fn(),
    mockCreateLead: vi.fn(),
    mockGetLead: vi.fn(),
    mockIsOrgMember: vi.fn(async () => true),
    mockTaskCreate: vi.fn(async (args: unknown) => ({ id: "task-1", ...(args as object) })),
    mockFollowUpCreate: vi.fn(async (args: unknown) => ({ id: "fu-1", ...(args as object) })),
    mockActivityCreate: vi.fn(async (args: unknown) => ({ id: "act-1", ...(args as object) })),
    mockMessageCreate: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "msg-1",
      ...args.data,
    })),
  };
});

vi.mock("../lib/discovery/registry", () => ({
  getDiscoveryProvider: mockGetDiscoveryProvider,
  listDiscoveryProviders: mockListDiscoveryProviders,
}));

vi.mock("../lib/discovery/import", () => ({
  importDiscoveredCompanies: mockImportDiscoveredCompanies,
}));

vi.mock("../lib/intelligence/inspect", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/intelligence/inspect")>();
  return { ...actual, runWebsiteInspection: mockRunWebsiteInspection };
});

vi.mock("../lib/intelligence/generate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/intelligence/generate")>();
  return { ...actual, generateLeadIntelligence: mockGenerateLeadIntelligence };
});

vi.mock("../lib/leads", () => ({
  createLead: mockCreateLead,
  getLead: mockGetLead,
  isOrgMember: mockIsOrgMember,
}));

vi.mock("../lib/db", () => ({
  db: {
    task: { create: mockTaskCreate },
    followUp: { create: mockFollowUpCreate },
    leadActivity: { create: mockActivityCreate },
    message: { create: mockMessageCreate },
  },
}));

// ── Imports under test (after mocks) ─────────────────────────────────────
import {
  executeTool,
  getTool,
  listTools,
  listToolDefinitions,
  registerTool,
  ToolError,
} from "../lib/agent/tools/registry";
import "../lib/agent/tools/index"; // central registration
import type { WorkspaceContext } from "../lib/agent/tools/registry";
import { z } from "zod";

const ctx: WorkspaceContext = {
  user: { id: "user-1", email: "u@example.com", name: "Test User" },
  organization: { id: "org-A", name: "Org A", slug: "org-a" },
  membership: { id: "mem-1", role: "ADMIN" },
};

const EXPECTED_TOOLS = [
  "discovery.search",
  "discovery.import",
  "research.website",
  "research.lead",
  "crm.createLead",
  "crm.createTask",
  "crm.createFollowUp",
  "crm.logActivity",
  "outreach.createDraft",
];

afterEach(() => {
  vi.clearAllMocks();
  mockGetDiscoveryProvider.mockImplementation((id: string) =>
    id === "test-provider" ? mockProvider : undefined,
  );
  mockListDiscoveryProviders.mockImplementation(() => [mockProvider]);
  mockIsOrgMember.mockImplementation(async () => true);
});

describe("tool registry", () => {
  it("registers all Phase 2 tools with stable names", () => {
    const names = listTools();
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
    expect(getTool("discovery.search")).toBeDefined();
  });

  it("rejects duplicate tool registration", () => {
    registerTool({
      name: "test.dup",
      description: "dup",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: async () => ({}),
    });
    let caught: unknown = null;
    try {
      registerTool({
        name: "test.dup",
        description: "dup again",
        inputSchema: z.object({}),
        requiresApproval: false,
        handler: async () => ({}),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect((caught as ToolError).code).toBe("DUPLICATE_TOOL");
  });

  it("rejects malformed tool names", () => {
    let caught: unknown = null;
    try {
      registerTool({
        name: "BadName",
        description: "bad",
        inputSchema: z.object({}),
        requiresApproval: false,
        handler: async () => ({}),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect((caught as ToolError).code).toBe("INVALID_TOOL_NAME");
  });

  it("unknown tools fail safely with a typed error", async () => {
    const result = await executeTool("nope.nope", ctx, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN_TOOL");
      expect(result.error.message).toContain("nope.nope");
    }
  });

  it("invalid input fails safely with VALIDATION_ERROR", async () => {
    const result = await executeTool("discovery.search", ctx, { keyword: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("maps unexpected handler errors to a generic code (no leak)", async () => {
    registerTool({
      name: "test.boom",
      description: "boom",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: async () => {
        throw new Error("super secret stack detail");
      },
    });
    const result = await executeTool("test.boom", ctx, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INTERNAL_TOOL_ERROR");
      expect(result.error.message).not.toContain("super secret");
    }
  });

  it("maps ToolError codes through", async () => {
    registerTool({
      name: "test.typed",
      description: "typed",
      inputSchema: z.object({}),
      requiresApproval: false,
      handler: async () => {
        throw new ToolError("CUSTOM_CODE", "custom message");
      },
    });
    const result = await executeTool("test.typed", ctx, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CUSTOM_CODE");
      expect(result.error.message).toBe("custom message");
    }
  });
});

describe("approval metadata", () => {
  it("marks only outreach.createDraft as requiring approval", () => {
    const defs = listToolDefinitions();
    for (const d of defs) {
      if (d.name === "outreach.createDraft") {
        expect(d.requiresApproval).toBe(true);
      } else if (EXPECTED_TOOLS.includes(d.name)) {
        expect(d.requiresApproval).toBe(false);
      }
    }
  });

  it("executeTool surfaces requiresApproval on the result", async () => {
    mockMessageCreate.mockImplementationOnce(async (args: { data: Record<string, unknown> }) => ({
      id: "msg-1",
      ...args.data,
    }));
    const result = await executeTool("outreach.createDraft", ctx, {
      channel: "EMAIL",
      body: "hello",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.requiresApproval).toBe(true);
  });
});

describe("discovery tools", () => {
  it("discovery.search uses the existing provider registry", async () => {
    mockSearch.mockResolvedValueOnce({
      provider: "test-provider",
      companies: [
        {
          provider: "test-provider",
          providerId: "p1",
          name: "Acme Manufacturing",
          discoveredAt: new Date().toISOString(),
          provenance: "VERIFIED_DATA",
        },
      ],
      searchedAt: new Date().toISOString(),
    });
    const result = await executeTool("discovery.search", ctx, {
      keyword: "manufacturers",
      city: "Delhi",
      provider: "test-provider",
    });
    expect(mockGetDiscoveryProvider).toHaveBeenCalledWith("test-provider");
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as {
        provider: string;
        companies: { provenance: string }[];
      };
      expect(data.provider).toBe("test-provider");
      // Provenance preserved, nothing fabricated.
      expect(data.companies[0].provenance).toBe("VERIFIED_DATA");
    }
  });

  it("discovery.search falls back to the first searchable, configured provider", async () => {
    mockSearch.mockResolvedValueOnce({
      provider: "test-provider",
      companies: [],
      searchedAt: new Date().toISOString(),
    });
    const result = await executeTool("discovery.search", ctx, {
      keyword: "exporters",
    });
    expect(mockListDiscoveryProviders).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("discovery.search rejects unknown providers cleanly", async () => {
    const result = await executeTool("discovery.search", ctx, {
      keyword: "x",
      provider: "nope",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("UNKNOWN_PROVIDER");
  });

  it("discovery.import wraps the existing import with server-side org/actor", async () => {
    const companies = [
      {
        provider: "test-provider",
        providerId: "p1",
        name: "Acme",
        discoveredAt: new Date().toISOString(),
        provenance: "VERIFIED_DATA" as const,
      },
    ];
    const result = await executeTool("discovery.import", ctx, {
      provider: "test-provider",
      companies,
      searchQuery: "manufacturers Delhi",
    });
    expect(result.success).toBe(true);
    expect(mockImportDiscoveredCompanies).toHaveBeenCalledWith(
      "org-A", // organizationId from context, never from input
      "user-1", // actorId from context
      mockProvider,
      companies,
      { searchQuery: "manufacturers Delhi" },
    );
  });
});

describe("research tools", () => {
  it("research.website delegates to the SSRF-safe inspection path", async () => {
    mockRunWebsiteInspection.mockResolvedValueOnce({
      requestedUrl: "https://example.com",
      title: "Example",
    });
    const result = await executeTool("research.website", ctx, {
      url: "https://example.com",
    });
    expect(result.success).toBe(true);
    // The tool performs no fetch of its own — the existing safe path does.
    expect(mockRunWebsiteInspection).toHaveBeenCalledTimes(1);
    expect(mockRunWebsiteInspection).toHaveBeenCalledWith("https://example.com");
  });

  it("research.website rejects non-http(s) URLs", async () => {
    const result = await executeTool("research.website", ctx, {
      url: "file:///etc/passwd",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(mockRunWebsiteInspection).not.toHaveBeenCalled();
  });

  it("research.lead wires org-scoped lead + inspection + intelligence + deterministic score", async () => {
    mockGetLead.mockResolvedValueOnce({
      id: "lead-1",
      fullName: "Jane Prospect",
      website: "https://acme.example.com",
      industry: "Manufacturing",
      city: "Delhi",
      country: "India",
      company: null,
    });
    mockRunWebsiteInspection.mockResolvedValueOnce({
      requestedUrl: "https://acme.example.com",
      finalUrl: "https://acme.example.com/",
      title: "Acme",
    });
    mockGenerateLeadIntelligence.mockResolvedValueOnce({
      output: { confidence: "MEDIUM" },
      warnings: [],
    });
    const result = await executeTool("research.lead", ctx, { leadId: "c".repeat(24) });
    expect(result.success).toBe(true);
    expect(mockGetLead).toHaveBeenCalledWith("org-A", "c".repeat(24));
    if (result.success) {
      const data = result.data as {
        intelligence: unknown;
        score: { score: number; scoringVersion: string };
        websiteInspected: boolean;
      };
      expect(data.intelligence).toBeDefined();
      // Real deterministic scorer ran (not mocked).
      expect(typeof data.score.score).toBe("number");
      expect(data.websiteInspected).toBe(true);
    }
  });

  it("research.lead rejects leads outside the organization", async () => {
    mockGetLead.mockResolvedValueOnce(null);
    const result = await executeTool("research.lead", ctx, { leadId: "c".repeat(24) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("LEAD_NOT_FOUND");
    expect(mockRunWebsiteInspection).not.toHaveBeenCalled();
    expect(mockGenerateLeadIntelligence).not.toHaveBeenCalled();
  });
});

describe("crm tools", () => {
  it("crm.createLead ignores organizationId smuggled in input", async () => {
    mockCreateLead.mockResolvedValueOnce({ lead: { id: "lead-9" }, duplicate: null });
    const result = await executeTool("crm.createLead", ctx, {
      fullName: "Evil Org",
      organizationId: "org-evil",
    } as unknown as Record<string, unknown>);
    expect(result.success).toBe(true);
    expect(mockCreateLead).toHaveBeenCalledWith(
      "org-A", // context wins, always
      "user-1",
      expect.not.objectContaining({ organizationId: "org-evil" }),
      { dataLabel: "USER_PROVIDED" },
    );
  });

  it("crm.createTask scopes writes to the context org and validates assignee", async () => {
    mockGetLead.mockResolvedValueOnce({ id: "lead-1" });
    const result = await executeTool("crm.createTask", ctx, {
      title: "Call back",
      leadId: "c".repeat(24),
      assignedToId: "c" + "d".repeat(24),
    });
    expect(result.success).toBe(true);
    expect(mockGetLead).toHaveBeenCalledWith("org-A", "c".repeat(24));
    expect(mockIsOrgMember).toHaveBeenCalledWith("org-A", "c" + "d".repeat(24));
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-A",
          title: "Call back",
          createdById: "user-1",
        }),
      }),
    );
  });

  it("crm.createTask rejects assignees outside the organization", async () => {
    mockIsOrgMember.mockResolvedValueOnce(false);
    const result = await executeTool("crm.createTask", ctx, {
      title: "x",
      assignedToId: "c" + "d".repeat(24),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("INVALID_ASSIGNEE");
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("crm.createTask is strict: smuggled organizationId is rejected", async () => {
    const result = await executeTool("crm.createTask", ctx, {
      title: "x",
      organizationId: "org-evil",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("crm.createFollowUp requires a future date and an org-owned lead", async () => {
    mockGetLead.mockResolvedValueOnce({ id: "lead-1" });
    const future = new Date(Date.now() + 86400000).toISOString();
    const result = await executeTool("crm.createFollowUp", ctx, {
      leadId: "c".repeat(24),
      channel: "EMAIL",
      scheduledAt: future,
    });
    expect(result.success).toBe(true);
    expect(mockFollowUpCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-A" }),
      }),
    );

    const past = await executeTool("crm.createFollowUp", ctx, {
      leadId: "c".repeat(24),
      channel: "EMAIL",
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(past.success).toBe(false);
    if (!past.success) expect(past.error.code).toBe("VALIDATION_ERROR");
  });

  it("crm.logActivity appends org-scoped activity with the user as actor", async () => {
    mockGetLead.mockResolvedValueOnce({ id: "lead-1" });
    const result = await executeTool("crm.logActivity", ctx, {
      leadId: "c".repeat(24),
      type: "note",
      title: "Called",
    });
    expect(result.success).toBe(true);
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-A",
          actorId: "user-1",
          type: "note",
        }),
      }),
    );
  });
});

describe("outreach draft tool", () => {
  it("creates a DRAFT that requires approval — and nothing else", async () => {
    const result = await executeTool("outreach.createDraft", ctx, {
      channel: "EMAIL",
      subject: "Intro",
      body: "Hello, we build websites.",
    });
    expect(result.success).toBe(true);
    expect(mockMessageCreate).toHaveBeenCalledTimes(1);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-A",
          channel: "EMAIL",
          direction: "OUTBOUND",
          status: "DRAFT",
          approvalMode: "APPROVAL_REQUIRED",
          body: "Hello, we build websites.",
        }),
      }),
    );
    if (result.success) {
      expect((result.data as { status: string }).status).toBe("DRAFT");
      expect(result.requiresApproval).toBe(true);
    }
  });

  it("attaches drafts only to org-owned leads", async () => {
    mockGetLead.mockResolvedValueOnce(null);
    const result = await executeTool("outreach.createDraft", ctx, {
      leadId: "c".repeat(24),
      channel: "WHATSAPP",
      body: "hi",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("LEAD_NOT_FOUND");
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it("contains no sending code path (source guardrail)", () => {
    const src = readFileSync(
      join(__dirname, "..", "lib", "agent", "tools", "outreach.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/status:\s*["']SENT["']/);
    expect(src).not.toMatch(/sendEmail|deliverMessage|\.send\(/);
    expect(src).toMatch(/DRAFT/);
  });
});
