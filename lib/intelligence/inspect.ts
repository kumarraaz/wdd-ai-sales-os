/**
 * Website HTML inspector (Phase 2 Step 2).
 *
 * Parses fetched HTML statically with cheerio — downloaded JavaScript is
 * NEVER executed. Every finding is either directly observed in the inspected
 * response (VERIFIED_DATA) or explicitly marked as a heuristic inference
 * (AI_INFERENCE).
 *
 * Honesty rule: a field is null/empty only when the inspected response
 * proves it absent (e.g. no <title> element in the fetched HTML). When the
 * page could not be inspected at all, no findings are produced — the
 * inspection is recorded as FAILED with the reason instead.
 */
import * as cheerio from "cheerio";
import {
  safeFetchHtml,
  safeFetchStatus,
  type SafeFetchOptions,
  type SafeFetchResult,
} from "./safe-fetch";

export interface TechSignal {
  signal: string;
  evidence: string;
  /** Heuristic pattern matches are always inferences, never verified facts. */
  provenance: "AI_INFERENCE";
}

export interface WebsiteFindings {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  redirectChain: { url: string; status: number }[];
  https: boolean;
  responseTimeMs: number;
  htmlAvailable: boolean;

  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  viewportMeta: string | null;

  h1: { count: number; texts: string[] };
  h2Count: number;
  imageCount: number;
  imagesMissingAlt: number;
  internalLinkCount: number;
  externalLinkCount: number;

  robotsTxt: { available: boolean; url: string };
  sitemap: { available: boolean; url: string };
  favicon: { available: boolean; href: string | null };

  openGraph: { title: string | null; description: string | null; image: string | null };
  twitterCard: {
    card: string | null;
    title: string | null;
    description: string | null;
    image: string | null;
  };

  lang: string | null;
  structuredData: { jsonLdCount: number; microdata: boolean; present: boolean };
  mobile: { viewportPresent: boolean; responsiveSignal: boolean };

  techSignals: TechSignal[];
  contact: { emails: string[]; phones: string[] };
  socialLinks: { platform: string; url: string }[];

  /** Directly observed facts in this report are VERIFIED_DATA. */
  provenance: "VERIFIED_DATA";
  inspectedAt: string; // ISO
}

export interface AssetProbes {
  robotsTxt: { available: boolean; url: string };
  sitemap: { available: boolean; url: string };
  favicon: { available: boolean; href: string | null };
}

