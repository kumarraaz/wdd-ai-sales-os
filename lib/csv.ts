/**
 * CSV writing for exports. Lead fields come from third parties (discovery providers,
 * imported files), so a value like `=HYPERLINK("http://evil","click")` must not turn into a
 * live spreadsheet formula when the file is opened in Excel/Sheets ("CSV injection").
 * Cells that could be read as a formula get a leading apostrophe; plain phone numbers
 * and numbers (+91 98765 43210, -12.5) are left untouched so exports stay faithful.
 */

const PLAIN_NUMBER = /^[+-]?[\d\s().,-]+$/;

export function neutraliseFormula(text: string): string {
  if (text === "") return text;
  const first = text[0];
  if (first === "=" || first === "@" || first === "\t" || first === "\r") return `'${text}`;
  if ((first === "+" || first === "-") && !PLAIN_NUMBER.test(text)) return `'${text}`;
  return text;
}

export function csvCell(value: unknown): string {
  const text = neutraliseFormula(value === null || value === undefined ? "" : String(value));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [headers.map(csvCell).join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\n");
}
