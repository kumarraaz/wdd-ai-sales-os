/**
 * Gemini search-grounding web research provider.
 *
 * Priority #2 in the WebSearchProvider order. Calls the Gemini API directly
 * with the Google Search grounding tool — this is RESEARCH, not a
 * deterministic business database. Every candidate carries source
 * attribution from the grounding chunks; candidates without a citable
 * source URL are dropped. Extracted fields are labeled AI_INFERENCE
 * (the model mediated them), never VERIFIED_DATA.
 *
 * Configured when GEMINI_API_KEY is set (the existing AI provider
 * abstraction's credential). 1 grounded prompt per search call; the
 * app-level daily ceiling (default 400) is enforced in lib/discovery/cost.ts.
 */
import {
  DiscoveryError,
  type DiscoveryQuery,
  type DiscoveryResult,
  type DiscoveredCompany,
  type LeadDiscoveryProvider,
  type ProviderCapabilities,
} from "../types";
import type { LeadSourceType } from "@prisma/client";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function readEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

function toSafeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

interface GroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: { groundingChunks?: GroundingChunk[] };
  }[];
  error?: { message?: string };
}

const SYSTEM_RULES = [
  "You are a business research assistant. List REAL businesses only.",
  "Rules:",
  "- Only include businesses you can cite with a real source URL from the search results.",
  "- Never invent phone numbers, emails, owners, revenue, or addresses.",
  "- If a phone or website is not in the search results, write NONE.",
  "- Output one business per line in exactly this format:",
  "  NAME | CITY | PHONE-or-NONE | WEBSITE-or-NONE | SOURCE_NUMBER",
  "- SOURCE_NUMBER refers to the numbered search result the business came from (1-based).",
  "- Output at most 15 lines. No commentary, no markdown, no bullet points.",
].join("\n");

export class GeminiGroundingProvider implements LeadDiscoveryProvider {
  readonly id = "gemini-grounding";
  readonly label = "AI Web Research (Gemini)";
  readonly sourceType: LeadSourceType = "WEB_SEARCH";
  readonly searchable = true;
  readonly capabilities: ProviderCapabilities = {
    websiteAuthority: "unreliable",
    supportsPhone: true,
    supportsEmail: false,
    supportsSocial: false,
    supportsPagination: false,
    supportsRecentEvidence: false,
    discoverySupported: true,
  };

  private fetcher: typeof fetch;

  /** fetcher is injectable so tests can mock the Gemini API. */
  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  isConfigured(): boolean {
    return !!readEnv("GEMINI_API_KEY");
  }

  setupInstructions(): string[] {
    return [
      "Get a free API key from Google AI Studio (aistudio.google.com).",
      'Set GEMINI_API_KEY="<your-key>" in your server environment.',
      "The app enforces a 400 grounded prompts/day internal safety ceiling — see GEMINI_GROUNDING_DAILY_CEILING.",
      "Restart the app server so the new variable is loaded.",
    ];
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const apiKey = readEnv("GEMINI_API_KEY");
    if (!apiKey) return { ok: false, message: "GEMINI_API_KEY is not set." };
    try {
      const model = readEnv("GEMINI_MODEL") || "gemini-2.0-flash";
      const res = await this.fetcher(
        `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
            generationConfig: { maxOutputTokens: 8 },
          }),
        },
      );
      if (res.status === 400 || res.status === 403) {
        return { ok: false, message: "Gemini API key rejected. Check GEMINI_API_KEY." };
      }
      if (!res.ok) return { ok: false, message: `Gemini returned HTTP ${res.status}.` };
      return { ok: true, message: "Connected — Gemini API responded." };
    } catch (err) {
      return {
        ok: false,
        message: `Could not reach Gemini: ${err instanceof Error ? err.message : "network error"}`,
      };
    }
  }

  private parseLines(
    text: string,
    sourceUrls: (string | undefined)[],
  ): DiscoveredCompany[] {
    const companies: DiscoveredCompany[] = [];
    const seen = new Set<string>();
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim().replace(/^[-*•\d.)\s]+/, "");
      if (!line || !line.includes("|")) continue;
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length < 5) continue;
      const [name, city, phoneRaw, websiteRaw, sourceNumRaw] = parts;
      if (!name || name.length > 200) continue;
      const sourceIdx = Number.parseInt(sourceNumRaw, 10);
      const sourceUrl =
        Number.isFinite(sourceIdx) && sourceIdx >= 1 && sourceIdx <= sourceUrls.length
          ? sourceUrls[sourceIdx - 1]
          : undefined;
      // No citable source → drop. Attribution is mandatory.
      if (!sourceUrl) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const company: DiscoveredCompany = {
        provider: this.id,
        providerId: `gemini:${Buffer.from(`${name}|${sourceUrl}`).toString("base64url").slice(0, 40)}`,
        name,
        // AI-mediated extraction — never VERIFIED_DATA.
        provenance: "AI_INFERENCE",
        discoveredAt: new Date().toISOString(),
        sourceUrl,
      };
      if (city && city.length <= 120) company.city = city;
      if (phoneRaw && !/^none$/i.test(phoneRaw) && phoneRaw.length <= 40) {
        company.phone = phoneRaw;
      }
      const website = toSafeHttpUrl(/^none$/i.test(websiteRaw) ? undefined : websiteRaw);
      if (website) company.website = website;
      companies.push(company);
      if (companies.length >= 15) break;
    }
    return companies;
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const apiKey = readEnv("GEMINI_API_KEY");
    if (!apiKey) {
      throw new DiscoveryError(
        "PROVIDER_NOT_CONFIGURED",
        "AI Web Research is not connected. Set GEMINI_API_KEY to enable it.",
      );
    }
    if (!query.keyword?.trim()) {
      throw new DiscoveryError("INVALID_QUERY", "A search keyword is required.");
    }

    const location = [query.city, query.state, query.country]
      .map((p) => p?.trim())
      .filter(Boolean)
      .join(", ");
    const userPrompt =
      `Find real ${query.keyword.trim()} businesses` +
      (location ? ` in ${location}` : "") +
      `. Include phone and website only when the search results show them.`;

    const model = readEnv("GEMINI_MODEL") || "gemini-2.0-flash";
    let res: Response;
    try {
      res = await this.fetcher(
        `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_RULES }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
          }),
        },
      );
    } catch (err) {
      throw new DiscoveryError(
        "PROVIDER_UNREACHABLE",
        "Could not reach the Gemini API.",
        err instanceof Error ? err.message : undefined,
      );
    }
    if (res.status === 400 || res.status === 403) {
      throw new DiscoveryError("PROVIDER_NOT_CONFIGURED", "Gemini API key rejected. Check GEMINI_API_KEY.");
    }
    if (res.status === 429) {
      throw new DiscoveryError("RATE_LIMITED", "Gemini rate limit hit. Try again later.");
    }
    if (!res.ok) {
      throw new DiscoveryError("PROVIDER_ERROR", `Gemini returned HTTP ${res.status}.`);
    }
    const data = (await res.json()) as GeminiResponse;
    if (data.error) {
      throw new DiscoveryError("PROVIDER_ERROR", "Gemini API error.", data.error.message);
    }
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const sourceUrls = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => toSafeHttpUrl(c.web?.uri))
      .filter((u): u is string => !!u);
    const companies = this.parseLines(text, sourceUrls);
    return {
      provider: this.id,
      companies,
      searchedAt: new Date().toISOString(),
      meta: { requestsMade: 1 },
    };
  }
}
