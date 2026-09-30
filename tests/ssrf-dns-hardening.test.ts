/**
 * DNS/IP hardening tests for website inspection (SSRF layer).
 *
 * - No live network calls: node:dns/promises is mocked, and safeFetchHtml
 *   tests run against a local loopback server.
 * - SSRF protection stays fully enabled: every "blocked" case below must
 *   fail closed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

import {
  assertSafeUrl,
  isBlockedIp,
  normalizeRecordAddress,
  SafeUrlError,
} from "../lib/ssrf";
import {
  safeFetchHtml,
  SafeFetchError,
  validatedLookupForTests,
} from "../lib/intelligence/safe-fetch";

beforeEach(() => {
  mockLookup.mockReset();
});

// Direct TCP connections to the loopback test server only work when the
// process did NOT start with HTTP(S)_PROXY set — Node captures proxy config
// at startup and routes fake hostnames through the proxy, bypassing the
// custom DNS lookup under test.
const DIRECT_CONNECT_OK = !["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].some(
  (v) => !!process.env[v],
);

// ---------------------------------------------------------------------------
describe("isBlockedIp — defensive blocking", () => {
  it("allows valid public IPv4", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
  });

  it("allows valid public IPv6", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
  });

  it("allows IPv4-mapped public IPv6", () => {
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("blocks private IPv4 ranges", () => {
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("172.16.9.9")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.100.200.3")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("blocks link-local (incl. cloud metadata)", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("169.254.10.20")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("blocks metadata-ish CGNAT range", () => {
    expect(isBlockedIp("100.100.100.200")).toBe(true);
  });

  it("blocks private IPv6 ranges", () => {
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
  });

  it("blocks IPv4-mapped private IPv6", () => {
    expect(isBlockedIp("::ffff:10.0.0.5")).toBe(true);
    expect(isBlockedIp("::ffff:192.168.1.1")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
  });

  it("fails closed on undefined/null/non-string runtime input", () => {
    const hostile: unknown[] = [undefined, null, 123, {}, [], true];
    for (const h of hostile) {
      expect(() => isBlockedIp(h)).not.toThrow();
      expect(isBlockedIp(h)).toBe(true);
    }
  });

  it("fails closed on empty or malformed strings", () => {
    const malformed = ["", "   ", "not-an-ip", "999.999.999.999", "1.2.3", "::ffff:zzz"];
    for (const m of malformed) {
      expect(() => isBlockedIp(m)).not.toThrow();
      expect(isBlockedIp(m)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("normalizeRecordAddress", () => {
  it("trims and keeps valid IPs", () => {
    expect(normalizeRecordAddress("  8.8.8.8  ")).toBe("8.8.8.8");
    expect(normalizeRecordAddress("2606:4700:4700::1111")).toBe("2606:4700:4700::1111");
  });

  it("returns null for non-string, empty, or malformed values", () => {
    const bad: unknown[] = [undefined, null, 123, {}, "", "   ", "garbage", "999.1.1.1"];
    for (const b of bad) {
      expect(normalizeRecordAddress(b)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
describe("assertSafeUrl — DNS record hardening (mocked DNS)", () => {
  it("accepts a normal IPv4 DNS result", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const url = await assertSafeUrl("https://example.com/page");
    expect(url).toContain("https://example.com");
  });

  it("accepts a normal IPv6 DNS result", async () => {
    mockLookup.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }]);
    const url = await assertSafeUrl("https://example.com/page");
    expect(url).toContain("https://example.com");
  });

  it("accepts a mixed IPv4 + IPv6 DNS result", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    const url = await assertSafeUrl("https://example.com/page");
    expect(url).toContain("https://example.com");
  });

  it("rejects an empty DNS result with a clean DNS error", async () => {
    mockLookup.mockResolvedValue([]);
    await expect(assertSafeUrl("https://example.com/")).rejects.toThrow("DNS resolution failed");
  });

  it("rejects when every record is malformed", async () => {
    mockLookup.mockResolvedValue([
      { address: undefined, family: 4 },
      { address: null, family: 4 },
      { address: "garbage", family: 4 },
    ]);
    await expect(assertSafeUrl("https://example.com/")).rejects.toThrow("DNS resolution failed");
  });

  it("regression: undefined/malformed DNS addresses never surface 'Invalid IP address: undefined'", async () => {
    mockLookup.mockResolvedValue([
      { address: undefined, family: 4 },
      { address: "93.184.216.34", family: 4 },
    ]);
    // Malformed record is ignored; the valid one is used.
    const url = await assertSafeUrl("https://oddway.example/");
    expect(url).toContain("https://oddway.example");

    mockLookup.mockResolvedValue([{ address: undefined, family: 4 }]);
    const err = await assertSafeUrl("https://oddway.example/").catch((e) => e);
    expect(err).toBeInstanceOf(SafeUrlError);
    expect(err.message).not.toMatch(/Invalid IP address/);
    expect(err.message).toBe("DNS resolution failed");
  });

  it("still blocks when any resolved address is private", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(assertSafeUrl("https://example.com/")).rejects.toThrow(
      "Internal addresses are blocked",
    );
  });

  it("maps a lookup failure to a clean DNS error", async () => {
    mockLookup.mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND example.com"), { code: "ENOTFOUND" }),
    );
    await expect(assertSafeUrl("https://example.com/")).rejects.toThrow("DNS resolution failed");
  });
});

// ---------------------------------------------------------------------------
// Local loopback server for validatedLookup / safeFetchHtml behavior tests.
let server: http.Server;
let port: number;

// This sandbox routes outbound HTTP through an egress proxy
// (NODE_USE_ENV_PROXY=1). These tests must connect directly to the
// loopback server, so proxy env is disabled for their duration.
const PROXY_ENV_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NODE_USE_ENV_PROXY",
];
const savedProxyEnv: Record<string, string | undefined> = {};
let savedKeepAlive: boolean | undefined;

const HTML = `<!doctype html><html><head><title>Local</title></head><body><h1>hi</h1></body></html>`;

beforeAll(async () => {
  for (const v of PROXY_ENV_VARS) {
    savedProxyEnv[v] = process.env[v];
    delete process.env[v];
  }
  // Node 24's global agent keeps sockets alive by default; pooled sockets
  // would bypass the custom DNS lookup under test (same origin). Disable
  // keep-alive so every request makes a fresh, validated connection.
  // (keepAlive exists at runtime on the global agent; the type doesn't
  // expose it, hence the cast.)
  const agent = http.globalAgent as unknown as { keepAlive: boolean };
  savedKeepAlive = agent.keepAlive;
  agent.keepAlive = false;
  server = http.createServer((req, res) => {
    if ((req.url ?? "/") === "/hang") {
      // Never respond — used for the timeout test.
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const v of PROXY_ENV_VARS) {
    if (savedProxyEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedProxyEnv[v];
  }
  if (savedKeepAlive !== undefined) {
    (http.globalAgent as unknown as { keepAlive: boolean }).keepAlive = savedKeepAlive;
  }
});

describe("validatedLookup (direct unit tests, mocked DNS)", () => {
  function runLookup(allowPrivate: boolean) {
    return new Promise<{ err: Error | null; address: unknown; family: unknown }>(
      (resolve) => {
        validatedLookupForTests(allowPrivate)("some.host", {}, (err, address, family) => {
          resolve({ err, address, family });
        });
      },
    );
  }

  it("returns a validated public IP and never undefined", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const { err, address, family } = await runLookup(false);
    expect(err).toBeNull();
    expect(address).toBe("93.184.216.34");
    expect(typeof address).toBe("string");
    expect(family).toBe(4);
  });

  it("skips malformed records and uses the first valid one", async () => {
    mockLookup.mockResolvedValue([
      { address: undefined, family: 4 },
      { address: null, family: 4 },
      { address: "garbage", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ]);
    const { err, address } = await runLookup(false);
    expect(err).toBeNull();
    expect(address).toBe("93.184.216.34");
  });

  it("never calls the callback with an undefined address", async () => {
    mockLookup.mockResolvedValue([{ address: undefined, family: 4 }]);
    const { err, address } = await runLookup(false);
    expect(err).not.toBeNull();
    expect((err as NodeJS.ErrnoException).code).toBe("EBLOCKED");
    expect(address).not.toBeUndefined();
  });

  it("blocks a private resolved address (EBLOCKED, fail closed)", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const { err, address } = await runLookup(false);
    expect((err as NodeJS.ErrnoException)?.code).toBe("EBLOCKED");
    expect(address).toBe("");
  });

  it("blocks IPv4-mapped private IPv6 at connect time", async () => {
    mockLookup.mockResolvedValue([{ address: "::ffff:169.254.169.254", family: 6 }]);
    const { err } = await runLookup(false);
    expect((err as NodeJS.ErrnoException)?.code).toBe("EBLOCKED");
  });

  it("propagates DNS lookup failures to the callback", async () => {
    const dnsErr = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    mockLookup.mockRejectedValue(dnsErr);
    const { err } = await runLookup(false);
    expect(err).toBe(dnsErr);
  });

  it("allowPrivate passes through validated (non-malformed) addresses unfiltered", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const { err, address } = await runLookup(true);
    expect(err).toBeNull();
    expect(address).toBe("10.0.0.5");
  });
});

describe("validatedLookup via safeFetchHtml (mocked DNS, local server)", () => {
  // These tests make direct TCP connections to a loopback server through a
  // fake hostname resolved by mocked DNS. If the process started with
  // HTTP(S)_PROXY set, Node routes such requests through the proxy (which
  // bypasses the custom lookup), so they are skipped there — run with the
  // proxy env unset to execute them. The validatedLookup unit tests above
  // cover the same logic without any network.
  const describeDirect = DIRECT_CONNECT_OK ? describe : describe.skip;

  describeDirect("direct-connection behavior", () => {
  // NOTE: hostname is a fake name (not an IP literal) so Node exercises
  // the custom lookup; run these with proxy env unset (see above).
  const base = () => `http://test.invalid:${port}/`;

  it("connects using the validated IP (TOCTOU protection intact)", async () => {
    mockLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const result = await safeFetchHtml(base(), {
      allowPrivate: true,
      timeoutMs: 5000,
    });
    expect(mockLookup).toHaveBeenCalled();
    expect(result.httpStatus).toBe(200);
    expect(result.body).toContain("<h1>hi</h1>");
  });

  it("regression: valid lookup result no longer throws 'Invalid IP address: undefined'", async () => {
    // Reproduces the production failure: on Node 24, http.request's
    // Happy Eyeballs (autoSelectFamily) threw "Invalid IP address:
    // undefined" internally even though validatedLookup returned a valid
    // IP. requestOnce now disables autoSelectFamily.
    mockLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const result = await safeFetchHtml(base(), {
      allowPrivate: true,
      timeoutMs: 5000,
    });
    expect(result.httpStatus).toBe(200);
  });

  it("connects to exactly the validated IP, not real DNS (negative control)", async () => {
    // Mock says 127.0.0.2, where nothing listens. If Node connected via
    // real DNS (localhost -> 127.0.0.1), this would succeed — it must fail,
    // proving the validated IP is the connected IP.
    mockLookup.mockResolvedValue([{ address: "127.0.0.2", family: 4 }]);
    const err = await safeFetchHtml(base(), {
      allowPrivate: true,
      timeoutMs: 3000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("malformed DNS records are skipped, valid one is used", async () => {
    mockLookup.mockResolvedValue([
      { address: undefined, family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const result = await safeFetchHtml(base(), {
      allowPrivate: true,
      timeoutMs: 5000,
    });
    expect(result.httpStatus).toBe(200);
  });

  it("fails closed with a clean message when DNS returns no usable addresses", async () => {
    mockLookup.mockResolvedValue([{ address: undefined, family: 4 }]);
    const err = await safeFetchHtml(base(), {
      timeoutMs: 5000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err.code).toBe("DNS_FAILED");
    expect(err.message).toBe("Website could not be resolved safely.");
    expect(err.message).not.toMatch(/Invalid IP address/);
  });
  }); // describeDirect("direct-connection behavior")
});

(DIRECT_CONNECT_OK ? describe : describe.skip)(
  "safeFetchHtml — clean user-facing error messages",
  () => {
  const base = () => `http://test.invalid:${port}/`;

  it("reports a clean timeout message", async () => {
    mockLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const err = await safeFetchHtml(`${base()}hang`, {
      allowPrivate: true,
      timeoutMs: 300,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toBe("Website request timed out.");
  });

  it("reports a clean network-failure message and keeps technical detail internal", async () => {
    mockLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const err = await safeFetchHtml("http://test.invalid:1/", {
      allowPrivate: true,
      timeoutMs: 3000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).toBe("Website could not be reached.");
    expect(err.message).not.toMatch(/ECONNREFUSED|Invalid IP address/);
    // Technical cause is preserved for server logs, not for users.
    expect(typeof err.detail).toBe("string");
    expect(err.detail.length).toBeGreaterThan(0);
    expect(err.detail).not.toBe(err.message);
  });
  },
);
