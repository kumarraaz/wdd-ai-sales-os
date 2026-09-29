import { db } from "./db";

/**
 * Workspace quotas (Phase 1: lead limits; Phase 2: discovery limits;
 * AI/message quotas arrive with those features).
 * Limits come from the org's Plan. Enforcement points call these before writes.
 */

function todayPeriod(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

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
      discoverySearchesPerDay: 20,
      discoveryRecordsPerDay: 200,
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
  const [leads, aiTokens, messages, discovery] = await Promise.all([
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
    db.usageCounter.findUnique({
      where: {
        organizationId_period: { organizationId, period: todayPeriod() },
      },
      select: { discoveries: true, discoveryRecords: true },
    }),
  ]);
  const ai = (aiTokens._sum.tokensIn ?? 0) + (aiTokens._sum.tokensOut ?? 0);
  return {
    leads: { used: leads, limit: limits.maxLeads },
    aiTokens: { used: ai, limit: limits.aiTokensPerDay },
    messages: { used: messages, limit: limits.messagesPerDay },
    discovery: {
      searches: {
        used: discovery?.discoveries ?? 0,
        limit: limits.discoverySearchesPerDay,
      },
      records: {
        used: discovery?.discoveryRecords ?? 0,
        limit: limits.discoveryRecordsPerDay,
      },
    },
  };
}

/** Today's discovery usage for quota enforcement. */
export async function getDiscoveryUsageToday(organizationId: string): Promise<{
  searches: number;
  records: number;
}> {
  const counter = await db.usageCounter.findUnique({
    where: { organizationId_period: { organizationId, period: todayPeriod() } },
    select: { discoveries: true, discoveryRecords: true },
  });
  return {
    searches: counter?.discoveries ?? 0,
    records: counter?.discoveryRecords ?? 0,
  };
}

/**
 * Check whether a discovery search is allowed. `expectedRecords` is the
 * caller's maxResults — the quota is enforced upfront so a workspace can
 * never silently exceed its configured limits.
 */
export async function checkDiscoveryQuota(
  organizationId: string,
  expectedRecords: number,
): Promise<{
  allowed: boolean;
  reason?: string;
  searches: { used: number; limit: number };
  records: { used: number; limit: number };
}> {
  const limits = await getPlanLimits(organizationId);
  const used = await getDiscoveryUsageToday(organizationId);
  const searches = { used: used.searches, limit: limits.discoverySearchesPerDay };
  const records = { used: used.records, limit: limits.discoveryRecordsPerDay };
  if (used.searches >= limits.discoverySearchesPerDay) {
    return {
      allowed: false,
      reason: `Daily discovery search limit reached (${used.searches}/${limits.discoverySearchesPerDay}).`,
      searches,
      records,
    };
  }
  if (used.records + expectedRecords > limits.discoveryRecordsPerDay) {
    return {
      allowed: false,
      reason: `Daily discovery record limit would be exceeded (${used.records}+${expectedRecords}/${limits.discoveryRecordsPerDay}).`,
      searches,
      records,
    };
  }
  return { allowed: true, searches, records };
}

/** Increment today's discovery counters (searches, records found, records imported). */
export async function recordDiscoveryUsage(
  organizationId: string,
  delta: { searches?: number; records?: number; imports?: number },
): Promise<void> {
  const period = todayPeriod();
  await db.usageCounter.upsert({
    where: { organizationId_period: { organizationId, period } },
    create: {
      organizationId,
      period,
      discoveries: delta.searches ?? 0,
      discoveryRecords: delta.records ?? 0,
      discoveryImports: delta.imports ?? 0,
    },
    update: {
      discoveries: { increment: delta.searches ?? 0 },
      discoveryRecords: { increment: delta.records ?? 0 },
      discoveryImports: { increment: delta.imports ?? 0 },
    },
  });
}
