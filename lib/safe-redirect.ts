/**
 * Post-login redirect targets come from a user-controlled query string
 * (`/login?next=...`), so they must never be able to leave this origin.
 *
 * Only same-origin, absolute *paths* are accepted. Anything else — full URLs,
 * protocol-relative `//host`, backslash tricks, control characters, `javascript:`
 * — falls back to the default. Edge-safe: no Node-only imports.
 */

const FALLBACK = "/dashboard";
const MAX_LENGTH = 512;
// Placeholder origin used only to let the URL parser prove the target stays local.
const PROBE_ORIGIN = "http://local.invalid";

export function safeNextPath(raw: string | null | undefined, fallback: string = FALLBACK): string {
  if (!raw || raw.length > MAX_LENGTH) return fallback;
  // Must be a single-slash absolute path. `//host` and `/\host` are treated by
  // browsers as protocol-relative URLs.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  // Tabs/newlines/etc. are stripped by URL parsers, which can turn `/\t/evil.com` into `//evil.com`.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
