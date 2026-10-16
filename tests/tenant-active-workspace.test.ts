/**
 * requireWorkspace — which workspace a request resolves to.
 * Auth and the database are stubbed; the selection logic under test is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { memberships } = vi.hoisted(() => ({
  memberships: [
    { id: "m1", organizationId: "org-old", role: "VIEWER", organization: { id: "org-old", name: "Old", slug: "old" } },
    { id: "m2", organizationId: "org-new", role: "OWNER", organization: { id: "org-new", name: "New", slug: "new" } },
  ],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "u1", email: "u@example.com", name: "U" } }) } },
}));
vi.mock("../lib/db", () => ({
  db: { membership: { findMany: vi.fn(async () => memberships) } },
}));

import { AuthError, requireWorkspace } from "../lib/tenant";

describe("requireWorkspace — active workspace selection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to the oldest membership", async () => {
    const ctx = await requireWorkspace();
    expect(ctx.organization.id).toBe("org-old");
  });

  it("honours the switcher cookie when it names one of the user's workspaces", async () => {
    const ctx = await requireWorkspace(null, "VIEWER", "org-new");
    expect(ctx.organization.id).toBe("org-new");
    expect(ctx.membership.role).toBe("OWNER");
  });

  it("ignores a stale or foreign cookie instead of locking the user out", async () => {
    const ctx = await requireWorkspace(null, "VIEWER", "org-somebody-else");
    expect(ctx.organization.id).toBe("org-old");
  });

  it("an explicit org wins over the cookie", async () => {
    const ctx = await requireWorkspace("org-old", "VIEWER", "org-new");
    expect(ctx.organization.id).toBe("org-old");
  });

  it("still rejects an explicit org the user does not belong to (IDOR guard unchanged)", async () => {
    await expect(requireWorkspace("org-somebody-else", "VIEWER", "org-new")).rejects.toMatchObject({
      message: "WORKSPACE_ACCESS_DENIED",
      status: 403,
    });
    await expect(requireWorkspace("org-somebody-else")).rejects.toBeInstanceOf(AuthError);
  });

  it("checks the role against the workspace actually selected", async () => {
    await expect(requireWorkspace(null, "ADMIN", "org-old")).rejects.toMatchObject({ message: "INSUFFICIENT_ROLE" });
    const ctx = await requireWorkspace(null, "ADMIN", "org-new");
    expect(ctx.organization.id).toBe("org-new");
  });
});
