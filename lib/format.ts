export function inr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

export function num(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

export function pct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
