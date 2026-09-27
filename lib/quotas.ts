import { db } from "./db";

/**
 * Workspace quotas (Phase 1: lead limits; AI/message quotas arrive with those features).
 * Limits come from the org's Plan. Enforcement points call these before writes.
 */
export async function getPlanLimits(organizationId: string) {
  const sub = await db.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });
  // Sensible FREE defaults if provisioning hasn't run yet.
  return (
    sub?.plan ?? {
      maxLeads: 500,
      maxUsers: 3,
      aiTokensPerDay: 100_000,
      messagesPerDay: 200,
    }
  );
}

export async function checkLeadQuota(organizationId: string): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  const limits = await getPlanLimits(organizationId);
  const used = await db.lead.count({ where: { organizationId } });
  return { allowed: used < limits.maxLeads, used, limit: limits.maxLeads };
}

export async function getUsage(organizationId: string) {
  const limits = await getPlanLimits(organizationId);
  const [leads, aiTokens, messages] = await Promise.all([
    db.lead.count({ where: { organizationId } }),
    db.aIUsage.aggregate({
      where: {
        organizationId,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      _sum: { tokensIn: true, tokensOut: true },
    }),
    db.message.count({
      where: {
        organizationId,
        direction: "OUTBOUND",
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);
  const ai = (aiTokens._sum.tokensIn ?? 0) + (aiTokens._sum.tokensOut ?? 0);
  return {
    leads: { used: leads, limit: limits.maxLeads },
    aiTokens: { used: ai, limit: limits.aiTokensPerDay },
    messages: { used: messages, limit: limits.messagesPerDay },
  };
}
