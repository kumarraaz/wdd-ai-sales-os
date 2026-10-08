/**
 * resolveSiteUrl regression test (§20).
 *
 * A set-but-empty NEXT_PUBLIC_SITE_URL must fall back to the default —
 * the old `??` passed "" through and `new URL("")` crashed page prerender.
 */
import { describe, it, expect } from "vitest";
import { resolveSiteUrl } from "../lib/site-url";

const FALLBACK = "https://wdd-ai-sales-os.vercel.app";

describe("resolveSiteUrl", () => {
  it("falls back when the variable is unset", () => {
    expect(resolveSiteUrl({})).toBe(FALLBACK);
  });

  it("falls back when the variable is set-but-empty", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "" })).toBe(FALLBACK);
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "   " })).toBe(FALLBACK);
  });

  it("uses a real configured value", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com" })).toBe(
      "https://example.com",
    );
  });

  it("trims whitespace", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "  https://example.com  " })).toBe(
      "https://example.com",
    );
  });
});
