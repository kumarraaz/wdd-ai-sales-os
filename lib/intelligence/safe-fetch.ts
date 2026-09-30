/**
 * SSRF-hardened HTTP fetcher for website inspection (Phase 2 Step 2).
 *
 * Safety properties:
 * - Every URL (initial and every redirect hop) passes assertSafeUrl():
 *   http(s) only, no credentials, no localhost/loopback/private/link-local/
 *   internal hostnames, and DNS is resolved with every returned address
 *   checked.
 * - The actual TCP connection uses a custom DNS lookup that only returns
 *   validated addresses — the IP we checked is the IP we connect to
 *   (closes the resolve→connect TOCTOU / DNS-rebinding window).
 * - Redirects are followed manually (max 5), re-validating each Location.
 * - Strict per-hop timeout, total time budget, and response body cap.
 * - Only HTML content is read; binary content-types are rejected before
 *   the body is consumed.
 * - Plain GET requests only: no forms, no auth, no JS execution, no proxy
 *   rotation, no bot-protection bypass.
 */
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupOptions } from "node:dns";
import { assertSafeUrl, isBlockedIp, normalizeRecordAddress, SafeUrlError } from "../ssrf";

export type SafeFetchErrorCode =
  | "BLOCKED"
  | "DNS_FAILED"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "NETWORK_ERROR"
  | "NON_HTML"
  | "INVALID_REDIRECT";

export class SafeFetchError extends Error {
  code: SafeFetchErrorCode;
  /**
   * Technical cause for server-side logs. Never shown to users —
   * `message` is always the clean, user-facing text.
   */
  detail?: string;
  constructor(code: SafeFetchErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.detail = detail;
  }
}

export interface SafeFetchOptions {
  /** Per-hop timeout in ms. Default 10_000. */
  timeoutMs?: number;
  /** Max redirects to follow. Default 5. */
  maxRedirects?: number;
  /** Max response body in bytes. Default 2 MiB. */
  maxBodyBytes?: number;
  /**
   * Skip private-IP blocking. TESTS ONLY — never true in production code.
   * Lets integration tests run against a local HTTP server.
   */
  allowPrivate?: boolean;
  userAgent?: string;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface SafeFetchResult {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
  /** Decoded as UTF-8 (HTML is inspected as text, never executed). */
  body: string;
  bodyBytes: number;
  redirectChain: RedirectHop[];
  /** Total wall-clock ms for the document fetch across all hops. */
  timingMs: number;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; WDD-AI-Sales-OS-WebsiteInspector/1.0)";

function toSafeFetchError(err: unknown): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  if (err instanceof SafeUrlError) {
    const technical = err.message;
    const code: SafeFetchErrorCode = technical.includes("DNS") ? "DNS_FAILED" : "BLOCKED";
    const userMessage =
      code === "DNS_FAILED"
        ? "Website could not be resolved safely."
        : `Blocked URL: ${technical}`;
    return new SafeFetchError(code, userMessage, technical);
  }
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === "EBLOCKED") {
    return new SafeFetchError(
      "BLOCKED",
      "Website is not allowed.",
      "internal addresses are blocked",
    );
  }
  const raw = err instanceof Error ? err.message : "Network error";
  const isTimeout = /timed out|timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(raw);
  const code: SafeFetchErrorCode = isTimeout ? "TIMEOUT" : "NETWORK_ERROR";
  const userMessage = isTimeout
    ? "Website request timed out."
    : "Website could not be reached.";
  return new SafeFetchError(code, userMessage, raw);
}

/**
 * Custom DNS lookup for http.request: resolves the hostname and only hands
 * back addresses that pass the SSRF blocklist. Because Node connects to the
 * address this function returns, the validated IP is the connected IP
 * (closes the resolve→connect TOCTOU / DNS-rebinding window).
 *
 * Records are normalized defensively: malformed entries
 * (undefined/null/non-string addresses) are dropped, and the callback is
 * never invoked with an undefined address.
 */
function validatedLookup(allowPrivate: boolean) {
  return (
    hostname: string,
    _options: LookupOptions,
    callback: (err: Error | null, address: string, family: number) => void,
  ): void => {
    dnsLookup(hostname, { all: true }).then(
      (records) => {
        const candidates: { address: string; family: number }[] = [];
        for (const record of records ?? []) {
          const address = normalizeRecordAddress(record?.address);
          if (!address) continue;
          candidates.push({
            address,
            family: net.isIP(address) === 6 ? 6 : 4,
          });
        }
        const usable = allowPrivate
          ? candidates
          : candidates.filter((c) => !isBlockedIp(c.address));
        const first = usable[0];
        if (!first || typeof first.address !== "string" || !first.address) {
          const err = new Error("Internal addresses are blocked") as Error & {
            code: string;
          };
          err.code = "EBLOCKED";
          callback(err, "", 0);
          return;
        }
        callback(null, first.address, first.family);
      },
      (err: Error) => callback(err, "", 0),
    );
  };
}

/**
 * Exported for unit tests only — production code uses validatedLookup via
 * http.request's `lookup` option inside requestOnce().
 */
export const validatedLookupForTests = validatedLookup;

