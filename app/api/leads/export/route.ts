import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/csv";

/** GET /api/leads/export?format=csv|json — scoped to workspace, respects quotas of honesty: exports what you own. */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const format = req.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";

  const leads = await db.lead.findMany({
    where: { organizationId: ctx.organization.id },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  const rows = leads.map((l) => ({
    fullName: l.fullName ?? "",
    email: l.email ?? "",
    phone: l.phone ?? "",
    jobTitle: l.jobTitle ?? "",
    company: l.company?.name ?? "",
    industry: l.industry ?? "",
    location: l.location ?? "",
    city: l.city ?? "",
    country: l.country ?? "",
    website: l.website ?? "",
    status: l.status,
    leadScore: l.leadScore,
    sourceType: l.sourceType,
    createdAt: l.createdAt.toISOString(),
  }));

  if (format === "json") {
    return NextResponse.json({ count: rows.length, leads: rows });
  }
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${ctx.organization.slug}.csv"`,
    },
  });
});
