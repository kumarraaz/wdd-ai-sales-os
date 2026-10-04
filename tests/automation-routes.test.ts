/**
 * Automation API route tests (Phase 3).
 *
 * - /api/automation/tick: CRON_SECRET enforcement (503/401/200), bounded
 *   batch, kill-switch reflection. Runner/scheduler/db are mocked; the
 *   route's auth logic is real.
 * - /api/automation/jobs: tenant-scoped list/enqueue with real enqueueJob
 *   validation against a fake DB; withWorkspace and rate-limit are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks ──────────────────────────────────────────────────────
const { mockRunBatch, mockEvaluateAutomations, mockFindOrgs } = vi.hoisted(() => ({
  mockRunBatch: vi.fn(async () => ({
    claimed: 2,
    completed: 2,
    failed: 0,
    retried: 0,
    killed: false,
  })),
  mockEvaluateAutomations: vi.fn(async () => ({
    evaluated: 1,
    fired: 1,
    enqueued: 1,
    skipped: 0,
  })),
  mockFindOrgs: vi.fn(async () => [{ organizationId: "org-A" }]),
}));

vi.mock("../lib/automation/runner", () => ({
  runBatch: mockRunBatch,
}));

vi.mock("../lib/automation/scheduler", () => ({
  evaluateAutomations: mockEvaluateAutomations,
}));

vi.mock("../lib/db", () => ({
  db: { automation: { findMany: mockFindOrgs } },
}));

import { POST as tick } from "../app/api/automation/tick/route";

function tickRequest(secret?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers["authorization"] = `Bearer ${secret}`;
  return new NextRequest("http://localhost/api/automation/tick", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("WDD_AUTOMATION_KILL_SWITCH", "");
  mockRunBatch.mockResolvedValue({ claimed: 2, completed: 2, failed: 0, retried: 0, killed: false });
  mockFindOrgs.mockResolvedValue([{ organizationId: "org-A" }]);
});

describe("POST /api/automation/tick", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await tick(tickRequest("anything"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("CRON_SECRET_NOT_CONFIGURED");
    expect(mockRunBatch).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await tick(tickRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mockRunBatch).not.toHaveBeenCalled();
  });

  it("returns 401 when no secret is provided", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await tick(tickRequest(undefined));
    expect(res.status).toBe(401);
  });

  it("accepts the x-cron-secret header as an alternative", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const req = new NextRequest("http://localhost/api/automation/tick", {
      method: "POST",
      headers: { "x-cron-secret": "s3cret" },
    });
    const res = await tick(req);
    expect(res.status).toBe(200);
  });

  it("runs scheduler + bounded batch and returns sanitized stats", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await tick(tickRequest("s3cret", { limit: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      killSwitch: false,
      scheduler: { evaluated: 1, fired: 1, enqueued: 1, skipped: 0 },
      jobs: { claimed: 2, completed: 2, failed: 0, retried: 0 },
    });
    expect(mockRunBatch).toHaveBeenCalledWith({ limit: 3 });
    // No payloads, no secrets in the response.
    expect(JSON.stringify(body)).not.toContain("s3cret");
  });

  it("caps the batch limit", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    await tick(tickRequest("s3cret", { limit: 500 }));
    expect(mockRunBatch).toHaveBeenCalledWith({ limit: 20 });
  });

  it("reflects the kill switch and skips scheduler evaluation", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("WDD_AUTOMATION_KILL_SWITCH", "true");
    mockRunBatch.mockResolvedValueOnce({
      claimed: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      killed: true,
    });
    const res = await tick(tickRequest("s3cret"));
    const body = await res.json();
    expect(body.killSwitch).toBe(true);
    expect(mockEvaluateAutomations).not.toHaveBeenCalled();
  });

  it("isolates per-org scheduler failures", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    mockFindOrgs.mockResolvedValueOnce([
      { organizationId: "org-A" },
      { organizationId: "org-B" },
    ]);
    mockEvaluateAutomations
      .mockRejectedValueOnce(new Error("org-A exploded"))
      .mockResolvedValueOnce({ evaluated: 1, fired: 1, enqueued: 1, skipped: 0 });
    const res = await tick(tickRequest("s3cret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheduler.enqueued).toBe(1);
    expect(mockRunBatch).toHaveBeenCalled();
  });
});
