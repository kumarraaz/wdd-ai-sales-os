import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it("falls back when missing or empty", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it("keeps same-origin paths, including query and hash", () => {
    expect(safeNextPath("/leads")).toBe("/leads");
    expect(safeNextPath("/leads/abc?tab=notes#top")).toBe("/leads/abc?tab=notes#top");
    expect(safeNextPath("/crm", "/home")).toBe("/crm");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("http://evil.example/x")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("///evil.example")).toBe("/dashboard");
  });

  it("rejects backslash and control-character tricks", () => {
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\t/evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\n/evil.example")).toBe("/dashboard");
    expect(safeNextPath("/ok\u0000")).toBe("/dashboard");
  });

  it("rejects non-path schemes and relative paths", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
    expect(safeNextPath("data:text/html,x")).toBe("/dashboard");
    expect(safeNextPath("leads")).toBe("/dashboard");
  });

  it("rejects oversized values and honours a custom fallback", () => {
    expect(safeNextPath("/" + "a".repeat(600))).toBe("/dashboard");
    expect(safeNextPath("//evil.example", "/home")).toBe("/home");
  });

  it("does not treat percent-encoded slashes as an origin change", () => {
    expect(safeNextPath("/%2F/evil.example")).toBe("/%2F/evil.example");
  });
});
