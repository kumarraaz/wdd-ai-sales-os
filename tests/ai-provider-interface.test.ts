/**
 * AI provider interface contract tests (Layer 1).
 *
 * Verifies that GeminiProvider satisfies the transport-agnostic AIProvider
 * contract via delegation to the existing implementation. No live network
 * calls: fetch is injected.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { AIProvider } from "../lib/ai/provider";
import { AIProviderError } from "../lib/ai/provider";
import { GeminiProvider } from "../lib/ai/providers/gemini";

const TEST_KEY = "test-key-123";

function mockGeminiFetch(
  body: unknown,
  onRequest?: (url: string, init: RequestInit) => void,
) {
  return vi.fn(async (url: string, init: RequestInit) => {
    onRequest?.(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function asFetch(fn: ReturnType<typeof mockGeminiFetch>): typeof fetch {
  return fn as unknown as typeof fetch;
}

function jsonBody(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("AIProvider contract", () => {
  it("GeminiProvider satisfies the interface", () => {
    const provider: AIProvider = new GeminiProvider({ apiKey: TEST_KEY });
    expect(provider.name).toBe("gemini");
    expect(typeof provider.isConfigured).toBe("function");
    expect(typeof provider.generateJson).toBe("function");
    expect(typeof provider.generateText).toBe("function");
    expect(provider.supportsTools()).toBe(false);
    // Streaming is optional and not implemented in Phase 1.
    expect(provider.stream).toBeUndefined();
  });

  it("isConfigured() is false without a key and true with one", () => {
    expect(new GeminiProvider().isConfigured()).toBe(false);
    expect(new GeminiProvider({ apiKey: TEST_KEY }).isConfigured()).toBe(true);
    expect(new GeminiProvider({ apiKey: "   " }).isConfigured()).toBe(false);
  });

  it("generateJson delegates and returns the agnostic result shape", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit = {};
    const fetchImpl = asFetch(mockGeminiFetch(jsonBody('{"ok":true}'), (url, init) => {
      capturedUrl = url;
      capturedInit = init;
    }));
    const provider = new GeminiProvider({ fetchImpl, apiKey: TEST_KEY });
    const result = await provider.generateJson("sys", "user", { model: "gemini-2.0-flash" });

    expect(result.text).toBe('{"ok":true}');
    expect(result.model).toBe("gemini-2.0-flash");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    // Existing REST behavior preserved: model in URL, key via header.
    expect(capturedUrl).toContain("gemini-2.0-flash");
    expect(capturedUrl).toContain("generativelanguage.googleapis.com");
    expect((capturedInit.headers as Record<string, string>)["x-goog-api-key"]).toBe(TEST_KEY);
    // The key never appears in the URL or the returned payload.
    expect(capturedUrl).not.toContain(TEST_KEY);
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });

  it("generateJson honors AI_MODEL-style model override", async () => {
    const rawMock = mockGeminiFetch(jsonBody("{}"));
    const provider = new GeminiProvider({ fetchImpl: asFetch(rawMock), apiKey: TEST_KEY });
    const result = await provider.generateJson("sys", "user", { model: "custom-model" });
    expect(result.model).toBe("custom-model");
    expect(rawMock).toHaveBeenCalled();
    const url = (rawMock.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain(encodeURIComponent("custom-model"));
  });

  it("generateText requests plain text and returns it", async () => {
    let capturedBody = "";
    const fetchImpl = asFetch(mockGeminiFetch(jsonBody("hello world"), (_url, init) => {
      capturedBody = init.body as string;
    }));
    const provider = new GeminiProvider({ fetchImpl, apiKey: TEST_KEY });
    const result = await provider.generateText("sys", "user");

    expect(result.text).toBe("hello world");
    expect(result.model).toBe("gemini-2.0-flash"); // AI_MODEL default preserved
    const parsed = JSON.parse(capturedBody) as {
      generationConfig: { responseMimeType: string };
    };
    expect(parsed.generationConfig.responseMimeType).toBe("text/plain");
  });

  it("generateText maps maxTokens to maxOutputTokens", async () => {
    let capturedBody = "";
    const fetchImpl = asFetch(mockGeminiFetch(jsonBody("hi"), (_url, init) => {
      capturedBody = init.body as string;
    }));
    const provider = new GeminiProvider({ fetchImpl, apiKey: TEST_KEY });
    await provider.generateText("sys", "user", { maxTokens: 100 });
    const parsed = JSON.parse(capturedBody) as {
      generationConfig: { maxOutputTokens?: number };
    };
    expect(parsed.generationConfig.maxOutputTokens).toBe(100);
  });

  it("throws NOT_CONFIGURED without a key (shared error class)", async () => {
    const provider = new GeminiProvider({
      fetchImpl: asFetch(mockGeminiFetch(jsonBody("{}"))),
    });
    const err = await provider.generateJson("s", "u").catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderError);
    expect(err.code).toBe("NOT_CONFIGURED");

    const textErr = await provider.generateText("s", "u").catch((e) => e);
    expect(textErr).toBeInstanceOf(AIProviderError);
    expect(textErr.code).toBe("NOT_CONFIGURED");
  });

  it("maps HTTP errors to PROVIDER_ERROR without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const provider = new GeminiProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiKey: TEST_KEY,
    });
    const err = await provider.generateText("s", "u").catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderError);
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(String(err.message)).not.toContain(TEST_KEY);
  });

  it("maps empty model output to INVALID_RESPONSE", async () => {
    const fetchImpl = asFetch(mockGeminiFetch({ candidates: [] }));
    const provider = new GeminiProvider({ fetchImpl, apiKey: TEST_KEY });
    const err = await provider.generateText("s", "u").catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderError);
    expect(err.code).toBe("INVALID_RESPONSE");
  });

  it("never exposes the API key in results or provider-shaped errors", async () => {
    const fetchImpl = asFetch(mockGeminiFetch(jsonBody('{"a":1}')));
    const provider = new GeminiProvider({ fetchImpl, apiKey: TEST_KEY });
    const ok = await provider.generateJson("s", "u");
    expect(JSON.stringify(ok)).not.toContain(TEST_KEY);

    // All provider-shaped errors (codes/messages) carry no key material.
    const notConfigured = await new GeminiProvider().generateJson("s", "u").catch((e) => e);
    expect(JSON.stringify(notConfigured)).not.toContain("test-key");
    const badFetch = vi.fn(async () => new Response("nope", { status: 429 }));
    const rateLimited = await new GeminiProvider({
      fetchImpl: badFetch as unknown as typeof fetch,
      apiKey: TEST_KEY,
    })
      .generateText("s", "u")
      .catch((e) => e);
    expect(rateLimited.code).toBe("PROVIDER_ERROR");
    expect(String(rateLimited.message)).not.toContain(TEST_KEY);
  });
});
