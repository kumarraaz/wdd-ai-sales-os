/**
 * Business website research — public homepage analysis.
 *
 * What this does:
 * - Fetches the business's own PUBLIC homepage (never instagram.com).
 * - Extracts deterministic, directly observable signals: title, meta
 *   description, mobile viewport tag, enquiry/contact CTA presence,
 *   content volume, copyright recency, fetch latency.
 * - Turns those signals into honest, human-readable findings. Every
 *   finding describes something actually observed — never invented.
 *
 * What this NEVER does:
 * - Assert problems without evidence (e.g. claiming poor search visibility
 *   when no signal was actually observed).
 * - Access anything behind authentication.
 * - Fetch without the SSRF guard (assertSafeUrl) and a hard timeout.
 *
 * Failures never throw to the caller of analyzeWebsite — they are
 * reported on the result so the batch can continue.
 */
import { assertSafeUrl } from "../ssrf";

export interface WebsiteAnalysis {
  url: string;
  fetchedOk: boolean;
  fetchError: string | null;
  /** Homepage fetch latency in ms (null when the fetch failed). */
  fetchMs: number | null;
  title: string | null;
  https: boolean;
  hasViewportMeta: boolean;
  hasMetaDescription: boolean;
  /** Observable CTA/enquiry signals, e.g. ["contact", "whatsapp", "tel:"] */
  ctaSignals: string[];
  /** Visible word count on the homepage (null when unknown). */
  contentWords: number | null;
  copyrightYear: number | null;
  /** Honest, observable-only findings, e.g. "No mobile viewport tag found". */
  findings: string[];
  checkedAt: string;
}

export interface WebsiteFetchDeps {
  /** Override the HTML fetch (tests). Must resolve raw HTML. */
  fetchHtml?: (url: string) => Promise<{ html: string; ms: number }>;
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 600_000;
const SLOW_FETCH_MS = 8_000;

async function defaultFetchHtml(
  rawUrl: string,
): Promise<{ html: string; ms: number }> {
  const safe = await assertSafeUrl(rawUrl);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(safe, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WDD-SalesOS/1.0; business-website research)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!/html/i.test(contentType)) throw new Error("Not an HTML page");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Empty response body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_HTML_BYTES) break;
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString("utf8");
    return { html, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Fetch timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractTagContent(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim().slice(0, 200) || null : null;
}

function hasMeta(html: string, name: string): boolean {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`,
    "i",
  );
  return re.test(html);
}

function metaContent(html: string, name: string): string | null {
  const m = html.match(
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
  );
  return m ? m[1].trim().slice(0, 200) || null : null;
}

/** CTA/enquiry signals actually present in the markup. */
function detectCtaSignals(html: string): string[] {
  const lower = html.toLowerCase();
  const signals: Array<[string, RegExp]> = [
    ["contact", /contact(\s|-|_)?(us|form)?|enquir|inquir/i],
    ["quote", /get (a )?quote|request (a )?(quote|callback)/i],
    ["call", /call (us|now)|tel:/i],
    ["whatsapp", /whatsapp|wa\.me/i],
    ["booking", /book (now|appointment|a demo)|appointment/i],
  ];
  return signals.filter(([, re]) => re.test(lower)).map(([name]) => name);
}

function visibleWordCount(html: string): number | null {
  try {
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!stripped) return 0;
    return stripped.split(" ").length;
  } catch {
    return null;
  }
}

function detectCopyrightYear(html: string): number | null {
  const m = html.match(/(?:©|&copy;|copyright)\s*(\d{4})/i);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  return year >= 1990 && year <= new Date().getFullYear() + 1 ? year : null;
}

/**
 * Analyze a business website homepage. Never throws — failures are
 * reported on the result.
 */
export async function analyzeWebsite(
  url: string,
  deps: WebsiteFetchDeps = {},
): Promise<WebsiteAnalysis> {
  const checkedAt = new Date().toISOString();
  const base: WebsiteAnalysis = {
    url,
    fetchedOk: false,
    fetchError: null,
    fetchMs: null,
    title: null,
    https: /^https:/i.test(url),
    hasViewportMeta: false,
    hasMetaDescription: false,
    ctaSignals: [],
    contentWords: null,
    copyrightYear: null,
    findings: [],
    checkedAt,
  };

  let html: string;
  let ms: number;
  try {
    const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;
    ({ html, ms } = await fetchHtml(url));
  } catch (err) {
    return {
      ...base,
      fetchError: err instanceof Error ? err.message : "Website fetch failed",
    };
  }

  const title = extractTagContent(html, "title");
  const hasViewportMeta = hasMeta(html, "viewport");
  const description = metaContent(html, "description");
  const hasMetaDescription = !!description;
  const ctaSignals = detectCtaSignals(html);
  const contentWords = visibleWordCount(html);
  const copyrightYear = detectCopyrightYear(html);

  const findings: string[] = [];
  if (!hasViewportMeta) {
    findings.push("No mobile viewport tag — the site may render poorly on phones.");
  }
  if (!hasMetaDescription) {
    findings.push("Meta description missing — a basic search-visibility gap.");
  }
  if (!title || title.length < 10) {
    findings.push("Page title missing or very short — weak first impression in search results.");
  }
  if (ctaSignals.length === 0) {
    findings.push("No clear enquiry/contact call-to-action found on the homepage.");
  }
  if (contentWords !== null && contentWords < 150) {
    findings.push(`Very little text content on the homepage (~${contentWords} words).`);
  }
  const currentYear = new Date().getFullYear();
  if (copyrightYear !== null && copyrightYear < currentYear - 1) {
    findings.push(`Copyright shows ${copyrightYear} — the site content may be outdated.`);
  }
  if (ms > SLOW_FETCH_MS) {
    findings.push(`Homepage took ${(ms / 1000).toFixed(1)}s to respond — possible performance issue.`);
  }
  // Positive, honestly observed signals (so "already strong" sites are recognized).
  if (ctaSignals.length > 0) {
    findings.push(`Clear contact/enquiry options present (${ctaSignals.join(", ")}).`);
  }
  if (hasMetaDescription && hasViewportMeta && title && title.length >= 10) {
    findings.push("Core basics look in place (title, meta description, mobile viewport).");
  }

  return {
    ...base,
    fetchedOk: true,
    fetchMs: ms,
    title,
    hasViewportMeta,
    hasMetaDescription,
    ctaSignals,
    contentWords,
    copyrightYear,
    findings,
    checkedAt,
  };
}

/** One-line human-readable summary for storage/display. Null when nothing to show. */
export function summarizeWebsiteAnalysis(a: WebsiteAnalysis | null): string | null {
  if (!a) return null;
  if (!a.fetchedOk) {
    return `Website found (${a.url}) but the homepage could not be fetched (${a.fetchError ?? "unknown error"}) — no website conclusions drawn.`;
  }
  const head = `Checked ${a.url}`;
  if (a.findings.length === 0) return `${head} — nothing notable observed.`;
  return `${head}: ${a.findings.join(" ")}`;
}
