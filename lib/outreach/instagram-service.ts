/**
 * Instagram Outreach Assistant — service layer.
 *
 * Orchestrates: batch creation → per-profile research → draft generation,
 * with strict per-item failure isolation (one profile failing never fails
 * the batch). Item actions: regenerate, edit, copy, open-profile event,
 * mark-contacted (writes canonical LeadActivity on a linked lead), and
 * lead linking (match existing by instagram handle, or create via the
 * existing createLead flow — never silently duplicating).
 *
 * SAFETY INVARIANTS (also covered by tests):
 * - No function here sends anything to Instagram. The only outbound
 *   "action" is returning the canonical profile URL for the user to open.
 * - No credentials, sessions, cookies, or tokens are read, stored, or
 *   transmitted anywhere in this module.
 * - Every DB write is scoped to organizationId (tenant isolation).
 */
import { db } from "../db";
import { audit } from "../audit";
import { createLead } from "../leads";
import { instagramProfileUrl, parseUsernameBatch } from "./instagram";
import { researchInstagramProfile, type ResearchDeps } from "./instagram-research";
import { generateOutreachMessage } from "./instagram-message";
import type { InstagramOutreachItemStatus, DataLabel } from "@prisma/client";

export const MAX_BATCH_USERNAMES = 50;

export interface BatchProgressEvent {
  type: "item-start" | "item-done" | "batch-done";
  username?: string;
  index?: number;
  total?: number;
  itemId?: string;
  ok?: boolean;
}

export interface CreateBatchResult {
  batchId: string;
  total: number;
  invalid: { raw: string; error: string }[];
  duplicatesRemoved: number;
}

/**
 * Create a batch from pasted text and process every username:
 * research → draft. Emits progress events (for SSE). Never throws for
 * per-item failures.
 */
export async function createAndProcessBatch(
  organizationId: string,
  actorId: string,
  pastedText: string,
  opts: {
    name?: string;
    researchDeps?: ResearchDeps;
    onEvent?: (e: BatchProgressEvent) => void;
  } = {},
): Promise<CreateBatchResult> {
  const parsed = parseUsernameBatch(pastedText, MAX_BATCH_USERNAMES);
  if (parsed.usernames.length === 0) {
    throw new Error("No valid Instagram usernames found in the pasted text.");
  }

  const batch = await db.instagramOutreachBatch.create({
    data: {
      organizationId,
      name: opts.name?.trim() || null,
      totalUsernames: parsed.usernames.length,
      createdById: actorId,
    },
  });

  await audit({
    organizationId,
    actorId,
    action: "outreach.instagram.batch_created",
    resource: "instagram_outreach_batch",
    resourceId: batch.id,
    metadata: {
      total: parsed.usernames.length,
      invalid: parsed.invalid.length,
      duplicatesRemoved: parsed.duplicatesRemoved,
    },
  });

  const total = parsed.usernames.length;
  for (let i = 0; i < total; i++) {
    const username = parsed.usernames[i];
    opts.onEvent?.({ type: "item-start", username, index: i + 1, total });
    try {
      const research = await researchInstagramProfile(username, opts.researchDeps);
      const generated = await generateOutreachMessage(research, opts.researchDeps?.ai);
      const item = await db.instagramOutreachItem.create({
        data: {
          organizationId,
          batchId: batch.id,
          username,
          profileUrl: instagramProfileUrl(username),
          businessName: research.businessName,
          category: research.category,
          location: research.location,
          website: research.website,
          observations: research.observations,
          researchSources: research.sources,
          researchConfidence: research.confidence,
          researchFailed: false,
          researchedAt: new Date(research.researchedAt),
          messageDraft: generated.text,
          messageSource: generated.source,
          dataLabel: (generated.source === "ai" ? "AI_INFERENCE" : "USER_PROVIDED") as DataLabel,
        },
      });
      // Best-effort lead link: match an existing lead by Instagram handle.
      await linkLeadBestEffort(organizationId, item.id, username);
      await audit({
        organizationId,
        actorId,
        action: "outreach.instagram.item_researched",
        resource: "instagram_outreach_item",
        resourceId: item.id,
        metadata: { username, confidence: research.confidence, messageSource: generated.source },
      });
      opts.onEvent?.({ type: "item-done", username, index: i + 1, total, itemId: item.id, ok: true });
    } catch (err) {
      // Per-item failure isolation: record the failure, continue the batch.
      const item = await db.instagramOutreachItem.create({
        data: {
          organizationId,
          batchId: batch.id,
          username,
          profileUrl: instagramProfileUrl(username),
          researchFailed: true,
          researchError: err instanceof Error ? err.message : "Research failed.",
          observations: "Insufficient public information.",
          researchSources: [],
          researchConfidence: "INSUFFICIENT",
        },
      });
      await audit({
        organizationId,
        actorId,
        action: "outreach.instagram.item_failed",
        resource: "instagram_outreach_item",
        resourceId: item.id,
        metadata: { username, error: err instanceof Error ? err.message : "unknown" },
        result: "FAILED",
      });
      opts.onEvent?.({ type: "item-done", username, index: i + 1, total, itemId: item.id, ok: false });
    }
  }

  opts.onEvent?.({ type: "batch-done", total });
  return {
    batchId: batch.id,
    total,
    invalid: parsed.invalid,
    duplicatesRemoved: parsed.duplicatesRemoved,
  };
}

