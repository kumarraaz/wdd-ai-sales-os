import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { discoveryImportSchema } from "@/lib/validators";
import { getDiscoveryProvider } from "@/lib/discovery/registry";
import { findMatchForCompany } from "@/lib/discovery/import";
import { db } from "@/lib/db";

/**
 * POST /api/discovery/import-preview
 * Body: { providerId, searchQuery?, companies: DiscoveredCompany[] }
 *
 * Read-only preview of what a discovery import would do. For each selected
 * company it reports duplicate status and — for already-existing leads —
 * their current CRM status plus linked intelligence (website inspection,
 * AI intelligence, latest score). NOTHING is created or modified.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`discovery:${ctx.user.id}`, LIMITS.discovery);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = discoveryImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const provider = getDiscoveryProvider(input.providerId);
    if (!provider) {
      return NextResponse.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 });
    }
    if (input.companies.some((c) => c.provider !== provider.id)) {
      return NextResponse.json({ error: "PROVIDER_MISMATCH" }, { status: 400 });
    }

    const items = [];
    for (const company of input.companies) {
      const { match, matchedLeadId, existingStatus, possible } =
        await findMatchForCompany(ctx.organization.id, provider, company);

      const duplicateStatus = match?.definitive
        ? "already_exists"
        : possible
          ? "possible_duplicate"
          : "new";

      let matchedLead: {
        id: string;
        status: string;
        websiteInspection: "completed" | "none";
        aiIntelligence: "completed" | "none";
        score: number | null;
      } | null = null;
      const targetLeadId = matchedLeadId ?? possible?.matchedLeadId;
      if (targetLeadId) {
        const lead = await db.lead.findFirst({
          where: { id: targetLeadId, organizationId: ctx.organization.id },
          select: {
            id: true,
            status: true,
            websiteInspections: {
              where: { status: "COMPLETED" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true },
            },
            intelligenceReports: {
              where: { status: "COMPLETED" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true },
            },
            scores: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { score: true },
            },
          },
        });
        if (lead) {
          matchedLead = {
            id: lead.id,
            status: lead.status,
            websiteInspection: lead.websiteInspections.length > 0 ? "completed" : "none",
            aiIntelligence: lead.intelligenceReports.length > 0 ? "completed" : "none",
            score: lead.scores[0]?.score ?? null,
          };
        }
      }

      items.push({
        providerId: company.providerId,
        name: company.name,
        category: company.category ?? null,
        city: company.city ?? null,
        country: company.country ?? null,
        website: company.website ?? null,
        phone: company.phone ?? null,
        source: provider.label,
        provenance: company.provenance,
        duplicateStatus,
        reason:
          (match?.definitive ? match.reason : possible?.reason) ??
          (existingStatus ? `Existing lead status: ${existingStatus}` : undefined) ??
          null,
        matchedLead,
      });
    }

    return NextResponse.json({ items });
  },
  { minRole: "SALES_EXECUTIVE" },
);
