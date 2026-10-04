/**
 * Instagram Outreach — humanized pitch upgrade tests.
 *
 * Covers the decision engine, website analysis, message quality gate,
 * name-exclusion hard rules, batch variation, and the safety invariants
 * for the new modules. Pure unit tests (no DB, no network).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeWebsite, summarizeWebsiteAnalysis } from "../lib/outreach/instagram-website";
import {
  decidePitchAngle,
  PITCH_ANGLE_LABELS,
} from "../lib/outreach/instagram-pitch";
import {
  generateOutreachMessage,
  buildTemplateMessage,
  buildMessageUserPrompt,
  validateOutreachMessage,
  researchToContext,
  MESSAGE_OPENINGS,
} from "../lib/outreach/instagram-message";
import { researchInstagramProfile } from "../lib/outreach/instagram-research";
import { instagramProfileUrl } from "../lib/outreach/instagram";
import type { AIProvider } from "../lib/ai/provider";
import type { PitchDecision } from "../lib/outreach/instagram-pitch";

const ROOT = join(__dirname, "..");

function mockAI(texts: string | string[]): AIProvider {
  const queue = Array.isArray(texts) ? [...texts] : [texts];
  const gen = () => ({
    text: queue.length > 1 ? queue.shift()! : queue[0],
    provider: "mock",
    model: "mock",
    latencyMs: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
  return {
    name: "mock",
    isConfigured: () => true,
    generateJson: vi.fn(async () => gen()),
    generateText: vi.fn(async () => gen()),
    supportsTools: () => false,
  };
}

const VALID_DM =
  "Hey, had a quick look at your page and then the website. The services are clear, but the mobile experience makes the enquiry option pretty easy to miss.\n\nI work on website restructuring and UX improvements, and this looks like something that could be cleaned up. Happy to show you what I'd change.";

const research = {
  username: "abcmanufacturing",
  profileUrl: instagramProfileUrl("abcmanufacturing"),
  businessName: "ABC Manufacturing",
  category: "industrial equipment",
  location: "Ahmedabad, India",
  website: "https://abc.example.com",
  observations: "Public listing shows industrial equipment manufacturing.",
  websiteAnalysis: null,
  sources: ["public web search (Tavily)"],
  confidence: "HIGH" as const,
  researchedAt: new Date().toISOString(),
};

const decision = (angle: PitchDecision["angle"] = "UX_CONVERSION"): PitchDecision => ({
  angle,
  reason: "test",
});

// ── Website analysis ────────────────────────────────────────────────────

const GOOD_HTML = `<html><head><title>Acme Industrial Equipment Manufacturers Pvt Ltd</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Leading manufacturer of industrial equipment in Ahmedabad.">
</head><body><h1>Industrial Equipment</h1>
<p>${"We manufacture high quality industrial equipment for factories across India. ".repeat(20)}</p>
<a href="/contact">Contact us</a> <a href="https://wa.me/911234567890">WhatsApp</a>
<p>© 2026 Acme Industries</p></body></html>`;

describe("analyzeWebsite — honest, observable-only findings", () => {
  it("reports genuine issues without inventing any", async () => {
    const html = `<html><head><title>SB</title></head><body><h1>SomeBiz</h1><p>We make widgets.</p></body></html>`;
    const a = await analyzeWebsite("https://somebiz.example.com", {
      fetchHtml: async () => ({ html, ms: 900 }),
    });
    expect(a.fetchedOk).toBe(true);
    expect(a.hasViewportMeta).toBe(false);
    expect(a.hasMetaDescription).toBe(false);
    expect(a.ctaSignals).toEqual([]);
    // Every finding is tied to an observed signal — none invented.
    expect(a.findings.some((f) => f.includes("viewport"))).toBe(true);
    expect(a.findings.some((f) => f.includes("Meta description missing"))).toBe(true);
    expect(a.findings.some((f) => f.includes("call-to-action"))).toBe(true);
    expect(a.findings.some((f) => f.includes("little text content"))).toBe(true);
    expect(a.findings.join(" ")).not.toMatch(/revenue|employees|customers/i);
  });

  it("recognizes a strong site (no invented problems)", async () => {
    const a = await analyzeWebsite("https://acme.example.com", {
      fetchHtml: async () => ({ html: GOOD_HTML, ms: 800 }),
    });
    expect(a.fetchedOk).toBe(true);
    expect(a.hasViewportMeta).toBe(true);
    expect(a.hasMetaDescription).toBe(true);
    expect(a.ctaSignals).toContain("contact");
    expect(a.findings.some((f) => /poor|missing|outdated|slow/i.test(f))).toBe(false);
  });

  it("detects an outdated copyright year", async () => {
    const html = `<html><head><title>Old Co Manufacturing Since 1998</title><meta name="viewport" content="x"></head><body><p>© 2019 Old Co</p><a href="/contact">Contact</a></body></html>`;
    const a = await analyzeWebsite("https://old.example.com", {
      fetchHtml: async () => ({ html, ms: 500 }),
    });
    expect(a.copyrightYear).toBe(2019);
    expect(a.findings.some((f) => f.includes("2019") && f.includes("outdated"))).toBe(true);
  });

  it("flags an observably slow homepage", async () => {
    const a = await analyzeWebsite("https://slow.example.com", {
      fetchHtml: async () => ({ html: GOOD_HTML, ms: 9500 }),
    });
    expect(a.findings.some((f) => f.includes("9.5s"))).toBe(true);
  });

  it("never throws on fetch failure — reports it instead", async () => {
    const a = await analyzeWebsite("https://down.example.com", {
      fetchHtml: async () => {
        throw new Error("connection refused");
      },
    });
    expect(a.fetchedOk).toBe(false);
    expect(a.fetchError).toBe("connection refused");
    expect(a.findings).toEqual([]);
  });

  it("summarizeWebsiteAnalysis is honest when the fetch failed", () => {
    const s = summarizeWebsiteAnalysis({
      url: "https://down.example.com",
      fetchedOk: false,
      fetchError: "timeout",
      fetchMs: null,
      title: null,
      https: true,
      hasViewportMeta: false,
      hasMetaDescription: false,
      ctaSignals: [],
      contentWords: null,
      copyrightYear: null,
      findings: [],
      checkedAt: new Date().toISOString(),
    });
    expect(s).toContain("could not be fetched");
    expect(s).toContain("no website conclusions drawn");
  });
});

// ── Pitch decision engine ───────────────────────────────────────────────

function analysisWith(overrides: Record<string, unknown>) {
  return {
    url: "https://x.example.com",
    fetchedOk: true,
    fetchError: null,
    fetchMs: 700,
    title: "Good Title For The Business Website Here",
    https: true,
    hasViewportMeta: true,
    hasMetaDescription: true,
    ctaSignals: ["contact"],
    contentWords: 600,
    copyrightYear: new Date().getFullYear(),
    findings: [],
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("decidePitchAngle", () => {
  it("no website → NEW_WEBSITE (never 'restructuring' when nothing exists)", () => {
    const d = decidePitchAngle({ website: null, websiteAnalysis: null, location: null, confidence: "LOW" });
    expect(d.angle).toBe("NEW_WEBSITE");
    expect(d.reason).toMatch(/first professional website/i);
  });

  it("website issues → REDESIGN when the site looks dated", () => {
    const d = decidePitchAngle({
      website: "https://old.example.com",
      websiteAnalysis: analysisWith({ hasViewportMeta: false, copyrightYear: 2019, hasMetaDescription: true, ctaSignals: ["contact"], contentWords: 500 }),
      location: null,
      confidence: "HIGH",
    });
    expect(d.angle).toBe("REDESIGN");
  });

  it("missing enquiry CTA → UX_CONVERSION", () => {
    const d = decidePitchAngle({
      website: "https://x.example.com",
      websiteAnalysis: analysisWith({ ctaSignals: [] }),
      location: null,
      confidence: "HIGH",
    });
    expect(d.angle).toBe("UX_CONVERSION");
  });

  it("weak search basics → SEO, and LOCAL_SEO when a location is known", () => {
    const base = {
      website: "https://x.example.com",
      confidence: "HIGH" as const,
      websiteAnalysis: analysisWith({
        hasMetaDescription: false,
        title: "Hi",
        contentWords: 80,
        ctaSignals: ["contact"],
      }),
    };
    expect(decidePitchAngle({ ...base, location: null }).angle).toBe("SEO");
    const local = decidePitchAngle({ ...base, location: "Mumbai" });
    expect(local.angle).toBe("LOCAL_SEO");
    expect(local.reason).toContain("Mumbai");
  });

  it("slow homepage → PERFORMANCE", () => {
    const d = decidePitchAngle({
      website: "https://x.example.com",
      websiteAnalysis: analysisWith({ fetchMs: 9500 }),
      location: null,
      confidence: "HIGH",
    });
    expect(d.angle).toBe("PERFORMANCE");
  });

  it("strong website → GENERAL (never invents problems)", () => {
    const d = decidePitchAngle({
      website: "https://x.example.com",
      websiteAnalysis: analysisWith({}),
      location: null,
      confidence: "HIGH",
    });
    expect(d.angle).toBe("GENERAL");
    expect(d.reason).toMatch(/instead of inventing problems/i);
  });

  it("website found but not analyzable → GENERAL", () => {
    const d = decidePitchAngle({
      website: "https://x.example.com",
      websiteAnalysis: analysisWith({ fetchedOk: false, fetchError: "timeout" }),
      location: null,
      confidence: "MEDIUM",
    });
    expect(d.angle).toBe("GENERAL");
  });

  it("every angle has a UI label", () => {
    for (const angle of ["NEW_WEBSITE", "REDESIGN", "UX_CONVERSION", "SEO", "LOCAL_SEO", "PERFORMANCE", "CONTENT", "GENERAL"] as const) {
      expect(PITCH_ANGLE_LABELS[angle]).toBeTruthy();
    }
  });
});

// ── Quality gate: the hard rules ────────────────────────────────────────

describe("validateOutreachMessage — hard rules", () => {
  const checks = { username: "abcmanufacturing", businessName: "ABC Manufacturing" };

  it("rejects the Instagram username and @handle", () => {
    expect(validateOutreachMessage("Hey @abcmanufacturing, nice page here and I wanted to reach out about your website and online presence today.", checks).ok).toBe(false);
    expect(
      validateOutreachMessage(
        "Hey, I was looking at abcmanufacturing and noticed your page could use a better website and online presence for customers.",
        checks,
      ).ok,
    ).toBe(false);
  });

  it("rejects the business/company name", () => {
    expect(
      validateOutreachMessage(
        "Hey, had a quick look at your page. ABC Manufacturing has a solid offering, and I work on websites for industrial businesses like this one.",
        checks,
      ).ok,
    ).toBe(false);
  });

  it("accepts a genuinely humanized message with no names", () => {
    expect(validateOutreachMessage(VALID_DM, checks).ok).toBe(true);
  });

  it("rejects banned sales buzzwords", () => {
    const v = validateOutreachMessage(
      "Hey, had a quick look at your page. I can help you leverage cutting-edge solutions to take your business to the next level with our digital transformation expertise.",
      { username: "x", businessName: null },
    );
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/banned sales phrase/i);
  });

  it("rejects formal email-style openers", () => {
    const v = validateOutreachMessage(
      "Dear Sir, I hope this message finds you well. I was looking at your page and wanted to discuss your website and online presence with you today.",
      { username: "x", businessName: null },
    );
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/formal/i);
  });

  it("rejects aggressive calls to action", () => {
    const v = validateOutreachMessage(
      "Hey, had a quick look at your page. Your website needs work and I would love to help you fix it properly this week. Book a meeting now to get started today.",
      { username: "x", businessName: null },
    );
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/aggressive/i);
  });

  it("rejects messages that are too long or too short", () => {
    const long = `Hey, had a quick look at your page. ${"Your website could use some improvement work. ".repeat(30)}`;
    expect(validateOutreachMessage(long, { username: "x", businessName: null }).ok).toBe(false);
    expect(validateOutreachMessage("Hey, nice page.", { username: "x", businessName: null }).ok).toBe(false);
  });

  it("rejects hashtags and emojis", () => {
    expect(
      validateOutreachMessage(
        "Hey, had a quick look at your page and loved what I saw there. I work on websites for businesses and would love to help. #webdesign #seo",
        { username: "x", businessName: null },
      ).ok,
    ).toBe(false);
  });

  it("does not false-positive on ordinary words", () => {
    // "art" as a substring must not trip a username check for "art".
    const v = validateOutreachMessage(VALID_DM, { username: "zz9q", businessName: "QZ" });
    expect(v.ok).toBe(true);
  });
});

// ── Generation pipeline ─────────────────────────────────────────────────

describe("generateOutreachMessage — humanized pipeline", () => {
  it("passes a valid AI draft through the quality gate untouched", async () => {
    const ai = mockAI(VALID_DM);
    const gen = await generateOutreachMessage(research, decision(), null, ai, { variationSeed: 0 });
    expect(gen.source).toBe("ai");
    expect(gen.text).toBe(VALID_DM);
    expect(ai.generateText).toHaveBeenCalledTimes(1);
  });

  it("regenerates once when the draft contains the business name, then uses the fixed draft", async () => {
    const bad =
      "Hi ABC Manufacturing team, I checked your website and noticed your SEO is poor. We can take your business to the next level with our cutting-edge solutions. Book a meeting now!";
    const ai = mockAI([bad, VALID_DM]);
    const gen = await generateOutreachMessage(research, decision(), null, ai, { variationSeed: 0 });
    expect(ai.generateText).toHaveBeenCalledTimes(2);
    // The retry prompt includes the failure reasons.
    const retryArg = (ai.generateText as ReturnType<typeof vi.fn>).mock.calls[1][1] as string;
    expect(retryArg).toMatch(/FAILED these checks/i);
    expect(gen.source).toBe("ai");
    expect(gen.text).toBe(VALID_DM);
  });

  it("falls back to the humanized template when AI drafts keep failing the gate", async () => {
    const bad = "Hi @abcmanufacturing! Dear Sir, leverage our synergy now! Book a meeting immediately!";
    const ai = mockAI([bad, bad]);
    const gen = await generateOutreachMessage(research, decision(), null, ai, { variationSeed: 0 });
    expect(gen.source).toBe("template");
    const v = validateOutreachMessage(gen.text, {
      username: research.username,
      businessName: research.businessName,
    });
    expect(v.ok).toBe(true);
  });

  it("prompt carries the pitch angle and marks names as internal-only", () => {
    const ctx = researchToContext(research, decision("SEO"), "Meta description missing.");
    const prompt = buildMessageUserPrompt(ctx, MESSAGE_OPENINGS[0]);
    expect(prompt).toContain("PITCH ANGLE: SEO");
    expect(prompt).toContain("INTERNAL ONLY — never write this");
    expect(prompt).toContain("Meta description missing.");
    expect(prompt).toContain("BEGIN UNTRUSTED BUSINESS CONTEXT");
  });

  it("variation seeds rotate the opening line (batch variation)", async () => {
    const seen = new Set<string>();
    for (const seed of [0, 1, 2, 3, 4]) {
      const ai = mockAI(VALID_DM);
      await generateOutreachMessage(research, decision(), null, ai, { variationSeed: seed });
      const userArg = (ai.generateText as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      const m = userArg.match(/Start with exactly this opening: "([^"]+)"/);
      expect(m).toBeTruthy();
      seen.add(m![1]);
    }
    expect(seen.size).toBe(5);
  });
});

describe("buildTemplateMessage — humanized, name-free, angle-aware", () => {
  const angles = ["NEW_WEBSITE", "REDESIGN", "UX_CONVERSION", "SEO", "LOCAL_SEO", "PERFORMANCE", "CONTENT", "GENERAL"] as const;

  it("every angle template passes the quality gate and names never appear", () => {
    for (const angle of angles) {
      const ctx = researchToContext(research, decision(angle), null);
      const text = buildTemplateMessage(ctx);
      const v = validateOutreachMessage(text, {
        username: research.username,
        businessName: research.businessName,
      });
      expect(`${angle}: ${v.reasons.join(";")}`).toBe(`${angle}: `);
      expect(text).not.toContain("abcmanufacturing");
      expect(text).not.toContain("ABC Manufacturing");
    }
  });

  it("no-website angle never pitches restructuring", () => {
    const ctx = researchToContext({ ...research, website: null }, decision("NEW_WEBSITE"), null);
    const text = buildTemplateMessage(ctx).toLowerCase();
    expect(text).toMatch(/no website|first|simple site/);
    expect(text).not.toMatch(/restructur|redesign/);
  });

  it("templates vary by angle", () => {
    const texts = new Set(
      angles.map((a) => buildTemplateMessage(researchToContext(research, decision(a), null))),
    );
    expect(texts.size).toBe(angles.length);
  });
});

// ── Research pipeline: website step ─────────────────────────────────────

describe("researchInstagramProfile — website analysis step", () => {
  const html = `<html><head><title>SomeBiz Widgets</title></head><body><p>We make widgets.</p></body></html>`;

  it("analyzes the website when research finds one", async () => {
    let fetchedUrl = "";
    const r = await researchInstagramProfile("somebiz", {
      webSearch: async () => [
        { title: "SomeBiz", url: "https://somebiz.example.com", snippet: "SomeBiz makes widgets." },
      ],
      ai: mockAI(
        JSON.stringify({
          businessName: "SomeBiz",
          category: "manufacturing",
          location: null,
          website: "https://somebiz.example.com",
          observations: "Public web listing.",
        }),
      ),
      fetchWebsite: async (url: string) => {
        fetchedUrl = url;
        return { html, ms: 400 };
      },
    });
    expect(fetchedUrl).toBe("https://somebiz.example.com");
    expect(r.websiteAnalysis?.fetchedOk).toBe(true);
    expect(r.websiteAnalysis?.findings.some((f) => f.includes("viewport"))).toBe(true);
    expect(r.sources).toContain("business website homepage (public, fetched)");
  });

  it("skips website analysis when no website is found", async () => {
    const fetchWebsite = vi.fn(async () => ({ html: "<html></html>", ms: 1 }));
    const r = await researchInstagramProfile("ghostuser123", {
      webSearch: async () => [],
      ai: mockAI("{}"),
      fetchWebsite,
    });
    expect(fetchWebsite).not.toHaveBeenCalled();
    expect(r.websiteAnalysis).toBeNull();
    expect(r.website).toBeNull();
  });

  it("website fetch failure does not fail the profile research", async () => {
    const r = await researchInstagramProfile("somebiz", {
      webSearch: async () => [
        { title: "SomeBiz", url: "https://somebiz.example.com", snippet: "SomeBiz makes widgets." },
      ],
      ai: mockAI(
        JSON.stringify({
          businessName: "SomeBiz",
          category: null,
          location: null,
          website: "https://somebiz.example.com",
          observations: "Public web listing.",
        }),
      ),
      fetchWebsite: async () => {
        throw new Error("DNS failed");
      },
    });
    expect(r.websiteAnalysis?.fetchedOk).toBe(false);
    expect(r.website).toBe("https://somebiz.example.com");
    expect(r.businessName).toBe("SomeBiz");
  });
});

// ── Safety invariants for the new modules ───────────────────────────────

describe("SAFETY INVARIANTS — new outreach modules", () => {
  const src = ["instagram-website.ts", "instagram-pitch.ts", "instagram-message.ts"]
    .map((f) => readFileSync(join(ROOT, "lib", "outreach", f), "utf8"))
    .join("\n");

  it("no instagram.com fetching in website research (SSRF-guarded public sites only)", () => {
    expect(src).not.toMatch(/fetch\([^)]*instagram\.com/);
    expect(src).toContain("assertSafeUrl");
  });

  it("no automation, sending, or credential handling in new modules", () => {
    expect(src).not.toMatch(/sendDM|sendDirectMessage|autoSend|puppeteer|playwright/i);
    expect(src).not.toMatch(/password|sessionCookie|access_token|refresh_token/i);
    expect(src).not.toMatch(/captcha|proxy.*rotation/i);
  });

  it("message module never invents business facts — website claims come only from analysis", () => {
    expect(src).not.toMatch(/your SEO is poor|you're losing customers|your website is broken/i);
  });
});
