/**
 * Canonical site URL resolution.
 *
 * NEXT_PUBLIC_SITE_URL may be set-but-empty in some hosting dashboards
 * (the variable exists with an empty value). `??` skips only null/undefined,
 * so a set-but-empty value would flow into `new URL("")` and crash page
 * prerendering. `||` falls back for empty strings too.
 */
export function resolveSiteUrl(
  env: { NEXT_PUBLIC_SITE_URL?: unknown } = process.env as { NEXT_PUBLIC_SITE_URL?: unknown },
): string {
  const raw = env.NEXT_PUBLIC_SITE_URL;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || "https://wdd-ai-sales-os.vercel.app";
}
