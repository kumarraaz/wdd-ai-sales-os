/**
 * Navigation contract. Route groups like (app) add no URL segment, so a link to
 * "/app/leads" is a 404. This test makes dead nav links impossible: every item
 * must resolve to a real page.tsx under app/(app).
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, NAV_SECTIONS, breadcrumbsFor, findNavItem, isNavActive } from "@/components/app/nav";
import { MOBILE_NAV_ITEMS } from "@/components/app/mobile-nav";

const APP_DIR = path.resolve(__dirname, "../app/(app)");

function pageExists(href: string): boolean {
  return existsSync(path.join(APP_DIR, ...href.split("/").filter(Boolean), "page.tsx"));
}

describe("NAV_ITEMS", () => {
  it("has no duplicate hrefs and none use the non-existent /app prefix", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) {
      expect(h.startsWith("/")).toBe(true);
      expect(h.startsWith("/app/")).toBe(false);
    }
  });

  it("links every item to a real page (no dead links)", () => {
    const dead = NAV_ITEMS.filter((i) => !pageExists(i.href)).map((i) => i.href);
    expect(dead).toEqual([]);
  });

  it("covers every mobile bottom-nav destination", () => {
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    for (const m of MOBILE_NAV_ITEMS) expect(hrefs.has(m.href)).toBe(true);
  });

  it("is organised into sections that each contain items", () => {
    expect(NAV_SECTIONS.length).toBeGreaterThanOrEqual(2);
    for (const s of NAV_SECTIONS) expect(s.items.length).toBeGreaterThan(0);
  });
});

describe("active matching and breadcrumbs", () => {
  it("treats nested routes as active under their section", () => {
    expect(isNavActive("/leads/abc123", "/leads")).toBe(true);
    expect(isNavActive("/discover/history", "/discover")).toBe(true);
    expect(isNavActive("/leadsX", "/leads")).toBe(false);
  });

  it("picks the most specific item", () => {
    expect(findNavItem("/outreach/instagram")?.label).toBe("Outreach studio");
    expect(findNavItem("/leads/abc")?.href).toBe("/leads");
    expect(findNavItem("/nope")).toBeNull();
  });

  it("builds readable breadcrumbs", () => {
    expect(breadcrumbsFor("/dashboard")).toEqual(["Workspace", "Overview"]);
    expect(breadcrumbsFor("/leads/xyz")).toEqual(["Workspace", "Leads", "Lead detail"]);
    expect(breadcrumbsFor("/discover/history")).toEqual(["Workspace", "Lead discovery", "History"]);
    expect(breadcrumbsFor("/unknown")).toEqual(["Workspace"]);
  });
});

describe("route coverage", () => {
  const folders = readdirSync(APP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it("has a page behind every sidebar item and a sidebar item for every top-level app route", () => {
    const navRoots = new Set(NAV_ITEMS.map((i) => i.href.split("/")[1]));
    const orphans = folders.filter((f) => !navRoots.has(f));
    expect(orphans).toEqual([]);
  });

  it("is covered by the middleware login gate (no route silently skips the redirect)", async () => {
    const { config } = await import("../middleware");
    const covered = new Set(config.matcher.map((m: string) => m.split("/")[1]));
    const missing = folders.filter((f) => !covered.has(f));
    expect(missing).toEqual([]);
  });
});
