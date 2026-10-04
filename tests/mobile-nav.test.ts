/**
 * Mobile bottom-navigation contract.
 *
 * Guards the 6-item mobile nav: all five original items must be preserved,
 * and Outreach must link exactly to /outreach/instagram with the Send icon.
 * The active-state rule in AppShell is `pathname === item.href`, so the exact
 * href is what makes the active state work on /outreach/instagram.
 */
import { describe, it, expect } from "vitest";
import { MOBILE_NAV_ITEMS } from "@/components/app/mobile-nav";

describe("MOBILE_NAV_ITEMS", () => {
  it("contains exactly 6 items", () => {
    expect(MOBILE_NAV_ITEMS).toHaveLength(6);
  });

  it("preserves all five original items with their hrefs", () => {
    const hrefs = MOBILE_NAV_ITEMS.map((i) => i.href);
    for (const href of [
      "/dashboard",
      "/leads",
      "/discover",
      "/crm",
      "/intelligence",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("links Outreach to exactly /outreach/instagram with the Send icon", () => {
    const outreach = MOBILE_NAV_ITEMS.find((i) => i.label === "Outreach");
    expect(outreach).toBeDefined();
    expect(outreach!.href).toBe("/outreach/instagram");
    expect(outreach!.icon).toBe("Send");
  });

  it("has no duplicate hrefs", () => {
    const hrefs = MOBILE_NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("matches the active-state rule for /outreach/instagram", () => {
    // AppShell marks an item active when pathname === item.href.
    const pathname = "/outreach/instagram";
    const active = MOBILE_NAV_ITEMS.filter((i) => pathname === i.href);
    expect(active).toHaveLength(1);
    expect(active[0].label).toBe("Outreach");
  });
});
