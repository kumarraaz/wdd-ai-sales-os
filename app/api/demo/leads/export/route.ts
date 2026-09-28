import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { DEMO_COOKIE_NAME, isDemoModeEnabled, validateDemoSession } from "@/lib/demo";
import { DEMO_LEADS } from "@/lib/demo-data";

/**
 * GET /api/demo/leads/export — CSV export of the DEMO_DATA fixtures.
 * Local read-only action: no external service is touched. Same 404-when-off
 * contract as the other demo routes.
 */

function csvCell(value: string | number | null): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const jar = await cookies();
  if (!isDemoModeEnabled() || !validateDemoSession(jar.get(DEMO_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const header = ["name", "email", "phone", "jobTitle", "company", "status", "leadScore", "dataLabel"];
  const rows = DEMO_LEADS.map((l) =>
    [
      l.fullName, l.email, l.phone, l.jobTitle, l.company?.name ?? "",
      l.status, l.leadScore, l.dataLabel,
    ].map(csvCell).join(","),
  );
  const csv = [header.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="demo-leads-DEMO_DATA.csv"',
    },
  });
}
