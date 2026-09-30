import * as net from "node:net";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/**
 * SSRF protection for user-supplied URLs (lead websites, enrichment targets…).
 * Blocks: non-http(s) schemes, localhost, loopback, private ranges,
 * link-local (cloud metadata 169.254.169.254), and resolves DNS to catch
 * hostnames that point at internal addresses (basic DNS-rebinding mitigation).
 * Throws SafeUrlError on rejection; returns the normalized URL otherwise.
 */

export class SafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeUrlError";
  }
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_CIDRS = [
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // private
  "172.16.0.0/12", // private
  "192.168.0.0/16", // private
  "169.254.0.0/16", // link-local incl. cloud metadata
  "0.0.0.0/8", // current network
  "100.64.0.0/10", // carrier-grade NAT
  "192.0.2.0/24", // documentation
  "198.51.100.0/24", // documentation
  "203.0.113.0/24", // documentation
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
  "instance-data",
]);

/** True when an IP literal must never be connected to (SSRF guard). */
export function isBlockedIp(ip: unknown): boolean {
  // Fail closed: anything that is not a verifiable IP string is blocked.
  // Runtime data (DNS records, network input) is never trusted to match
  // the TypeScript signature.
  if (typeof ip !== "string") return true;
  const trimmed = ip.trim();
  if (!trimmed) return true;
  // Strict literal check — rejects ambiguous forms like "1.2.3" that some
  // parsers accept but Node itself does not treat as an IP.
  if (net.isIP(trimmed) === 0) return true;
  const lower = trimmed.toLowerCase();
  if (lower === "::1" || lower === "::ffff:127.0.0.1") return true;

  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    // Malformed input must never reach the parser unguarded, and a parser
    // throw must never escape as a "safe" verdict.
    if (!ipaddr.isValid(trimmed)) return true;
    parsed = ipaddr.parse(trimmed);
  } catch {
    return true;
  }

  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — judge the embedded IPv4 address.
    if (v6.isIPv4MappedAddress()) {
      return BLOCKED_CIDRS.some((cidr) => inCidr(v6.toIPv4Address().toString(), cidr));
    }
    return parsed.range() !== "unicast";
  }
  return BLOCKED_CIDRS.some((cidr) => inCidr(trimmed, cidr));
}

/**
 * Normalize one raw DNS record address to a verifiable IP string.
 * Returns null for undefined/null/non-string/empty/malformed values —
 * callers must ignore these, never feed them to IP parsing.
 */
export function normalizeRecordAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Strict: only real IP literals (net.isIP), so ambiguous forms are
  // dropped instead of being passed to IP parsing.
  if (net.isIP(trimmed) === 0) return null;
  try {
    if (!ipaddr.isValid(trimmed)) return null;
  } catch {
    return null;
  }
  return trimmed;
}

export async function assertSafeUrl(raw: string, opts: { allowPrivate?: boolean } = {}): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SafeUrlError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeUrlError("Only http(s) URLs are allowed");
  }
  if (url.username || url.password) throw new SafeUrlError("Credentials in URL are not allowed");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new SafeUrlError("Blocked host");

  if (opts.allowPrivate) return url.toString();

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new SafeUrlError("Internal addresses are blocked");
    return url.toString();
  }

  // Resolve and check every returned address. DNS records are normalized
  // defensively: some environments return malformed records
  // (undefined/null/non-string addresses) — those are ignored, never
  // passed to IP parsing, and never treated as safe.
  let records: { address?: unknown }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new SafeUrlError("DNS resolution failed");
  }
  const addresses: string[] = [];
  for (const record of records ?? []) {
    const normalized = normalizeRecordAddress(record?.address);
    if (normalized) addresses.push(normalized);
  }
  // No usable addresses at all — DNS did not resolve to anything we can
  // safely verify. Fail closed, do not treat as a public IP.
  if (addresses.length === 0) {
    throw new SafeUrlError("DNS resolution failed");
  }
  if (addresses.some(isBlockedIp)) {
    throw new SafeUrlError("Internal addresses are blocked");
  }
  return url.toString();
}

/** Normalize a domain for dedup: lowercase, strip www., trailing dot, port. */
export function normalizeDomain(raw: string): string | null {
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    let host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("www.")) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}

/** Normalize phone for dedup: keep digits and leading +. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return raw.trim().startsWith("+") ? `+${digits}` : digits;
}
