/**
 * Gemini AI provider (Phase 2 Step 3) — server-side only.
 *
 * - Calls the Gemini generateContent REST API with plain fetch (no SDK).
 * - The API key is read from GEMINI_API_KEY and NEVER leaves the server:
 *   it is never sent to the browser, never logged, and never included in
 *   prompts.
 * - fetch is injectable so tests can mock the provider without live calls.
 */
export type AIProviderErrorCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE";

export class AIProviderError extends Error {
  code: AIProviderErrorCode;
  constructor(code: AIProviderErrorCode, message: string) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
  }
}

export interface AIGenerateOptions {
  /** Model name. Default: gemini-2.0-flash. */
  model?: string;
  /** Request timeout in ms. Default 45_000. */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
  /** API key override (tests). Defaults to process.env.GEMINI_API_KEY. */
  apiKey?: string;
}

export interface AIGenerateResult {
  /** Raw model text (expected to be JSON). */
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

const DEFAULT_MODEL = "gemini-2.0-flash";

export function getAIModelName(): string {
  return process.env.AI_MODEL ?? DEFAULT_MODEL;
}

/** True when a Gemini key is configured. Never throws. */
export function isAIConfigured(apiKey?: string): boolean {
  return Boolean((apiKey ?? process.env.GEMINI_API_KEY)?.trim());
}

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string; code?: number };
}

/**
 * Generate JSON from Gemini. The caller is responsible for validating the
 * returned text against a Zod schema — this function never trusts it.
 */
export async function generateJson(
  systemInstruction: string,
  userPrompt: string,
  options: AIGenerateOptions = {},
): Promise<AIGenerateResult> {
  const apiKey = (options.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
  if (!apiKey) {
    throw new AIProviderError(
      "NOT_CONFIGURED",
      "AI Intelligence is not configured.",
    );
  }
  const model = options.model ?? getAIModelName();
  const timeoutMs = options.timeoutMs ?? 45_000;
  const fetchImpl = options.fetchImpl ?? fetch;

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
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
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

  let data: GeminiResponse;
  try {
    data = (await res.json()) as GeminiResponse;
  } catch {
    throw new AIProviderError("INVALID_RESPONSE", "AI provider returned invalid JSON.");
  }
  if (data.error) {
    throw new AIProviderError(
      "PROVIDER_ERROR",
      "AI provider returned an error.",
    );
  }

  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) {
    throw new AIProviderError("INVALID_RESPONSE", "AI provider returned no content.");
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
