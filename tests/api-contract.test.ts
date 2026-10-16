/**
 * UI ↔ API contract: every URL the client code fetches must be served by a route file.
 * (The notification bell called /api/notifications/:id/read for months while the route file
 * lived at /api/notifications/:id, so "mark as read" silently 404ed.)
 *
 * Static check: it reads fetch("/api/…") and fetch(`${apiBase}/…`) call sites, normalises
 * template placeholders to path parameters and looks for a matching route.ts file somewhere under app/api.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Route files → URL patterns ("/api/leads/[id]" → /^\/api\/leads\/[^/]+$/)
const routePatterns = walk(path.join(ROOT, "app/api"))
  .filter((f) => f.endsWith(`${path.sep}route.ts`))
  .map((f) => {
    const url = "/" + path.relative(path.join(ROOT, "app"), path.dirname(f)).split(path.sep).join("/");
    const re = new RegExp("^" + url.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+") + "$");
    return { url, re };
  });

const sources = [...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "app")).filter((f) => !f.includes(`${path.sep}api${path.sep}`))].filter(
  (f) => /\.(tsx|ts)$/.test(f),
);

// fetch( "/api/x" | `/api/x/${id}/y?z` | `${apiBase}/x` )
const FETCH_RE = /fetch\(\s*(["'`])((?:\/api|\$\{apiBase\})[^"'`]*?)\1/g;

function calls(): Array<{ file: string; raw: string; url: string }> {
  const found: Array<{ file: string; raw: string; url: string }> = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(FETCH_RE)) {
      const raw = m[2];
      const url = raw
        .replace(/\$\{apiBase\}/g, "/api")
        .replace(/\?.*$/, "")
        .replace(/\$\{[^}]+\}/g, "x")
        .replace(/\/+$/, "");
      found.push({ file: path.relative(ROOT, file), raw, url });
    }
  }
  return found;
}

describe("client fetch() calls are served by real API routes", () => {
  const all = calls();

  it("finds the call sites (guards the regex itself)", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  // Call sites whose last segment is a variable: each concrete value must have its own route.
  const EXPANDED: Record<string, string[]> = {
    "/api/agent/approvals/${id}/${action}": ["approve", "reject", "cancel"].map((a) => `/api/agent/approvals/x/${a}`),
  };

  it("matches every URL to a route file", () => {
    const unserved: string[] = [];
    for (const c of all) {
      const concrete = EXPANDED[c.raw] ?? [c.url];
      for (const url of concrete) {
        if (!routePatterns.some((r) => r.re.test(url))) unserved.push(`${c.file}: ${c.raw} → ${url}`);
      }
    }
    expect(unserved).toEqual([]);
  });

  it("serves the notification mark-as-read endpoint the bell and banner call", () => {
    expect(routePatterns.some((r) => r.re.test("/api/notifications/abc/read"))).toBe(true);
  });
});
