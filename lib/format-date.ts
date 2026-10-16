/**
 * Server-side date formatting. Pages render in UTC and say so, so the same page shows the
 * same text to everyone and never depends on the server's time zone.
 */
export function formatUtcDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatUtcDateTime(d: Date): string {
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}
