/**
 * Transport-agnostic AI provider interface (Layer 1 — AI Provider).
 *
 * This module defines the contract every AI provider must satisfy. It is
 * deliberately free of provider-specific concepts: no Gemini model names,
 * no Gemini request/response shapes, no API-key handling. Providers are
 * server-side only — resolution happens via lib/ai/registry.ts from
 * operator configuration (environment), never from client input.
 *
 * Compatibility note (Phase 1): the error class is re-exported from the
 * existing implementation so that `instanceof AIProviderError` checks in
 * current callers (lib/intelligence/generate.ts, scoring-ai.ts) keep
 * working. A future phase may relocate the error type here without
 * changing its shape.
 */

export { AIProviderError } from "../intelligence/ai-provider";
export type { AIProviderErrorCode } from "../intelligence/ai-provider";

/** Transport-agnostic generation options. No provider-specific fields. */
export interface AIGenerationOptions {
  /** Provider-specific model identifier. Semantics: model *within* the selected provider. */
  model?: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Sampling temperature, 0..2 where supported. */
  temperature?: number;
  /** Maximum output tokens where supported. */
  maxTokens?: number;
}

/** Transport-agnostic generation result. */
export interface AIGeneration {
  /** Raw model text. For generateJson, expected to be JSON (validated by the caller). */
  text: string;
  /** Model identifier that produced the result, as reported by the provider. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** One streamed chunk. */
export interface AIStreamChunk {
  textDelta: string;
  done: boolean;
}

/**
 * The AI provider contract.
 *
 * - generateJson: model must return JSON text; the caller validates it
 *   against a schema (this interface never trusts model output).
 * - generateText: free-form text generation.
 * - stream: optional; providers that do not support streaming simply omit it.
 * - supportsTools: whether the provider supports native tool/function
 *   calling. Phase 1 providers return false (tool calling is out of scope).
 * - name: stable provider identifier, e.g. "gemini".
 */
export interface AIProvider {
  readonly name: string;
  /** True when the provider has the credentials/config it needs. Never throws. */
  isConfigured(): boolean;
  generateJson(
    system: string,
    user: string,
    options?: AIGenerationOptions,
  ): Promise<AIGeneration>;
  generateText(
    system: string,
    user: string,
    options?: AIGenerationOptions,
  ): Promise<AIGeneration>;
  stream?(
    system: string,
    user: string,
    options?: AIGenerationOptions,
  ): AsyncIterable<AIStreamChunk>;
  supportsTools(): boolean;
}
