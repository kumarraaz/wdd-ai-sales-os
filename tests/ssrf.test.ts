import { describe, it, expect } from "vitest";
import { assertSafeUrl, normalizeDomain, normalizePhone, SafeUrlError } from "../lib/ssrf";

describe("assertSafeUrl — SSRF protection", () => {
  it("accepts normal public https URLs", async () => {
    const url = await assertSafeUrl("https://example.com/some/page");
    expect(url).toContain("https://example.com");
  });

  it("rejects non-http schemes", async () => {
    await expect(assertSafeUrl("ftp://example.com")).rejects.toBeInstanceOf(SafeUrlError);
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(SafeUrlError);
    await expect(assertSafeUrl("javascript:alert(1)")).rejects.toBeInstanceOf(SafeUrlError);
  });

  it("blocks localhost and loopback", async () => {
    await expect(assertSafeUrl("http://localhost:3000")).rejects.toBeInstanceOf(SafeUrlError);
    await expect(assertSafeUrl("http://127.0.0.1/admin")).rejects.toBeInstanceOf(SafeUrlError);
    await expect(assertSafeUrl("http://[::1]/")).rejects.toBeInstanceOf(SafeUrlError);
  });

  it("blocks private ranges", async () => {
    await expect(assertSafeUrl("http://10.0.0.5/")).rejects.toBeInstanceOf(SafeUrlError);
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toBeInstanceOf(SafeUrlError);
    await expect(assertSafeUrl("http://172.16.9.9/")).rejects.toBeInstanceOf(SafeUrlError);
  });

  it("blocks cloud metadata endpoints", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
    await expect(assertSafeUrl("http://metadata.google.internal/")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
  });

  it("blocks credentials embedded in URL", async () => {
    await expect(assertSafeUrl("https://user:pass@example.com")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
  });

  it("rejects garbage input", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toBeInstanceOf(SafeUrlError);
  });
});

describe("normalizeDomain — dedup helper", () => {
  it("strips www, case and trailing dot", () => {
    expect(normalizeDomain("https://WWW.Example.COM/path")).toBe("example.com");
    expect(normalizeDomain("example.com.")).toBe("example.com");
    expect(normalizeDomain("blog.example.com")).toBe("blog.example.com");
  });
  it("returns null for invalid input", () => {
    expect(normalizeDomain(":::")).toBe(null);
  });
});

describe("normalizePhone — dedup helper", () => {
  it("keeps digits with leading +", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("(022) 1234-5678")).toBe("02212345678");
  });
});