function metaContent(
  $: cheerio.CheerioAPI,
  selector: string,
): string | null {
  const el = $(selector).first();
  const content = el.attr("content")?.trim();
  return content || null;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

const SOCIAL_DOMAINS: { domain: string; platform: string }[] = [
  { domain: "facebook.com", platform: "facebook" },
  { domain: "instagram.com", platform: "instagram" },
  { domain: "linkedin.com", platform: "linkedin" },
  { domain: "twitter.com", platform: "twitter" },
  { domain: "x.com", platform: "x" },
  { domain: "youtube.com", platform: "youtube" },
];

const TECH_PATTERNS: { signal: string; needles: string[] }[] = [
  { signal: "WordPress", needles: ["wp-content/", "wp-includes/", "/wp-json/"] },
  { signal: "Shopify", needles: ["cdn.shopify.com"] },
  { signal: "Wix", needles: ["wixstatic.com", "parastorage.com"] },
  { signal: "Squarespace", needles: ["static1.squarespace.com"] },
  { signal: "Webflow", needles: ["assets.website-files.com", "webflow"] },
  { signal: "Next.js", needles: ["/_next/static/"] },
  { signal: "Nuxt", needles: ["/_nuxt/"] },
  { signal: "Gatsby", needles: ['id="gatsby-focus-wrapper"'] },
  { signal: "HubSpot", needles: ["hs-scripts"] },
  { signal: "Joomla", needles: ["/media/jui/", 'content="joomla'] },
  { signal: "Drupal", needles: ["sites/default/files", 'content="drupal'] },
];

/**
 * Pure HTML inspection — no network. Takes the fetch result plus the
 * already-probed asset availability and returns structured findings.
 */
export function inspectHtml(
  fetch: SafeFetchResult,
  assets: AssetProbes,
  inspectedAt: string = new Date().toISOString(),
): WebsiteFindings {
  const $ = cheerio.load(fetch.body);
  const finalUrl = new URL(fetch.finalUrl);
  const finalHost = normalizeHost(finalUrl.hostname);

  const title = $("title").first().text().trim() || null;
  const metaDescription = metaContent($, 'meta[name="description"]');
  const canonicalUrl = $("link[rel='canonical']").first().attr("href")?.trim() || null;
  const robotsMeta = metaContent($, 'meta[name="robots"]');
  const viewportMeta = metaContent($, 'meta[name="viewport"]');

  const h1Texts = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 10);
  const h1Count = $("h1").length;
  const h2Count = $("h2").length;

  const images = $("img");
  const imageCount = images.length;
  let imagesMissingAlt = 0;
  images.each((_, el) => {
    if ($(el).attr("alt") === undefined) imagesMissingAlt++;
  });

  let internalLinkCount = 0;
  let externalLinkCount = 0;
  const emails = new Set<string>();
  const phones = new Set<string>();
  const socialLinks: { platform: string; url: string }[] = [];
  const seenSocial = new Set<string>();

  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href")?.trim() ?? "";
    if (!rawHref || rawHref.startsWith("#")) return;
    const lower = rawHref.toLowerCase();
    if (lower.startsWith("mailto:")) {
      const email = rawHref.slice(7).split("?")[0]?.trim() ?? "";
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && emails.size < 10) {
        emails.add(email);
      }
      return;
    }
    if (lower.startsWith("tel:")) {
      const phone = rawHref.slice(4).split("?")[0]?.trim() ?? "";
      if (phone && phones.size < 10) phones.add(phone);
      return;
    }
    if (
      lower.startsWith("javascript:") ||
      lower.startsWith("data:") ||
      lower.startsWith("ftp:")
    ) {
      return;
    }
    let hrefHost: string | null = null;
    try {
      hrefHost = normalizeHost(new URL(rawHref, fetch.finalUrl).hostname);
    } catch {
      return;
    }
    if (hrefHost === finalHost) internalLinkCount++;
    else {
      externalLinkCount++;
      for (const { domain, platform } of SOCIAL_DOMAINS) {
        if (hrefHost === domain || hrefHost.endsWith(`.${domain}`)) {
          const url = rawHref.startsWith("http") ? rawHref : new URL(rawHref, fetch.finalUrl).toString();
          if (!seenSocial.has(url) && socialLinks.length < 20) {
            seenSocial.add(url);
            socialLinks.push({ platform, url });
          }
          break;
        }
      }
    }
  });

  const faviconHref =
    $("link[rel='icon']").first().attr("href")?.trim() ||
    $("link[rel='shortcut icon']").first().attr("href")?.trim() ||
    null;

  const openGraph = {
    title: metaContent($, 'meta[property="og:title"]'),
    description: metaContent($, 'meta[property="og:description"]'),
    image: metaContent($, 'meta[property="og:image"]'),
  };
  const twitterCard = {
    card: metaContent($, 'meta[name="twitter:card"]'),
    title: metaContent($, 'meta[name="twitter:title"]'),
    description: metaContent($, 'meta[name="twitter:description"]'),
    image: metaContent($, 'meta[name="twitter:image"]'),
  };

  const lang = $("html").first().attr("lang")?.trim() || null;

  const jsonLdCount = $('script[type="application/ld+json"]').length;
  const microdata = $("[itemscope]").length > 0;

  const generator = metaContent($, 'meta[name="generator"]');

  // Heuristic technology signals — pattern matches on the raw HTML, always
  // labeled AI_INFERENCE, never presented as verified facts.
  const techSignals: TechSignal[] = [];
  const htmlLower = fetch.body.toLowerCase();
  for (const { signal, needles } of TECH_PATTERNS) {
    const hit = needles.find((n) => htmlLower.includes(n));
    if (hit) {
      techSignals.push({
        signal,
        evidence: `Pattern "${hit}" found in page HTML`,
        provenance: "AI_INFERENCE",
      });
    }
  }
  if (generator) {
    techSignals.push({
      signal: `Generator meta: ${generator.slice(0, 120)}`,
      evidence: 'meta[name="generator"] content',
      provenance: "AI_INFERENCE",
    });
  }

  return {
    requestedUrl: fetch.requestedUrl,
    finalUrl: fetch.finalUrl,
    httpStatus: fetch.httpStatus,
    redirectChain: fetch.redirectChain,
    https: finalUrl.protocol === "https:",
    responseTimeMs: fetch.timingMs,
    htmlAvailable: fetch.body.length > 0,

    title,
    metaDescription,
    canonicalUrl,
    robotsMeta,
    viewportMeta,

    h1: { count: h1Count, texts: h1Texts },
    h2Count,
    imageCount,
    imagesMissingAlt,
    internalLinkCount,
    externalLinkCount,

    robotsTxt: assets.robotsTxt,
    sitemap: assets.sitemap,
    // Available when declared in the HTML or served at the default path.
    favicon: {
      available: assets.favicon.available || faviconHref !== null,
      href: faviconHref,
    },

    openGraph,
    twitterCard,

    lang,
    structuredData: {
      jsonLdCount,
      microdata,
      present: jsonLdCount > 0 || microdata,
    },
    mobile: {
      viewportPresent: viewportMeta !== null,
      responsiveSignal: /width\s*=\s*device-width/i.test(viewportMeta ?? ""),
    },

    techSignals,
    contact: { emails: [...emails], phones: [...phones] },
    socialLinks,

    provenance: "VERIFIED_DATA",
    inspectedAt,
  };
}

/**
 * Full website inspection: safe-fetch the page, probe robots.txt /
 * sitemap.xml / favicon.ico through the same SSRF pipeline, and parse.
 * Throws SafeFetchError / SafeUrlError when the page itself cannot be
 * fetched safely.
 */
export async function runWebsiteInspection(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<WebsiteFindings> {
  const fetch = await safeFetchHtml(rawUrl, options);
  const origin = new URL(fetch.finalUrl).origin;

  const [robotsTxt, sitemap, faviconProbe] = await Promise.all([
    safeFetchStatus(`${origin}/robots.txt`, options),
    safeFetchStatus(`${origin}/sitemap.xml`, options),
    safeFetchStatus(`${origin}/favicon.ico`, options),
  ]);

  return inspectHtml(
    fetch,
    {
      robotsTxt: { available: robotsTxt.status === 200, url: `${origin}/robots.txt` },
      sitemap: { available: sitemap.status === 200, url: `${origin}/sitemap.xml` },
      favicon: { available: faviconProbe.status === 200, href: null },
    },
  );
}
