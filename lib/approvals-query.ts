import type { Prisma } from "@prisma/client";

/**
 * "Awaiting approval" = PENDING and not past its expiry. Expiry is applied lazily
 * (see lib/agent/approvals/service.ts): a PENDING row past `expiresAt` is treated as
 * EXPIRED and can no longer be approved, so it must not be counted or offered for review.
 */
export function pendingApprovalWhere(organizationId: string, now: Date = new Date()): Prisma.AgentApprovalWhereInput {
  return {
    organizationId,
    status: "PENDING",
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}
