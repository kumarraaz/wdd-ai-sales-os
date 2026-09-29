/**
 * Discovery import service — turns normalized DiscoveredCompany records into
 * real leads using the EXISTING Lead/Company architecture (lib/leads.ts).
 * There is no second lead database: discovered companies become Lead rows
 * (with a Company link when a name is present), exactly like manual/CSV
 * creation.
 *
 * Deduplication is soft: duplicates are skipped and reported with a reason,
 * never silently dropped and never created twice.
 */
import { db } from "../db";
import { createLead, findDuplicate } from "../leads";
import { normalizeDomain } from "../ssrf";
import type { DiscoveredCompany, LeadDiscoveryProvider } from "./types";
import type { DataLabel } from "@prisma/client";

export interface DuplicateCandidate {
  providerId: string;
  sourceType: string;
  email?: string;
  phone?: string;
  domain?: string | null;
}

export interface ExistingLeadMatch {
  id: string;
  externalId: string | null;
  sourceType: string;
  email: string | null;
  phone: string | null;
  domain: string | null;
}

/**
 * Pure duplicate-reason computation — no DB access, fully unit-testable.
 * Returns null when the candidate is NOT a duplicate of the existing lead.
 */
export function duplicateReason(
  candidate: DuplicateCandidate,
  existing: ExistingLeadMatch | null,
  providerLabel: string,
): string | null {
  if (!existing) return null;
  if (
    existing.externalId &&
    existing.externalId === candidate.providerId &&
    existing.sourceType === candidate.sourceType
  ) {
    return `Already in database — same ${providerLabel} listing`;
  }
  if (
    candidate.email &&
    existing.email &&
    existing.email.toLowerCase() === candidate.email.toLowerCase()
  ) {
    return `Already in database — email ${candidate.email} exists`;
  }
  if (candidate.phone && existing.phone) {
    const a = candidate.phone.replace(/\D/g, "");
    const b = existing.phone.replace(/\D/g, "");
    if (a && a === b) return `Already in database — phone ${candidate.phone} exists`;
  }
  if (candidate.domain && existing.domain && existing.domain === candidate.domain) {
    return `Already in database — website ${candidate.domain} exists`;
  }
  return null;
}

function toDataLabel(provenance: DiscoveredCompany["provenance"]): DataLabel {
  switch (provenance) {
    case "VERIFIED_DATA":
      return "VERIFIED";
    case "AI_INFERENCE":
      return "AI_INFERENCE";
    case "DEMO_DATA":
      return "DEMO_DATA";
    default:
      return "USER_PROVIDED";
  }
}

export interface ImportItemResult {
  providerId: string;
  name: string;
  status: "imported" | "skipped";
  leadId?: string;
  /** Human-readable duplicate reason when skipped. */
  reason?: string;
}

export interface ImportSummary {
  imported: ImportItemResult[];
  skipped: ImportItemResult[];
}

/**
 * Import discovered companies into the workspace's lead database.
 * Every query is scoped to organizationId (tenant isolation).
 */
export async function importDiscoveredCompanies(
  organizationId: string,
  actorId: string,
  provider: LeadDiscoveryProvider,
  companies: DiscoveredCompany[],
  opts: { searchQuery?: string } = {},
): Promise<ImportSummary> {
  const imported: ImportItemResult[] = [];
  const skipped: ImportItemResult[] = [];

  for (const company of companies) {
    const domain = company.website ? normalizeDomain(company.website) : null;
    const candidate: DuplicateCandidate = {
      providerId: company.providerId,
      sourceType: provider.sourceType,
      phone: company.phone,
      domain,
    };

    // 1) Same provider listing already imported?
    const byExternalId = await db.lead.findFirst({
      where: {
        organizationId,
        sourceType: provider.sourceType,
        externalId: company.providerId,
      },
      select: { id: true, externalId: true, sourceType: true, email: true, phone: true, domain: true },
    });
    let reason = duplicateReason(candidate, byExternalId, provider.label);

    // 2) Same email / phone / domain already in the database?
    if (!reason) {
      const dup = await findDuplicate(organizationId, {
        phone: company.phone,
        website: company.website,
      });
      reason = duplicateReason(
        candidate,
        dup
          ? {
              id: dup.id,
              externalId: null,
              sourceType: "",
              email: dup.email,
              phone: dup.phone,
              domain: dup.domain,
            }
          : null,
        provider.label,
      );
    }

    if (reason) {
      skipped.push({
        providerId: company.providerId,
        name: company.name,
        status: "skipped",
        reason,
      });
      continue;
    }

    const dataLabel = toDataLabel(company.provenance);
    const { lead } = await createLead(
      organizationId,
      actorId,
      {
        // Discovery yields companies; a contact name is never invented.
        phone: company.phone,
        companyName: company.name,
        industry: company.category,
        country: company.country,
        state: company.state,
        city: company.city,
        website: company.website,
        sourceType: provider.sourceType,
        sourceDetail: opts.searchQuery
          ? `${provider.label}: ${opts.searchQuery}`
          : provider.label,
        externalId: company.providerId,
        sourceUrl: company.sourceUrl,
        rating: company.rating,
        reviewCount: company.reviewCount,
        discoveredAt: company.discoveredAt,
      },
      { sourceType: provider.sourceType, dataLabel },
    );

    // Field-level provenance: where each imported field came from.
    const provenanceRows: {
      organizationId: string;
      leadId: string;
      field: string;
      value: string;
      source: string;
      sourceUrl?: string;
      label: DataLabel;
    }[] = [];
    if (company.website) {
      provenanceRows.push({
        organizationId,
        leadId: lead.id,
        field: "website",
        value: company.website,
        source: provider.label,
        sourceUrl: company.sourceUrl,
        label: dataLabel,
      });
    }
    if (company.phone) {
      provenanceRows.push({
        organizationId,
        leadId: lead.id,
        field: "phone",
        value: company.phone,
        source: provider.label,
        sourceUrl: company.sourceUrl,
        label: dataLabel,
      });
    }
    if (provenanceRows.length > 0) {
      await db.leadFieldProvenance.createMany({ data: provenanceRows });
    }

    imported.push({
      providerId: company.providerId,
      name: company.name,
      status: "imported",
      leadId: lead.id,
    });
  }

  return { imported, skipped };
}