/** Match an existing lead by Instagram handle (best effort, never throws). */
async function linkLeadBestEffort(
  organizationId: string,
  itemId: string,
  username: string,
): Promise<void> {
  try {
    const lead = await db.lead.findFirst({
      where: {
        organizationId,
        instagramUrl: { contains: username, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (lead) {
      await db.instagramOutreachItem.update({
        where: { id: itemId },
        data: { leadId: lead.id },
      });
    }
  } catch {
    /* best effort only */
  }
}

export interface ItemAction {
  id: string;
  organizationId: string;
  batchId: string;
  username: string;
  profileUrl: string;
  status: InstagramOutreachItemStatus;
  businessName: string | null;
  category: string | null;
  location: string | null;
  website: string | null;
  observations: string | null;
  researchSources: string[];
  researchConfidence: string | null;
  researchFailed: boolean;
  researchError: string | null;
  researchedAt: Date | null;
  messageDraft: string | null;
  messageSource: string | null;
  messageEdited: string | null;
  dataLabel: DataLabel;
  leadId: string | null;
  copiedAt: Date | null;
  contactedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getItem(organizationId: string, id: string) {
  const item = await db.instagramOutreachItem.findFirst({
    where: { id, organizationId },
  });
  if (!item) throw new Error("NOT_FOUND");
  return item;
}

/** Regenerate the draft with the AI provider (or template fallback). */
export async function regenerateItemMessage(
  organizationId: string,
  actorId: string,
  id: string,
  researchDeps: ResearchDeps = {},
): Promise<ItemAction> {
  const item = await getItem(organizationId, id);
  const research = await researchInstagramProfile(item.username, researchDeps);
  const generated = await generateOutreachMessage(research, researchDeps.ai);
  const updated = await db.instagramOutreachItem.update({
    where: { id },
    data: {
      messageDraft: generated.text,
      messageSource: generated.source,
      messageEdited: null, // a fresh draft discards the previous manual edit
      messageEditedAt: null,
      status: "DRAFT",
      dataLabel: (generated.source === "ai" ? "AI_INFERENCE" : "USER_PROVIDED") as DataLabel,
    },
  });
  await audit({
    organizationId,
    actorId,
    action: "outreach.instagram.message_regenerated",
    resource: "instagram_outreach_item",
    resourceId: id,
    metadata: { username: item.username, messageSource: generated.source },
  });
  return updated as ItemAction;
}

/** Save the user's edited message text. */
export async function editItemMessage(
  organizationId: string,
  actorId: string,
  id: string,
  message: string,
): Promise<ItemAction> {
  const item = await getItem(organizationId, id);
  const text = message.trim().slice(0, 2000);
  if (!text) throw new Error("INVALID_MESSAGE");
  const updated = await db.instagramOutreachItem.update({
    where: { id },
    data: { messageEdited: text, messageEditedAt: new Date() },
  });
  await audit({
    organizationId,
    actorId,
    action: "outreach.instagram.message_edited",
    resource: "instagram_outreach_item",
    resourceId: id,
    metadata: { username: item.username, length: text.length },
  });
  return updated as ItemAction;
}

/** Record that the user copied the message (they send it manually). */
export async function markItemCopied(
  organizationId: string,
  actorId: string,
  id: string,
): Promise<ItemAction> {
  const item = await getItem(organizationId, id);
  const updated = await db.instagramOutreachItem.update({
    where: { id },
    data: { status: "COPIED", copiedAt: new Date() },
  });
  await audit({
    organizationId,
    actorId,
    action: "outreach.instagram.message_copied",
    resource: "instagram_outreach_item",
    resourceId: id,
    metadata: { username: item.username },
  });
  return updated as ItemAction;
}

/** Record that the Instagram profile was opened (plain navigation, no automation). */
export async function recordProfileOpened(
  organizationId: string,
  actorId: string,
  id: string,
): Promise<void> {
  const item = await getItem(organizationId, id);
  await audit({
    organizationId,
    actorId,
    action: "outreach.instagram.profile_opened",
    resource: "instagram_outreach_item",
    resourceId: id,
    metadata: { username: item.username, profileUrl: item.profileUrl },
  });
}

/**
 * Mark as contacted — the user confirms they sent the message manually.
 * Writes a canonical LeadActivity on the linked lead (no second status system).
 */
export async function markItemContacted(
  organizationId: string,
  actorId: string,
  id: string,
): Promise<ItemAction> {
  const item = await getItem(organizationId, id);
  const updated = await db.instagramOutreachItem.update({
    where: { id },
    data: { status: "CONTACTED", contactedAt: new Date() },
  });
  if (item.leadId) {
    await db.leadActivity.create({
      data: {
        organizationId,
        leadId: item.leadId,
        type: "instagram_contacted",
        title: `Instagram outreach: message sent manually to @${item.username}`,
        actorId,
      },
    });
  }
  await audit({
    organizationId,
    actorId,
    action: "outreach.instagram.item_contacted",
    resource: "instagram_outreach_item",
    resourceId: id,
    metadata: { username: item.username, leadId: item.leadId },
  });
  return updated as ItemAction;
}

export interface LeadCandidate {
  id: string;
  displayName: string;
  instagramUrl: string | null;
  status: string;
}

/**
 * Find candidate leads for linking (by handle or business name), or create
 * a new lead through the existing createLead flow when the user explicitly
 * asks. Never silently creates duplicates: creation requires an explicit
 * `create: true` and re-checks for an existing match first.
 */
export async function linkItemToLead(
  organizationId: string,
  actorId: string,
  id: string,
  opts: { leadId?: string; create?: boolean } = {},
): Promise<ItemAction> {
  const item = await getItem(organizationId, id);

  if (opts.leadId) {
    const lead = await db.lead.findFirst({
      where: { id: opts.leadId, organizationId },
      select: { id: true },
    });
    if (!lead) throw new Error("LEAD_NOT_FOUND");
    const updated = await db.instagramOutreachItem.update({
      where: { id },
      data: { leadId: lead.id },
    });
    await audit({
      organizationId,
      actorId,
      action: "outreach.instagram.lead_linked",
      resource: "instagram_outreach_item",
      resourceId: id,
      metadata: { username: item.username, leadId: lead.id },
    });
    return updated as ItemAction;
  }

  if (opts.create) {
    // Re-check: never create when a match already exists.
    const existing = await db.lead.findFirst({
      where: {
        organizationId,
        OR: [
          { instagramUrl: { contains: item.username, mode: "insensitive" } },
          ...(item.businessName
            ? [{ company: { name: { equals: item.businessName, mode: "insensitive" as const } } }]
            : []),
        ],
      },
      select: { id: true },
    });
    const leadId =
      existing?.id ??
      (
        await createLead(
          organizationId,
          actorId,
          {
            fullName: item.businessName?.trim() || undefined,
            companyName: item.businessName?.trim() || undefined,
            industry: item.category?.trim() || undefined,
            website: item.website?.trim() || undefined,
            instagramUrl: item.profileUrl,
            sourceType: "MANUAL",
            sourceDetail: `Instagram outreach: @${item.username}`,
          },
          { sourceType: "MANUAL", dataLabel: "USER_PROVIDED" },
        )
      ).lead.id;
    const updated = await db.instagramOutreachItem.update({
      where: { id },
      data: { leadId },
    });
    await audit({
      organizationId,
      actorId,
      action: "outreach.instagram.lead_created",
      resource: "instagram_outreach_item",
      resourceId: id,
      metadata: { username: item.username, leadId, reusedExisting: !!existing },
    });
    return updated as ItemAction;
  }

  throw new Error("NO_ACTION");
}

/** Candidate leads for manual linking (same org only). */
export async function findLeadCandidates(
  organizationId: string,
  id: string,
): Promise<LeadCandidate[]> {
  const item = await getItem(organizationId, id);
  const leads = await db.lead.findMany({
    where: {
      organizationId,
      OR: [
        { instagramUrl: { contains: item.username, mode: "insensitive" } },
        ...(item.businessName
          ? [
              { fullName: { contains: item.businessName, mode: "insensitive" as const } },
              { company: { name: { contains: item.businessName, mode: "insensitive" as const } } },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      fullName: true,
      instagramUrl: true,
      status: true,
      company: { select: { name: true } },
    },
    take: 10,
  });
  return leads.map((l) => ({
    id: l.id,
    displayName: l.company?.name ?? l.fullName ?? "—",
    instagramUrl: l.instagramUrl,
    status: l.status,
  }));
}

export async function listBatches(organizationId: string, take = 20) {
  return db.instagramOutreachBatch.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take,
    include: { _count: { select: { items: true } } },
  });
}

export async function getBatch(organizationId: string, batchId: string) {
  const batch = await db.instagramOutreachBatch.findFirst({
    where: { id: batchId, organizationId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!batch) throw new Error("NOT_FOUND");
  return batch;
}
