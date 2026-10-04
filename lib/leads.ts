import { Prisma } from "@prisma/client";
import { db } from "./db";
import { normalizeDomain, normalizePhone } from "./ssrf";
import type { CreateLeadInput, UpdateLeadInput } from "./validators";
import type { listLeadsQuerySchema } from "./validators";
import type { z } from "zod";

/**
 * Lead service — all functions take organizationId FIRST and scope every
 * query to it. This file is the only place Lead writes happen.
 */

/** True when userId is a member of organizationId (assignee validation). */
export async function isOrgMember(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const m = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { id: true },
  });
  return m !== null;
}

export async function findDuplicate(
  organizationId: string,
  input: { email?: string; phone?: string; website?: string; companyName?: string; fullName?: string },
  excludeId?: string,
) {
  const ors: Prisma.LeadWhereInput[] = [];
  if (input.email) ors.push({ email: { equals: input.email, mode: "insensitive" } });
  if (input.phone) {
    const digits = normalizePhone(input.phone).replace(/\D/g, "");
    if (digits) ors.push({ phone: { contains: digits } });
  }
  const domain = input.website ? normalizeDomain(input.website) : null;
  if (domain) ors.push({ domain });
  if (ors.length === 0) return null;
  return db.lead.findFirst({
    where: {
      organizationId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: ors,
    },
    select: { id: true, fullName: true, email: true, phone: true, domain: true },
  });
}

export async function createLead(
  organizationId: string,
  actorId: string,
  input: CreateLeadInput,
  opts: {
    sourceType?: string;
    dataLabel?: "USER_PROVIDED" | "DEMO_DATA" | "VERIFIED" | "AI_INFERENCE";
  } = {},
) {
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  const website = input.website?.trim() || null;
  const domain = website ? normalizeDomain(website) : null;

  const duplicate = await findDuplicate(
    organizationId,
    { email: email ?? undefined, phone: phone ?? undefined, website: website ?? undefined },
  );

  let companyId: string | undefined;
  if (input.companyName?.trim()) {
    // No hard unique on (organizationId, name) by design — duplicates are
    // flagged by the dedup service, not blocked at the DB level.
    const existing = await db.company.findFirst({
      where: { organizationId, name: input.companyName.trim() },
    });
    const company =
      existing ??
      (await db.company.create({
        data: {
          organizationId,
          name: input.companyName.trim(),
          domain,
          website,
          dataLabel: opts.dataLabel ?? "USER_PROVIDED",
        },
      }));
    companyId = company.id;
  }

  const createData: Prisma.LeadCreateInput = {
    organization: { connect: { id: organizationId } },
    fullName: input.fullName?.trim() || null,
    email,
    phone,
    jobTitle: input.jobTitle?.trim() || null,
    company: companyId ? { connect: { id: companyId } } : undefined,
    industry: input.industry?.trim() || null,
    location: input.location?.trim() || null,
    country: input.country?.trim() || null,
    state: input.state?.trim() || null,
    city: input.city?.trim() || null,
    website,
    domain,
    // discovery (Phase 2) — populated only from compliant providers
    externalId: input.externalId?.trim() || null,
    sourceUrl: input.sourceUrl?.trim() || null,
    rating: input.rating ?? null,
    reviewCount: input.reviewCount ?? null,
    discoveredAt: input.discoveredAt ? new Date(input.discoveredAt) : null,
    lastVerifiedAt: input.lastVerifiedAt ? new Date(input.lastVerifiedAt) : null,
    websiteStatus: input.websiteStatus ?? null,
    opportunityType: input.opportunityType ?? null,
    contactable: input.contactable ?? false,
    googleMapsUrl: input.googleMapsUrl?.trim() || null,
    instagramUrl: input.instagramUrl?.trim() || null,
    facebookUrl: input.facebookUrl?.trim() || null,
    linkedinUrl: input.linkedinUrl?.trim() || null,
    status: input.status ?? "NEW",
    sourceType: (input.sourceType as never) ?? (opts.sourceType as never) ?? "MANUAL",
    sourceDetail: input.sourceDetail?.trim() || null,
    // Prisma 7 create input exposes the relation, not the FK scalar.
    assignedTo: input.assignedToId ? { connect: { id: input.assignedToId } } : undefined,
    dataLabel: opts.dataLabel ?? "USER_PROVIDED",
    tags: input.tags?.length
      ? {
          create: input.tags.map((name) => ({
            tag: {
              connectOrCreate: {
                where: { organizationId_name: { organizationId, name } },
                create: { organizationId, name },
              },
            },
          })),
        }
      : undefined,
  };

  const lead = await db.lead.create({
    data: createData,
    include: { company: true, tags: { include: { tag: true } } },
  });

  await db.leadActivity.create({
    data: {
      organizationId,
      leadId: lead.id,
      type: "created",
      title: "Lead created",
      actorId,
    },
  });

  return { lead, duplicate };
}

