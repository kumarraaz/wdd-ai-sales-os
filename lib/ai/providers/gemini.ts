/**
 * Gemini AIProvider adapter (Layer 1).
 *
 * Delegation-only adapter: generateJson() calls the existing, unchanged
 * implementation in lib/intelligence/ai-provider.ts, so behavior is
 * identical. generateText() follows the same REST mechanics with a
 * plain-text response mime type. That file must keep working for existing
 * callers — nothing here modifies it.
 *
 * Server-side only. The API key is read from GEMINI_API_KEY (or a
 * constructor override for tests) and is never logged, never returned,
 * and never sent to the browser.
 */
import type {
  AIProvider,
  AIGeneration,
  AIGenerationOptions,
} from "../provider";
import {
  generateJson as geminiGenerateJson,
  isAIConfigured,
  getAIModelName,
  AIProviderError,
} from "../../intelligence/ai-provider";

export interface GeminiProviderConfig {
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** API key override (tests). Defaults to process.env.GEMINI_API_KEY. */
  apiKey?: string;
}

interface GeminiTextResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly fetchImpl?: typeof fetch;
  private readonly apiKey?: string;

  constructor(config: GeminiProviderConfig = {}) {
    this.fetchImpl = config.fetchImpl;
    this.apiKey = config.apiKey;
  }

  /** True when a Gemini key is configured. Never throws. */
  isConfigured(): boolean {
    return isAIConfigured(this.apiKey);
  }

  /**
   * JSON generation via the existing implementation — identical behavior,
   * including its fixed generation config (responseMimeType
   * application/json, temperature 0.2).
   */
  async generateJson(
    system: string,
    user: string,
    options: AIGenerationOptions = {},
  ): Promise<AIGeneration> {
    const result = await geminiGenerateJson(system, user, {
      model: options.model,
      timeoutMs: options.timeoutMs,
      fetchImpl: this.fetchImpl,
      apiKey: this.apiKey,
    });
    return {
      text: result.text,
      model: result.model,
      usage: result.usage,
    };
  }

  /**
   * Free-form text generation. Same transport, key handling, timeout and
   * error mapping as the existing implementation, but requests plain text.
   * Honors options.temperature (default 0.2, matching the house default)
   * and options.maxTokens (mapped to maxOutputTokens).
   */
  async generateText(
    system: string,
    user: string,
    options: AIGenerationOptions = {},
  ): Promise<AIGeneration> {
    const apiKey = (this.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
    if (!apiKey) {
      throw new AIProviderError(
        "NOT_CONFIGURED",
        "AI Intelligence is not configured.",
      );
    }
    const model = options.model ?? getAIModelName();
    const timeoutMs = options.timeoutMs ?? 45_000;
    const temperature = options.temperature ?? 0.2;
    const fetchImpl = this.fetchImpl ?? fetch;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:generateContent`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "text/plain",
            temperature,
            ...(options.maxTokens !== undefined
              ? { maxOutputTokens: options.maxTokens }
              : {}),
          },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new AIProviderError("TIMEOUT", "AI request timed out.");
      }
      throw new AIProviderError(
        "PROVIDER_ERROR",
        err instanceof Error ? err.message : "AI provider request failed.",
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new AIProviderError(
        "PROVIDER_ERROR",
        `AI provider returned HTTP ${res.status}.`,
      );
    }

    let data: GeminiTextResponse;
    try {
      data = (await res.json()) as GeminiTextResponse;
    } catch {
      throw new AIProviderError(
        "INVALID_RESPONSE",
        "AI provider returned invalid JSON.",
      );
    }
    if (data.error) {
      throw new AIProviderError("PROVIDER_ERROR", "AI provider returned an error.");
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new AIProviderError(
        "INVALID_RESPONSE",
        "AI provider returned no content.",
      );
    }

    return {
      text,
      model,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  /** Tool/function calling is out of scope for Phase 1. */
  supportsTools(): boolean {
    return false;
  }

  // stream() intentionally not implemented in Phase 1.
}
