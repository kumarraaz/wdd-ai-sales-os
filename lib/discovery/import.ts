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
import {
  matchDuplicate,
  normalizeName,
  normalizePhoneDigits,
  type MatchCandidate,
  type MatchExisting,
} from "./matching";
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
 * Only definitive matches produce a reason; possible matches are handled
 * separately via matchDuplicate().
 */
export function duplicateReason(
  candidate: DuplicateCandidate,
  existing: ExistingLeadMatch | null,
  providerLabel: string,
): string | null {
  if (!existing) return null;
  const match = matchDuplicate(
    {
      providerId: candidate.providerId,
      sourceType: candidate.sourceType,
      phone: candidate.phone,
    },
    {
      id: existing.id,
      externalId: existing.externalId,
      sourceType: existing.sourceType,
      phone: existing.phone,
    },
    providerLabel,
  );
  if (match?.definitive) return match.reason;
  // Email check (kept for backward compatibility with existing tests).
  if (
    candidate.email &&
    existing.email &&
    existing.email.toLowerCase() === candidate.email.toLowerCase()
  ) {
    return `Already in database — email ${candidate.email} exists`;
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
  /** Import outcome per lead — every result is traceable. */
  status: "imported" | "already_exists" | "possible_duplicate" | "skipped" | "failed";
  leadId?: string;
  /** Existing lead id for already_exists / possible_duplicate. */
  matchedLeadId?: string;
  /** Human-readable reason for non-imported outcomes. */
  reason?: string;
}

export interface ImportSummary {
  imported: ImportItemResult[];
  alreadyExists: ImportItemResult[];
  possibleDuplicates: ImportItemResult[];
  skipped: ImportItemResult[];
  failed: ImportItemResult[];
}

export interface CompanyMatch {
  match: { kind: string; definitive: boolean; reason: string } | null;
  matchedLeadId?: string;
  existingStatus?: string | null;
  possible: { kind: string; definitive: boolean; reason: string; matchedLeadId?: string } | null;
}

/**
 * Run the full duplicate-matching pipeline for one discovered company.
 * Read-only — shared by import and import-preview.
 */
export async function findMatchForCompany(
  organizationId: string,
  provider: LeadDiscoveryProvider,
  company: DiscoveredCompany,
): Promise<CompanyMatch> {
  const candidate: MatchCandidate = {
    providerId: company.providerId,
    sourceType: provider.sourceType,
    website: company.website,
    phone: company.phone,
    name: company.name,
    city: company.city,
    country: company.country,
  };

  // 1) Definitive: same provider listing already imported.
  const byExternalId = await db.lead.findFirst({
    where: {
      organizationId,
      sourceType: provider.sourceType,
      externalId: company.providerId,
    },
    select: { id: true, externalId: true, sourceType: true, status: true },
  });
  let match = matchDuplicate(
    candidate,
    byExternalId
      ? {
          id: byExternalId.id,
          externalId: byExternalId.externalId,
          sourceType: byExternalId.sourceType,
        }
      : null,
    provider.label,
  );
  let matchedLeadId: string | undefined = byExternalId?.id;
  let existingStatus: string | null = byExternalId?.status ?? null;

  // 2) Definitive: same phone / website already in the database.
  if (!match) {
    const dup = await findDuplicate(organizationId, {
      phone: company.phone,
      website: company.website,
    });
    if (dup) {
      const full = await db.lead.findUnique({
        where: { id: dup.id },
        select: { id: true, phone: true, domain: true, website: true, status: true },
      });
      if (full) {
        matchedLeadId = full.id;
        existingStatus = full.status;
        match = matchDuplicate(
          candidate,
          { id: full.id, phone: full.phone, domain: full.domain, website: full.website },
          provider.label,
        );
      }
    }
  }

  // 2b) Phone across formatting variants: findDuplicate's `contains` query
  // compares digit-only input against raw stored phones (e.g. "+91 79 4000
  // 1111"), so it can never match a differently formatted number. Compare
  // normalized digits in JS over a bounded candidate set instead — the
  // last-4-digits prefilter only affects recall, the exact digit equality
  // below is the definitive decision, so there are no false positives.
  if (!match && company.phone) {
    const digits = normalizePhoneDigits(company.phone).replace(/\D/g, "");
    if (digits.length >= 4) {
      const phoneCandidates = await db.lead.findMany({
        where: { organizationId, phone: { contains: digits.slice(-4) } },
        select: { id: true, phone: true, status: true },
        take: 50,
      });
      const hit = phoneCandidates.find(
        (l) => normalizePhoneDigits(l.phone).replace(/\D/g, "") === digits,
      );
      if (hit) {
        matchedLeadId = hit.id;
        existingStatus = hit.status;
        match = matchDuplicate(
          candidate,
          { id: hit.id, phone: hit.phone },
          provider.label,
        );
      }
    }
  }

  // 3) Possible: same normalized business name + location.
  let possible: CompanyMatch["possible"] = null;
  if (!match && normalizeName(company.name)) {
    const locOr = [
      ...(company.city
        ? [{ city: { equals: company.city, mode: "insensitive" as const } }]
        : []),
      ...(!company.city && company.country
        ? [{ country: { equals: company.country, mode: "insensitive" as const } }]
        : []),
    ];
    if (locOr.length > 0) {
      const locMatches = await db.lead.findMany({
        where: { organizationId, OR: locOr },
        select: {
          id: true,
          fullName: true,
          city: true,
          country: true,
          status: true,
          // Discovery imports create Company-linked leads with fullName NULL;
          // the business name lives on the related Company record.
          company: { select: { name: true } },
        },
        take: 25,
      });
      for (const m of locMatches) {
        const r = matchDuplicate(
          candidate,
          { id: m.id, name: m.company?.name ?? m.fullName, city: m.city, country: m.country },
          provider.label,
        );
        if (r && !r.definitive) {
          possible = {
            ...r,
            matchedLeadId: m.id,
            reason: `${r.reason} (existing lead status: ${m.status})`,
          };
          break;
        }
      }
    }
  }

  return { match, matchedLeadId, existingStatus, possible };
}

/**
 * Import discovered companies into the workspace's lead database.
 * Every query is scoped to organizationId (tenant isolation).
 *
 * Outcomes per company:
 * - already_exists: definitive duplicate (external ID / website / phone) —
 *   NOT imported, idempotent on retry.
 * - possible_duplicate: name+location match — imported (explicit user
 *   action) but flagged with the matched lead for review. Never merged.
 * - imported: new lead created (status NEW — the predictable initial CRM stage).
 * - skipped: over quota (explicit reason).
 * - failed: unexpected error — other items are unaffected (no rollback of
 *   independent successes).
 */
export async function importDiscoveredCompanies(
  organizationId: string,
  actorId: string,
  provider: LeadDiscoveryProvider,
  companies: DiscoveredCompany[],
  opts: { searchQuery?: string } = {},
): Promise<ImportSummary> {
  const imported: ImportItemResult[] = [];
  const alreadyExists: ImportItemResult[] = [];
  const possibleDuplicates: ImportItemResult[] = [];
  const skipped: ImportItemResult[] = [];
  const failed: ImportItemResult[] = [];

  for (const company of companies) {
    try {
      const { match, matchedLeadId, existingStatus, possible } =
        await findMatchForCompany(organizationId, provider, company);

      if (match?.definitive) {
        alreadyExists.push({
          providerId: company.providerId,
          name: company.name,
          status: "already_exists",
          matchedLeadId,
          reason: `${match.reason}${existingStatus ? ` (existing lead status: ${existingStatus})` : ""}`,
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

      if (possible) {
        possibleDuplicates.push({
          providerId: company.providerId,
          name: company.name,
          status: "possible_duplicate",
          leadId: lead.id,
          matchedLeadId: possible.matchedLeadId,
          reason: possible.reason,
        });
      } else {
        imported.push({
          providerId: company.providerId,
          name: company.name,
          status: "imported",
          leadId: lead.id,
        });
      }
    } catch (err) {
      // One item's failure never rolls back the others.
      failed.push({
        providerId: company.providerId,
        name: company.name,
        status: "failed",
        reason: err instanceof Error ? err.message : "Import failed.",
      });
    }
  }

  return { imported, alreadyExists, possibleDuplicates, skipped, failed };
}
