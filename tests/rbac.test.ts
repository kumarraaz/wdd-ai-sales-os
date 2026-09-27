import { describe, it, expect } from "vitest";
import { roleAtLeast } from "../lib/tenant";

describe("roleAtLeast — RBAC ordering", () => {
  it("ranks roles correctly", () => {
    expect(roleAtLeast("OWNER", "VIEWER")).toBe(true);
    expect(roleAtLeast("VIEWER", "OWNER")).toBe(false);
    expect(roleAtLeast("SALES_MANAGER", "SALES_EXECUTIVE")).toBe(true);
    expect(roleAtLeast("SALES_EXECUTIVE", "SALES_MANAGER")).toBe(false);
    expect(roleAtLeast("ADMIN", "ADMIN")).toBe(true);
  });
});
