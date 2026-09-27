import { describe, it, expect } from "vitest";
import { createLeadSchema, updateLeadSchema, listLeadsQuerySchema } from "../lib/validators";
import { checkRateLimit } from "../lib/rate-limit";

describe("lead validators", () => {
  it("accepts a minimal valid lead", () => {
    const r = createLeadSchema.safeParse({ fullName: "Test Person" });
    expect(r.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const r = createLeadSchema.safeParse({ email: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown status", () => {
    const r = createLeadSchema.safeParse({ fullName: "X", status: "HACKED" });
    expect(r.success).toBe(false);
  });

  it("update schema allows partial input", () => {
    const r = updateLeadSchema.safeParse({ leadScore: 80 });
    expect(r.success).toBe(true);
  });

  it("rejects out-of-range score", () => {
    const r = updateLeadSchema.safeParse({ leadScore: 101 });
    expect(r.success).toBe(false);
  });

  it("list query applies defaults and caps pageSize", () => {
    const ok = listLeadsQuerySchema.safeParse({});
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.page).toBe(1);
      expect(ok.data.pageSize).toBe(25);
    }
    expect(listLeadsQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });
});

describe("rate limiter (memory fallback)", () => {
  it("allows up to the limit then blocks", async () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(key, { limit: 5, windowMs: 60_000 });
      expect(r.success).toBe(true);
    }
    const blocked = await checkRateLimit(key, { limit: 5, windowMs: 60_000 });
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