type ListQuery = z.infer<typeof listLeadsQuerySchema>;

export async function listLeads(organizationId: string, query: ListQuery) {
  const where: Prisma.LeadWhereInput = { organizationId };
  if (query.q) {
    where.OR = [
      { fullName: { contains: query.q, mode: "insensitive" } },
      { email: { contains: query.q, mode: "insensitive" } },
      { phone: { contains: query.q, mode: "insensitive" } },
      { company: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }
  if (query.status) where.status = query.status;
  if (query.sourceType) where.sourceType = query.sourceType;
  if (query.minScore !== undefined) where.leadScore = { gte: query.minScore };
  if (query.tag) where.tags = { some: { tag: { name: query.tag } } };
  if (query.websiteStatus) where.websiteStatus = query.websiteStatus;
  if (query.contactable !== undefined) where.contactable = query.contactable;
  if (query.opportunityType) where.opportunityType = query.opportunityType;

  const sort = query.sort ?? "createdAt";
  const order = query.order ?? "desc";
  const skip = (query.page - 1) * query.pageSize;

  const [total, leads] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      orderBy: { [sort]: order },
      skip,
      take: query.pageSize,
      include: {
        company: { select: { id: true, name: true } },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      },
    }),
  ]);

  return { total, page: query.page, pageSize: query.pageSize, leads };
}

export async function getLead(organizationId: string, id: string) {
  return db.lead.findFirst({
    where: { id, organizationId },
    include: {
      company: true,
      contacts: true,
      tags: { include: { tag: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
      scores: { orderBy: { createdAt: "desc" }, take: 5 },
      provenance: { orderBy: { retrievedAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" }, take: 20 },
      tasks: { where: { status: { not: "DONE" } }, orderBy: { dueAt: "asc" } },
    },
  });
}

export async function updateLead(
  organizationId: string,
  actorId: string,
  id: string,
  input: UpdateLeadInput,
) {
  const existing = await db.lead.findFirst({ where: { id, organizationId } });
  if (!existing) return null;

  const data: Prisma.LeadUpdateInput = {};
  if (input.fullName !== undefined) data.fullName = input.fullName?.trim() || null;
  if (input.email !== undefined) data.email = input.email?.trim() || null;
  if (input.phone !== undefined) data.phone = input.phone?.trim() || null;
  if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle?.trim() || null;
  if (input.industry !== undefined) data.industry = input.industry?.trim() || null;
  if (input.location !== undefined) data.location = input.location?.trim() || null;
  if (input.country !== undefined) data.country = input.country?.trim() || null;
  if (input.state !== undefined) data.state = input.state?.trim() || null;
  if (input.city !== undefined) data.city = input.city?.trim() || null;
  if (input.website !== undefined) {
    const website = input.website?.trim() || null;
    data.website = website;
    data.domain = website ? normalizeDomain(website) : null;
  }
  if (input.status !== undefined) data.status = input.status;
  if (input.sourceDetail !== undefined) data.sourceDetail = input.sourceDetail?.trim() || null;
  if (input.assignedToId !== undefined)
    data.assignedTo = input.assignedToId
      ? { connect: { id: input.assignedToId } }
      : { disconnect: true };
  if (input.leadScore !== undefined) data.leadScore = input.leadScore;

  const lead = await db.lead.update({ where: { id }, data });

  if (input.status && input.status !== existing.status) {
    await db.leadActivity.create({
      data: {
        organizationId,
        leadId: id,
        type: "status-changed",
        title: `Status: ${existing.status} → ${input.status}`,
        actorId,
      },
    });
  }
  return lead;
}

export async function deleteLead(organizationId: string, id: string) {
  const existing = await db.lead.findFirst({ where: { id, organizationId } });
  if (!existing) return false;
  await db.lead.delete({ where: { id } });
  return true;
}
