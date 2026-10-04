/**
 * Discovery run history persistence. Every user-triggered discovery run
 * records a DiscoveryHistory row with truthful counts — requested vs
 * actually discovered vs contactable vs imported are stored separately.
 * Tenant-scoped; no secrets in params.
 */
import { db } from "../db";
import type { DiscoveryRunInput, DiscoveryRunOutput } from "./run";

export interface HistoryRecordInput {
  organizationId: string;
  profileId?: string;
  label: string;
  input: DiscoveryRunInput;
  output: DiscoveryRunOutput;
  createdById?: string;
}

function sanitizeParams(input: DiscoveryRunInput): Record<string, unknown> {
  return {
    sources: input.sources.map((s) => ({ providerId: s.providerId, role: s.role })),
    industry: input.industry,
    location: input.location,
    websiteFilter: input.websiteFilter,
    contactRequired: input.contactRequired,
    opportunity: input.opportunity,
    recentEvidence: input.recentEvidence,
    limit: input.limit,
    ...(input.category ? { category: input.category } : {}),
  };
}

export async function recordHistory(entry: HistoryRecordInput) {
  const { input, output } = entry;
  return db.discoveryHistory.create({
    data: {
      organizationId: entry.organizationId,
      profileId: entry.profileId ?? null,
      label: entry.label.slice(0, 200),
      providerIds: output.sources.map((s) => s.providerId) as never,
      params: sanitizeParams(input) as never,
      requested: output.summary.requested,
      discovered: output.summary.discovered,
      deduplicated: output.summary.deduplicated,
      withWebsite: output.summary.withWebsite,
      withoutWebsite: output.summary.withoutWebsite,
      contactable: output.summary.contactable,
      unreachable: output.summary.unreachable,
      duplicate: 0,
      perSource: output.sources.map((s) => ({
        providerId: s.providerId,
        label: s.label,
        role: s.role,
        status: s.status,
        discovered: s.discovered,
        requestsMade: s.requestsMade,
        creditsUsed: s.creditsUsed,
        queriesRun: s.queriesRun,
        message: s.message ?? null,
      })) as never,
      durationMs: output.durationMs,
      status: output.status,
      error: output.error ?? null,
      createdById: entry.createdById ?? null,
    },
  });
}

export async function listHistory(organizationId: string, take = 25) {
  return db.discoveryHistory.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(take, 1), 100),
    include: { profile: { select: { id: true, name: true } } },
  });
}

export async function getHistoryEntry(organizationId: string, id: string) {
  return db.discoveryHistory.findFirst({
    where: { id, organizationId },
    include: { profile: { select: { id: true, name: true } } },
  });
}

/** Update import counts after an import step completes. */
export async function updateHistoryImportCounts(
  organizationId: string,
  historyId: string,
  counts: { imported: number; duplicate: number },
) {
  await db.discoveryHistory.updateMany({
    where: { id: historyId, organizationId },
    data: { imported: counts.imported, duplicate: counts.duplicate },
  });
}
