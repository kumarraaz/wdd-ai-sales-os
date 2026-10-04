/**
 * Groq AIProvider adapter (Layer 1).
 *
 * Groq is an AI INFERENCE provider (fast LLM inference via its
 * OpenAI-compatible API) — it is NOT a web-search provider and is never
 * used as one. Used for AI reasoning tasks: message drafting, lead
 * analysis, summarization.
 *
 * Server-side only. The API key is read from GROQ_API_KEY and is never
 * logged, never returned, and never sent to the browser. Rate-limit
 * headers (x-ratelimit-*) are read where present; the app-level daily
 * ceiling in lib/discovery/cost.ts applies independently.
 */
import type {
  AIProvider,
  AIGeneration,
  AIGenerationOptions,
} from "../provider";
import { AIProviderError } from "../provider";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqProviderConfig {
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** API key override (tests). Defaults to process.env.GROQ_API_KEY. */
  apiKey?: string;
  /** Model override (tests). Defaults to process.env.GROQ_MODEL. */
  model?: string;
}

interface GroqChatResponse {
  choices?: { message?: { content?: string } }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class GroqProvider implements AIProvider {
  readonly name = "groq";
  private fetchImpl: typeof fetch;
  private apiKey?: string;
  private modelOverride?: string;

  constructor(config: GroqProviderConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.apiKey = config.apiKey;
    this.modelOverride = config.model;
  }

  private key(): string | undefined {
    return this.apiKey ?? process.env.GROQ_API_KEY?.trim() ?? undefined;
  }

  private model(): string {
    return (
      this.modelOverride ??
      process.env.GROQ_MODEL?.trim() ??
      "llama-3.3-70b-versatile"
    );
  }

  isConfigured(): boolean {
    return !!this.key();
  }

  supportsTools(): boolean {
    return false;
  }

  private async call(
    system: string,
    user: string,
    options: AIGenerationOptions = {},
    jsonMode: boolean,
  ): Promise<AIGeneration> {
    const apiKey = this.key();
    if (!apiKey) {
      throw new AIProviderError(
        "NOT_CONFIGURED",
        "Groq is not configured. Set GROQ_API_KEY.",
      );
    }
    const model = options.model ?? this.model();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 2048,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
    } catch (err) {
      clearTimeout(timer);
      throw new AIProviderError(
        "PROVIDER_ERROR",
        `Could not reach Groq: ${err instanceof Error ? err.message : "network error"}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) {
      throw new AIProviderError("NOT_CONFIGURED", "Groq API key rejected. Check GROQ_API_KEY.");
    }
    if (res.status === 429) {
      // Surface Groq's rate-limit headers where present so callers can
      // back off honestly.
      const retryAfter = res.headers.get("retry-after");
      throw new AIProviderError(
        "PROVIDER_ERROR",
        `Groq rate limit hit.${retryAfter ? ` Retry after ${retryAfter}s.` : ""}`,
      );
    }
    if (!res.ok) {
      throw new AIProviderError("PROVIDER_ERROR", `Groq returned HTTP ${res.status}.`);
    }
    const data = (await res.json()) as GroqChatResponse;
    if (data.error) {
      throw new AIProviderError("PROVIDER_ERROR", `Groq API error: ${data.error.message ?? "unknown"}`);
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    return {
      text,
      model: data.model ?? model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async generateJson(
    system: string,
    user: string,
    options?: AIGenerationOptions,
  ): Promise<AIGeneration> {
    return this.call(system, user, options ?? {}, true);
  }

  async generateText(
    system: string,
    user: string,
    options?: AIGenerationOptions,
  ): Promise<AIGeneration> {
    return this.call(system, user, options ?? {}, false);
  }
}
