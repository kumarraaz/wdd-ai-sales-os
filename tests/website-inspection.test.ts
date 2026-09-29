/**
 * Website inspection unit tests — no database required.
 *
 * Covers: SSRF blocking, safe-fetch behavior (local test server),
 * per-hop redirect validation, HTML parsing of all inspection items,
 * provenance labeling, input validation, demo mode, and rate limiting.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const v = jar.get(name);
      return v === undefined ? undefined : { value: v };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  })),
  headers: vi.fn(async () => new Headers()),
}));

import { assertSafeUrl, SafeUrlError } from "../lib/ssrf";
import {
  safeFetchHtml,
  safeFetchStatus,
  SafeFetchError,
} from "../lib/intelligence/safe-fetch";
import { inspectHtml } from "../lib/intelligence/inspect";
import { websiteInspectSchema } from "../lib/validators";
import { LIMITS } from "../lib/rate-limit";
import { DEMO_COOKIE_NAME, createDemoSession } from "../lib/demo";
import { getDemoWebsiteInspection } from "../lib/demo-data";
import { POST as demoInspect } from "../app/api/demo/intelligence/website-inspect/route";

beforeEach(() => {
  jar.clear();
  delete process.env.DEMO_MODE;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
describe("SSRF blocking (assertSafeUrl)", () => {
  const blocked = [
    "http://localhost/",
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://127.0.0.1:8080/path",
    "http://10.0.0.5/",
    "http://172.16.4.4/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://metadata.google.internal/",
    "ftp://example.com/file",
    "http://user:pass@example.com/",
    "javascript:alert(1)",
  ];

  it.each(blocked)("blocks %s", async (url) => {
    await expect(assertSafeUrl(url)).rejects.toBeInstanceOf(SafeUrlError);
  });

  it("allows a public IP literal without DNS", async () => {
    // 93.184.216.34 is a public address (not in any blocked range).
    const safe = await assertSafeUrl("http://93.184.216.34/");
    expect(safe).toBe("http://93.184.216.34/");
  });

  it("allowPrivate bypasses IP checks for tests only", async () => {
    const safe = await assertSafeUrl("http://127.0.0.1:9999/", { allowPrivate: true });
    expect(safe).toBe("http://127.0.0.1:9999/");
  });
});

// ---------------------------------------------------------------------------
// Local test server for safe-fetch behavior tests. allowPrivate is required
// because the server listens on loopback.
let server: http.Server;
let base: string;

const FULL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Acme Corp — Widgets</title>
<meta name="description" content="We make widgets.">
<meta name="robots" content="index, follow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://acme.example.com/">
<link rel="icon" href="/icon.png">
<meta property="og:title" content="Acme Corp">
<meta property="og:description" content="Widgets for everyone">
<meta property="og:image" content="https://acme.example.com/og.png">
<meta name="twitter:card" content="summary">
<meta name="generator" content="WordPress 6.5">
<script type="application/ld+json">{"@type":"Organization"}</script>
<script src="/wp-content/themes/x/app.js"></script>
<script>document.write("pwned")</script>
</head>
<body itemscope>
<h1>Welcome to Acme</h1>
<h1>Second H1</h1>
<h2>Products</h2>
<h2>About</h2>
<img src="/a.png" alt="A">
<img src="/b.png">
<img src="/c.png" alt="">
<a href="/about">About</a>
<a href="https://acme.example.com/contact">Contact</a>
<a href="https://external.example.org/">External</a>
<a href="mailto:sales@acme.example.com?subject=hi">Email</a>
<a href="tel:+15551234567">Call</a>
<a href="https://www.linkedin.com/company/acme">LinkedIn</a>
<a href="#top">Top</a>
<a href="javascript:void(0)">JS</a>
</body>
</html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(FULL_HTML);
    } else if (url === "/redir") {
      res.writeHead(302, { location: "/ok" });
      res.end();
    } else if (url === "/redir-ftp") {
      res.writeHead(302, { location: "ftp://example.com/x" });
      res.end();
    } else if (url === "/redir-loop") {
      res.writeHead(302, { location: "/redir-loop" });
      res.end();
    } else if (url === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(3 * 1024 * 1024));
    } else if (url === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html></html>");
      }, 500);
    } else if (url === "/binary") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } else if (url === "/notfound") {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><head><title>Missing</title></head></html>");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("safeFetchHtml (local server, allowPrivate)", () => {
  const priv = { allowPrivate: true };

  it("fetches an HTML page", async () => {
    const r = await safeFetchHtml(`${base}/ok`, priv);
    expect(r.httpStatus).toBe(200);
    expect(r.finalUrl).toBe(`${base}/ok`);
    expect(r.body).toContain("Acme Corp");
    expect(r.redirectChain).toHaveLength(0);
    expect(r.timingMs).toBeGreaterThanOrEqual(0);
  });

  it("follows redirects and records the chain", async () => {
    const r = await safeFetchHtml(`${base}/redir`, priv);
    expect(r.httpStatus).toBe(200);
    expect(r.finalUrl).toBe(`${base}/ok`);
    expect(r.redirectChain).toEqual([{ url: `${base}/redir`, status: 302 }]);
  });

  it("blocks unsafe redirect targets at every hop", async () => {
    // ftp:// is rejected by assertSafeUrl even with allowPrivate.
    await expect(safeFetchHtml(`${base}/redir-ftp`, priv)).rejects.toThrow();
  });

  it("stops after too many redirects", async () => {
    await expect(
      safeFetchHtml(`${base}/redir-loop`, { ...priv, maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
  });

  it("enforces the body size limit", async () => {
    await expect(
      safeFetchHtml(`${base}/big`, { ...priv, maxBodyBytes: 1024 }),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("enforces the request timeout", async () => {
    await expect(
      safeFetchHtml(`${base}/slow`, { ...priv, timeoutMs: 150 }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects non-HTML content", async () => {
    await expect(safeFetchHtml(`${base}/binary`, priv)).rejects.toMatchObject({
      code: "NON_HTML",
    });
  });

  it("returns non-2xx statuses as results (not throws)", async () => {
    const r = await safeFetchHtml(`${base}/notfound`, priv);
    expect(r.httpStatus).toBe(404);
  });

  it("safeFetchStatus probes availability", async () => {
    const ok = await safeFetchStatus(`${base}/ok`, priv);
    expect(ok.status).toBe(200);
    const missing = await safeFetchStatus(`${base}/does-not-exist`, priv);
    expect(missing.status).toBe(404);
  });

  it("safeFetchStatus surfaces safety blocks as errors", async () => {
    await expect(safeFetchStatus("http://169.254.169.254/")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("inspectHtml — all 28 items", () => {
  function makeFetch(body: string = FULL_HTML) {
    return {
      requestedUrl: `${base}/ok`,
      finalUrl: `${base}/ok`,
      httpStatus: 200,
      contentType: "text/html",
      body,
      bodyBytes: body.length,
      redirectChain: [] as { url: string; status: number }[],
      timingMs: 123,
    };
  }
  const assets = {
    robotsTxt: { available: true, url: `${base}/robots.txt` },
    sitemap: { available: false, url: `${base}/sitemap.xml` },
    favicon: { available: true, href: null as string | null },
  };

  it("extracts transport + head basics", () => {
    const f = inspectHtml(makeFetch(), assets);
    expect(f.httpStatus).toBe(200);
    expect(f.finalUrl).toBe(`${base}/ok`);
    expect(f.https).toBe(false);
    expect(f.responseTimeMs).toBe(123);
    expect(f.htmlAvailable).toBe(true);
    expect(f.title).toBe("Acme Corp — Widgets");
    expect(f.metaDescription).toBe("We make widgets.");
    expect(f.canonicalUrl).toBe("https://acme.example.com/");
    expect(f.robotsMeta).toBe("index, follow");
    expect(f.viewportMeta).toBe("width=device-width, initial-scale=1");
    expect(f.lang).toBe("en");
  });

  it("extracts content structure", () => {
    const f = inspectHtml(makeFetch(), assets);
    expect(f.h1.count).toBe(2);
    expect(f.h1.texts).toEqual(["Welcome to Acme", "Second H1"]);
    expect(f.h2Count).toBe(2);
    expect(f.imageCount).toBe(3);
    expect(f.imagesMissingAlt).toBe(1); // only the one with no alt attr
    expect(f.internalLinkCount).toBe(1); // /about (same host as finalUrl)
    expect(f.externalLinkCount).toBe(3); // external.org + linkedin + acme.example.com
  });

  it("extracts social metadata + structured data + mobile signal", () => {
    const f = inspectHtml(makeFetch(), assets);
    expect(f.openGraph.title).toBe("Acme Corp");
    expect(f.openGraph.image).toBe("https://acme.example.com/og.png");
    expect(f.twitterCard.card).toBe("summary");
    expect(f.structuredData.jsonLdCount).toBe(1);
    expect(f.structuredData.microdata).toBe(true);
    expect(f.structuredData.present).toBe(true);
    expect(f.mobile.viewportPresent).toBe(true);
    expect(f.mobile.responsiveSignal).toBe(true);
  });

  it("detects tech signals as AI_INFERENCE with evidence", () => {
    const f = inspectHtml(makeFetch(), assets);
    const wp = f.techSignals.find((t) => t.signal === "WordPress");
    expect(wp).toBeDefined();
    expect(wp?.provenance).toBe("AI_INFERENCE");
    expect(wp?.evidence).toContain("wp-content/");
    const gen = f.techSignals.find((t) => t.signal.startsWith("Generator meta"));
    expect(gen?.provenance).toBe("AI_INFERENCE");
  });

  it("extracts contact info and social links only when present", () => {
    const f = inspectHtml(makeFetch(), assets);
    expect(f.contact.emails).toEqual(["sales@acme.example.com"]);
    expect(f.contact.phones).toEqual(["+15551234567"]);
    expect(f.socialLinks).toEqual([
      { platform: "linkedin", url: "https://www.linkedin.com/company/acme" },
    ]);
  });

  it("never executes downloaded JavaScript", () => {
    const f = inspectHtml(makeFetch(), assets);
    // The fixture contains <script>document.write("pwned")</script> — a real
    // browser would inject "pwned" into the DOM. The static parser must not.
    expect(f.h1.texts.join(" ")).not.toContain("pwned");
    expect(f.title).not.toContain("pwned");
  });

  it("reports asset availability from probes", () => {
    const f = inspectHtml(makeFetch(), assets);
    expect(f.robotsTxt.available).toBe(true);
    expect(f.sitemap.available).toBe(false);
    // favicon declared in HTML counts as available
    expect(f.favicon.available).toBe(true);
    expect(f.favicon.href).toBe("/icon.png");
  });

  it("never invents missing fields — they stay null", () => {
    const f = inspectHtml(
      makeFetch("<html><head></head><body><p>hi</p></body></html>"),
      {
        robotsTxt: { available: false, url: `${base}/robots.txt` },
        sitemap: { available: false, url: `${base}/sitemap.xml` },
        favicon: { available: false, href: null },
      },
    );
    expect(f.title).toBeNull();
    expect(f.metaDescription).toBeNull();
    expect(f.canonicalUrl).toBeNull();
    expect(f.robotsMeta).toBeNull();
    expect(f.viewportMeta).toBeNull();
    expect(f.h1.count).toBe(0);
    expect(f.h1.texts).toEqual([]);
    expect(f.openGraph.title).toBeNull();
    expect(f.twitterCard.card).toBeNull();
    expect(f.lang).toBeNull();
    expect(f.structuredData.present).toBe(false);
    expect(f.techSignals).toEqual([]);
    expect(f.contact.emails).toEqual([]);
    expect(f.socialLinks).toEqual([]);
    expect(f.provenance).toBe("VERIFIED_DATA");
  });
});

// ---------------------------------------------------------------------------
describe("input validation", () => {
  it("requires url or leadId", () => {
    expect(websiteInspectSchema.safeParse({}).success).toBe(false);
    expect(websiteInspectSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
    expect(
      websiteInspectSchema.safeParse({ leadId: "c".repeat(25) }).success,
    ).toBe(true);
  });

  it("rejects malformed leadId", () => {
    expect(websiteInspectSchema.safeParse({ leadId: "not-a-cuid" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("rate limiting", () => {
  it("has a websiteInspect preset", () => {
    expect(LIMITS.websiteInspect.limit).toBeGreaterThan(0);
    expect(LIMITS.websiteInspect.windowMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("demo-mode website inspection", () => {
  function seedDemoCookie(): string {
    vi.stubEnv("DEMO_MODE", "true");
    const token = createDemoSession();
    if (!token) throw new Error("test setup failed");
    jar.set(DEMO_COOKIE_NAME, token);
    return token;
  }

  it("fixtures are labeled DEMO_DATA and never make real requests", () => {
    const insp = getDemoWebsiteInspection("https://example.com");
    expect(insp.dataLabel).toBe("DEMO_DATA");
    expect(insp.findings.provenance).toBe("DEMO_DATA");
    expect(insp.findings.techSignals[0]?.provenance).toBe("AI_INFERENCE");
    // Synchronous over static fixtures — no fetch involved.
    expect(insp.requestedUrl).toBe("https://example.com");
  });

  it("POST /api/demo/intelligence/website-inspect returns 404 when demo is off", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const res = await demoInspect(
      new NextRequest("http://localhost/api/demo/intelligence/website-inspect", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("POST serves DEMO_DATA fixtures with a valid session", async () => {
    seedDemoCookie();
    const res = await demoInspect(
      new NextRequest("http://localhost/api/demo/intelligence/website-inspect", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demo).toBe(true);
    expect(body.inspection.dataLabel).toBe("DEMO_DATA");
    expect(body.inspection.findings.title).toBeTruthy();
  });

  it("rejects empty URL with 400", async () => {
    seedDemoCookie();
    const res = await demoInspect(
      new NextRequest("http://localhost/api/demo/intelligence/website-inspect", {
        method: "POST",
        body: JSON.stringify({ url: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
