/**
 * Regression: the registry must be populated in the running app.
 *
 * The code that *uses* the tool registry (approval dispatcher, workflow executor, AI sales mind)
 * only imports registry.ts, and nothing in the app imported tools/index.ts — so every lookup saw an
 * empty registry and approving an action failed with "Tool … is not registered". No mocks here:
 * this loads the real modules exactly as a route would.
 */
import { describe, expect, it } from "vitest";
import { APPROVAL_ACTION_TOOL } from "../lib/agent/approvals/types";
import { getTool, listTools } from "../lib/agent/tools/registry";

describe("agent tool registration", () => {
  it("is empty until a consumer is loaded (guards the test itself)", () => {
    expect(listTools()).toEqual([]);
  });

  it("registers every approval-allowlisted tool as soon as the dispatcher is imported", async () => {
    await import("../lib/agent/approvals/dispatcher");
    for (const tool of Object.values(APPROVAL_ACTION_TOOL)) {
      expect(getTool(tool), `${tool} should be registered`).toBeDefined();
    }
  });

  it("registers the full tool set once, even when several consumers are imported", async () => {
    await import("../lib/agent/workflow/executor");
    await import("../lib/agent/mind");
    const names = listTools();
    expect(new Set(names).size).toBe(names.length);
    for (const expected of ["discovery.search", "research.website", "crm.createTask", "crm.createFollowUp", "outreach.createDraft"]) {
      expect(names).toContain(expected);
    }
  });

  it("never lets the approval path pick a tool that sends anything", async () => {
    await import("../lib/agent/approvals/dispatcher");
    for (const tool of Object.values(APPROVAL_ACTION_TOOL)) {
      expect(tool).not.toMatch(/send/i);
    }
  });
});
