/**
 * AI provider registry tests (Layer 1).
 *
 * Provider selection is operator configuration (AI_PROVIDER env), never
 * client input. No live network calls.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_AI_PROVIDER,
  UnknownAIProviderError,
  getAIProvider,
  getConfiguredProviderName,
  listProviderNames,
  resolveAIProvider,
} from "../lib/ai/registry";
import { GeminiProvider } from "../lib/ai/providers/gemini";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI provider registry", () => {
  it("defaults to gemini when AI_PROVIDER is unset", () => {
    vi.stubEnv("AI_PROVIDER", "");
    expect(getConfiguredProviderName()).toBe("gemini");
    expect(DEFAULT_AI_PROVIDER).toBe("gemini");
  });

  it("getConfiguredProviderName trims and lowercases", () => {
    vi.stubEnv("AI_PROVIDER", "  Gemini ");
    expect(getConfiguredProviderName()).toBe("gemini");
  });

  it("resolves the default provider to a GeminiProvider", () => {
    vi.stubEnv("AI_PROVIDER", "");
    const provider = getAIProvider();
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe("gemini");
  });

  it("explicit AI_PROVIDER=gemini resolves Gemini", () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    const provider = resolveAIProvider();
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it("resolveAIProvider accepts an explicit server-side name", () => {
    const provider = resolveAIProvider("gemini");
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it("unknown provider names fail cleanly", () => {
    vi.stubEnv("AI_PROVIDER", "bogus-provider");
    const err = (() => {
      try {
        resolveAIProvider();
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(UnknownAIProviderError);
    expect((err as Error).message).toContain("bogus-provider");
    // The error message lists available providers, never secrets.
    expect((err as Error).message).not.toMatch(/key|secret|token/i);
  });

  it("unknown explicit names fail cleanly too", () => {
    expect(() => resolveAIProvider("openai")).toThrow(UnknownAIProviderError);
    expect(() => resolveAIProvider("")).toThrow(UnknownAIProviderError);
  });

  it("lists gemini among available providers", () => {
    expect(listProviderNames()).toContain("gemini");
  });

  it("resolved provider honors the AIProvider contract", () => {
    vi.stubEnv("AI_PROVIDER", "");
    const provider = getAIProvider();
    expect(typeof provider.generateJson).toBe("function");
    expect(typeof provider.generateText).toBe("function");
    expect(typeof provider.isConfigured).toBe("function");
    expect(typeof provider.supportsTools).toBe("function");
  });

  it("registry never reads or returns API keys", () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    const provider = getAIProvider();
    // No key material on the provider instance's public surface.
    expect(JSON.stringify(provider)).not.toMatch(/sk-|key/i);
    const keyLike = Object.entries(provider as unknown as Record<string, unknown>).filter(
      ([k, v]) => /key|secret|token/i.test(k) && typeof v === "string" && v.length > 0,
    );
    expect(keyLike).toHaveLength(0);
  });
});