interface HopResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(
  url: URL,
  opts: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBodyBytes" | "allowPrivate">> &
    Pick<SafeFetchOptions, "userAgent">,
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    // autoSelectFamily is a net.connect option that http.request passes
    // through at runtime (not present in @types/node's RequestOptions).
    const requestOptions: http.RequestOptions & { autoSelectFamily?: boolean } = {
      method: "GET",
      headers: {
        "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      lookup: validatedLookup(opts.allowPrivate),
      // Happy Eyeballs (autoSelectFamily) is incompatible with a custom
      // lookup: on Node 24 it throws "Invalid IP address: undefined"
      // internally even when the lookup returns a valid IP. We connect
      // to exactly one pre-validated IP, so no family racing is needed —
      // and skipping it keeps the validated-IP-is-the-connected-IP
      // guarantee airtight.
      autoSelectFamily: false,
      timeout: opts.timeoutMs,
    };
    const req = lib.request(
      url,
      requestOptions,
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let settled = false;
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          req.destroy();
          reject(err);
        };
        // Refuse to download a huge body before it starts.
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > opts.maxBodyBytes) {
          fail(new SafeFetchError("TOO_LARGE", "Response body exceeds the size limit"));
          return;
        }
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > opts.maxBodyBytes) {
            fail(new SafeFetchError("TOO_LARGE", "Response body exceeds the size limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", fail);
      },
    );
    req.on("timeout", () => {
      req.destroy(new SafeFetchError("TIMEOUT", "Website request timed out."));
    });
    req.on("error", (err) => {
      reject(toSafeFetchError(err));
    });
    req.end();
  });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch an HTML document through the full SSRF pipeline. Throws
 * SafeFetchError on any safety violation or fetch failure — messages are
 * clean and user-facing; technical causes are on `error.detail`.
 */
export async function safeFetchHtml(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBodyBytes = options.maxBodyBytes ?? 2 * 1024 * 1024;
  const allowPrivate = options.allowPrivate ?? false;

  const requestedUrl = await assertSafeUrl(rawUrl, { allowPrivate }).catch((err: unknown) => {
    throw toSafeFetchError(err);
  });
  const redirectChain: RedirectHop[] = [];
  let current = new URL(requestedUrl);
  const startedAt = Date.now();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let hopResult: HopResult;
    try {
      hopResult = await requestOnce(current, {
        timeoutMs,
        maxBodyBytes,
        allowPrivate,
        userAgent: options.userAgent,
      });
    } catch (err) {
      throw toSafeFetchError(err);
    }

    if (REDIRECT_STATUSES.has(hopResult.status)) {
      if (hop === maxRedirects) {
        throw new SafeFetchError("TOO_MANY_REDIRECTS", "Too many redirects");
      }
      const location = hopResult.headers.location;
      if (!location) {
        throw new SafeFetchError("INVALID_REDIRECT", "Redirect without Location header");
      }
      redirectChain.push({ url: current.toString(), status: hopResult.status });
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new SafeFetchError("INVALID_REDIRECT", "Invalid redirect Location");
      }
      // Re-validate the redirect target before following it — a redirect
      // to a private/internal address is blocked here.
      const safeNext = await assertSafeUrl(next.toString(), { allowPrivate }).catch(
        (err: unknown) => {
          throw toSafeFetchError(err);
        },
      );
      current = new URL(safeNext);
      continue;
    }

    // Final response.
    const contentType = hopResult.headers["content-type"] ?? null;
    const ct = (Array.isArray(contentType) ? contentType[0] : contentType) ?? "";
    const isHtml =
      ct === "" ||
      ct.includes("text/html") ||
      ct.includes("application/xhtml+xml");
    if (!isHtml) {
      throw new SafeFetchError("NON_HTML", `Not an HTML document (${ct || "unknown type"})`);
    }

    return {
      requestedUrl,
      finalUrl: current.toString(),
      httpStatus: hopResult.status,
      contentType: ct || null,
      body: hopResult.body.toString("utf-8"),
      bodyBytes: hopResult.body.length,
      redirectChain,
      timingMs: Date.now() - startedAt,
    };
  }

  throw new SafeFetchError("TOO_MANY_REDIRECTS", "Too many redirects");
}

/**
 * Lightweight availability probe: GET the URL through the same SSRF
 * pipeline and report the final status without keeping the body.
 * Used for robots.txt / sitemap.xml / favicon.ico checks.
 */
export async function safeFetchStatus(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<{ url: string; finalUrl: string; status: number }> {
  const requestedUrl = await assertSafeUrl(rawUrl, {
    allowPrivate: options.allowPrivate ?? false,
  }).catch((err: unknown) => {
    // Safety violations surface as errors, never as silent "unavailable".
    throw toSafeFetchError(err);
  });

  const result = await safeFetchHtml(requestedUrl, {
    ...options,
    // Small body is enough — we only care about the status code.
    maxBodyBytes: 64 * 1024,
    timeoutMs: options.timeoutMs ?? 8_000,
    maxRedirects: options.maxRedirects ?? 3,
  }).catch((err: unknown) => {
    if (err instanceof SafeFetchError && err.code === "BLOCKED") throw err;
    // Network-level failure (DNS, timeout, refused, non-HTML…): treat as
    // unavailable rather than failing the whole inspection.
    return null;
  });

  if (!result) {
    return { url: requestedUrl, finalUrl: requestedUrl, status: 0 };
  }
  return { url: result.requestedUrl, finalUrl: result.finalUrl, status: result.httpStatus };
}
