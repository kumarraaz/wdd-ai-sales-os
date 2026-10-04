/**
 * Instagram username utilities — pure functions, no network, no credentials.
 *
 * Instagram username rules: 1–30 chars, letters, numbers, periods,
 * underscores. Normalization strips a leading @, trims whitespace, and
 * lowercases. Nothing here touches Instagram's servers.
 */

/** Canonical public profile URL. Opening it is a plain browser navigation. */
export function instagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${username}/`;
}

export interface NormalizedUsername {
  ok: true;
  username: string;
}

export interface InvalidUsername {
  ok: false;
  raw: string;
  error: string;
}

export type UsernameResult = NormalizedUsername | InvalidUsername;

/**
 * Validate + normalize one raw line from the user's paste box.
 * Returns { ok: false } with a human-readable error for invalid input —
 * the caller reports it inline without failing the batch.
 */
export function normalizeUsername(raw: string): UsernameResult {
  const trimmed = raw.trim().replace(/^@+/, "").trim();
  if (!trimmed) return { ok: false, raw, error: "Empty line." };
  const username = trimmed.toLowerCase();
  if (username.length > 30)
    return { ok: false, raw, error: "Too long — Instagram usernames are at most 30 characters." };
  if (!/^[a-z0-9._]+$/.test(username))
    return {
      ok: false,
      raw,
      error: "Invalid characters — only letters, numbers, periods and underscores are allowed.",
    };
  return { ok: true, username };
}

export interface ParsedBatch {
  /** Unique, valid usernames in first-seen order. */
  usernames: string[];
  /** Raw lines that failed validation (shown inline, batch continues). */
  invalid: { raw: string; error: string }[];
  /** Duplicates removed (case-insensitive). */
  duplicatesRemoved: number;
}

/**
 * Parse a pasted batch (one username per line). Invalid lines and
 * duplicates never fail the batch — they are reported separately.
 */
export function parseUsernameBatch(text: string, max = 50): ParsedBatch {
  const usernames: string[] = [];
  const invalid: { raw: string; error: string }[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const result = normalizeUsername(line);
    if (!result.ok) {
      invalid.push({ raw: line.trim(), error: result.error });
      continue;
    }
    if (seen.has(result.username)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(result.username);
    usernames.push(result.username);
    if (usernames.length >= max) break;
  }

  return { usernames, invalid, duplicatesRemoved };
}
