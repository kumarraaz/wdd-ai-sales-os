/**
 * AI provider registry (Layer 1).
 *
 * Server-side only. Provider selection comes exclusively from operator
 * configuration (the AI_PROVIDER environment variable) and defaults to
 * "gemini". Never pass browser/client input as the provider name — there
 * is no API route that accepts one, and this module must stay that way.
 *
 * The registry never touches API keys; each provider reads its own
 * credentials server-side (see lib/ai/providers/gemini.ts).
 */
import type { AIProvider } from "./provider";
import { GeminiProvider } from "./providers/gemini";

/** Provider used when AI_PROVIDER is unset. */
export const DEFAULT_AI_PROVIDER = "gemini";

export class UnknownAIProviderError extends Error {
  constructor(name: string) {
    super(
      `Unknown AI provider: "${name}". Available providers: ${listProviderNames().join(", ")}.`,
    );
    this.name = "UnknownAIProviderError";
  }
}

/** Provider names available in this build. Grows as providers are added. */
export function listProviderNames(): string[] {
  return ["gemini"];
}

/**
 * The operator-configured provider name. Reads AI_PROVIDER once per call
 * (env is process-global); trims and lowercases; falls back to "gemini".
 * Never throws.
 */
export function getConfiguredProviderName(): string {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  return raw || DEFAULT_AI_PROVIDER;
}

/**
 * Resolve a provider by name. The name must originate from server-side
 * configuration (AI_PROVIDER) — never from client/browser input.
 * Unknown names fail cleanly with UnknownAIProviderError.
 */
export function resolveAIProvider(name?: string): AIProvider {
  const selected = (name ?? getConfiguredProviderName()).trim().toLowerCase();
  if (selected === "gemini") {
    return new GeminiProvider();
  }
  throw new UnknownAIProviderError(selected);
}

/** Convenience: resolve the operator-configured provider. */
export function getAIProvider(): AIProvider {
  return resolveAIProvider();
}
