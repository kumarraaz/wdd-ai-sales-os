import { describe, expect, it } from "vitest";
import { csvCell, neutraliseFormula, toCsv } from "@/lib/csv";

describe("neutraliseFormula", () => {
  it("defuses cells a spreadsheet would execute", () => {
    for (const evil of [
      '=HYPERLINK("http://evil.example","x")',
      "=1+1",
      "@SUM(A1:A9)",
      "+cmd|' /C calc'!A0",
      "-2+3+cmd|' /C calc'!A0",
      "\t=1+1",
      "\r=1+1",
    ]) {
      expect(neutraliseFormula(evil).startsWith("'")).toBe(true);
    }
  });

  it("leaves ordinary data alone, including phone numbers and negative numbers", () => {
    for (const fine of ["Acme Pvt Ltd", "+91 98765 43210", "+1 (555) 010-9999", "-12.5", "12", "", "a=b", "x@y.example", "  =not-first"]) {
      expect(neutraliseFormula(fine)).toBe(fine);
    }
  });
});

describe("csvCell / toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("neutralises and then quotes when both apply", () => {
    expect(csvCell('=SUM(1,2)')).toBe(`"'=SUM(1,2)"`);
  });

  it("writes a header row and one line per record", () => {
    expect(toCsv([{ a: "1", b: "=x" }, { a: "2", b: "y" }])).toBe("a,b\n1,'=x\n2,y");
    expect(toCsv([])).toBe("");
  });
});
