/**
 * Job handlers (Phase 3).
 *
 * Each handler wraps an existing implementation — no business logic is
 * duplicated here:
 *   discovery.pipeline → lib/discovery/pipeline.ts runDiscoveryPipeline
 *   research.website   → lib/intelligence/inspect.ts runWebsiteInspection
 *   research.lead      → lib/intelligence/generate.ts generateLeadIntelligence
 *   lead.scoring       → lib/intelligence/scoring.ts calculateScore (+ existing leadScore persistence)
 *   followup.create    → FollowUp model (same invariants as the Phase 2 tool)
 *   message.generate   → Phase 1 AI provider + Message DRAFT (never sends)
 *
 * Handlers never execute arbitrary code: the job type maps to a fixed
 * function, payloads are Zod-validated, and secret-like payload keys are
 * rejected.
 */
import { z } from "zod";
import { Channel } from "@prisma/client";
import { db } from "../db";
import { getDiscoveryProvider, listDiscoveryProviders } from "../discovery/registry";
import {
  runDiscoveryPipeline,
  type PipelineDeps,
} from "../discovery/pipeline";
import { findMatchForCompany } from "../discovery/import";
import { runWebsiteInspection } from "../intelligence/inspect";
import {
  generateLeadIntelligence,
  IntelligenceError,
} from "../intelligence/generate";
import {
  calculateScore,
  SCORING_VERSION,
} from "../intelligence/scoring";
import { SafeFetchError } from "../intelligence/safe-fetch";
import { DiscoveryError } from "../discovery/types";
import { getLead } from "../leads";
import { getAIProvider } from "../ai/registry";
import { runDailyProspecting } from "../prospecting/instagram-pipeline";
import {
  checkDiscoveryQuota,
  recordDiscoveryUsage,
  checkWebsiteInspectionQuota,
  recordWebsiteInspectionUsage,
  checkAiIntelligenceQuota,
  recordAiIntelligenceUsage,
  recordLeadScoringUsage,
} from "../quotas";
import type { JobContext, JobTypeName } from "./types";
import { JobError } from "./types";

// ── Shared payload guards ────────────────────────────────────────────────

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be a valid http(s) URL." },
  );

/** Metadata stamped by the scheduler; never trusted from raw callers. */
const jobMetadataFields = {
  automationId: z.string().cuid().optional(),
  automationActionId: z.string().cuid().optional(),
  /** Carried for future approval enforcement; not enforced in Phase 3. */
  requiresApproval: z.boolean().optional(),
};

const SECRET_KEY_RE =
  /api[_-]?key|secret|token|password|passwd|pwd|credential|private[_-]?key|authorization/i;

/** Reject secret-like keys anywhere in the payload (keys only, recursive). */
export function assertNoSecrets(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        throw new JobError(
          "SECRET_IN_PAYLOAD",
          `Secret-like key "${path}.${k}" is not allowed in job payloads.`,
          false,
        );
      }
      assertNoSecrets(v, `${path}.${k}`);
    }
  }
}

function parsePayload<T extends z.ZodTypeAny>(
  schema: T,
  raw: unknown,
  jobType: string,
): z.infer<T> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new JobError(
      "VALIDATION_ERROR",
      first
        ? `Invalid payload for job "${jobType}": ${first.path.join(".") || "(root)"} — ${first.message}`
        : `Invalid payload for job "${jobType}".`,
      false,
    );
  }
  return parsed.data;
}

/** Map domain errors to typed JobErrors with retry semantics. */
function mapDomainError(err: unknown): JobError {
  if (err instanceof JobError) return err;
  if (err instanceof DiscoveryError) {
    const permanent = [
      "INVALID_QUERY",
      "SEARCH_UNSUPPORTED",
      "PROVIDER_NOT_CONFIGURED",
    ].includes(err.code);
    return new JobError(err.code, err.message, !permanent);
  }
  if (err instanceof IntelligenceError) {
    const permanent = [
      "INSUFFICIENT_DATA",
      "NOT_CONFIGURED",
      "SCHEMA_ERROR",
      "INVALID_RESPONSE",
    ].includes(err.code);
    return new JobError(err.code, err.message, !permanent);
  }
  if (err instanceof SafeFetchError) {
    return new JobError("WEBSITE_UNREACHABLE", err.message, true);
  }
  return new JobError(
    "HANDLER_ERROR",
    err instanceof Error ? err.message : "Handler failed.",
    true,
  );
}

function resolveSearchProvider(providerId?: string) {
  if (providerId) {
    const provider = getDiscoveryProvider(providerId);
    if (!provider) {
      throw new JobError("UNKNOWN_PROVIDER", `Unknown discovery provider "${providerId}".`, false);
    }
    if (!provider.searchable) {
      throw new JobError("SEARCH_UNSUPPORTED", `Provider "${providerId}" cannot search.`, false);
    }
    if (!provider.isConfigured()) {
      throw new JobError("PROVIDER_NOT_CONFIGURED", `Provider "${providerId}" is not configured.`, false);
    }
    return provider;
  }
  const fallback = listDiscoveryProviders().find((p) => p.searchable && p.isConfigured());
  if (!fallback) {
    throw new JobError("PROVIDER_NOT_CONFIGURED", "No discovery provider is configured.", false);
  }
  return fallback;
}

// ── discovery.pipeline ───────────────────────────────────────────────────

const discoveryPipelinePayload = z
  .object({
    industry: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(300),
    websiteFilter: z.enum(["any", "has_website", "no_website"]).default("any"),
    opportunity: z
      .enum(["website_improvement", "new_website", "seo", "any"])
      .default("any"),
    limit: z.number().int().min(1).max(50).default(10),
    category: z.string().trim().max(120).optional(),
    providerId: z.string().trim().max(60).optional(),
    ...jobMetadataFields,
  })
  .strict();

async function handleDiscoveryPipeline(ctx: JobContext, raw: unknown) {
  const input = parsePayload(discoveryPipelinePayload, raw, "discovery.pipeline");
  const provider = resolveSearchProvider(input.providerId);
  const quota = await checkDiscoveryQuota(ctx.organizationId, input.limit);
  if (!quota.allowed) {
    throw new JobError("QUOTA_EXCEEDED", quota.reason ?? "Discovery quota exceeded.", false);
  }
  const deps: PipelineDeps = {
    search: (query) => provider.search(query),
    checkDuplicate: (company) =>
      findMatchForCompany(ctx.organizationId, provider, company),
    researchWebsite: (url) => runWebsiteInspection(url),
    generateAI: (lead, company, inspection) =>
      generateLeadIntelligence(lead, company, inspection),
    score: (lead, inspection) =>
      calculateScore(
        {
          id: lead.id,
          website: lead.website,
          phone: lead.phone,
          industry: lead.industry,
          city: lead.city,
          country: lead.country,
          location: lead.location,
          rating: lead.rating,
          reviewCount: lead.reviewCount,
          externalId: lead.externalId,
          sourceUrl: lead.sourceUrl,
        },
        inspection ? { id: inspection.id, findings: inspection.findings } : null,
        null,
      ),
  };
  try {
    const { summary } = await runDiscoveryPipeline(
      {
        industry: input.industry,
        location: input.location,
        websiteFilter: input.websiteFilter,
        opportunity: input.opportunity,
        limit: input.limit,
        category: input.category,
      },
      deps,
      () => {},
    );
    await recordDiscoveryUsage(ctx.organizationId, {
      searches: 1,
      records: summary.searched,
    });
    return { summary };
  } catch (err) {
    throw mapDomainError(err);
  }
}

// ── research.website ─────────────────────────────────────────────────────

const researchWebsitePayload = z
  .object({ url: httpUrl, ...jobMetadataFields })
  .strict();

async function handleResearchWebsite(ctx: JobContext, raw: unknown) {
  const input = parsePayload(researchWebsitePayload, raw, "research.website");
  const quota = await checkWebsiteInspectionQuota(ctx.organizationId);
  if (!quota.allowed) {
    throw new JobError("QUOTA_EXCEEDED", quota.reason ?? "Website inspection quota exceeded.", false);
  }
  try {
    const findings = await runWebsiteInspection(input.url);
    await recordWebsiteInspectionUsage(ctx.organizationId);
    return {
      findings: {
        requestedUrl: findings.requestedUrl,
        finalUrl: findings.finalUrl,
        httpStatus: findings.httpStatus,
        https: findings.https,
        title: findings.title,
        metaDescription: findings.metaDescription,
      },
    };
  } catch (err) {
    throw mapDomainError(err);
  }
}

// ── research.lead ────────────────────────────────────────────────────────

const researchLeadPayload = z
  .object({
    leadId: z.string().cuid(),
    website: httpUrl.optional(),
    ...jobMetadataFields,
  })
  .strict();

async function handleResearchLead(ctx: JobContext, raw: unknown) {
  const input = parsePayload(researchLeadPayload, raw, "research.lead");
  const lead = await getLead(ctx.organizationId, input.leadId);
  if (!lead) {
    throw new JobError("LEAD_NOT_FOUND", "Lead not found in this organization.", false);
  }
  const website = input.website ?? lead.website ?? undefined;
  let findings: Awaited<ReturnType<typeof runWebsiteInspection>> | null = null;
  if (website) {
    const quota = await checkWebsiteInspectionQuota(ctx.organizationId);
    if (!quota.allowed) {
      throw new JobError("QUOTA_EXCEEDED", quota.reason ?? "Website inspection quota exceeded.", false);
    }
    try {
      findings = await runWebsiteInspection(website);
      await recordWebsiteInspectionUsage(ctx.organizationId);
    } catch (err) {
      throw mapDomainError(err);
    }
  }
  const aiQuota = await checkAiIntelligenceQuota(ctx.organizationId);
  if (!aiQuota.allowed) {
    throw new JobError("QUOTA_EXCEEDED", aiQuota.reason ?? "AI quota exceeded.", false);
  }
  try {
    const result = await generateLeadIntelligence(
      {
        id: lead.id,
        fullName: lead.fullName,
        jobTitle: lead.jobTitle,
        email: lead.email,
        phone: lead.phone,
        website: lead.website,
        industry: lead.industry,
        location: lead.location,
        city: lead.city,
        country: lead.country,
        sourceType: lead.sourceType,
        status: lead.status,
        externalId: lead.externalId,
        sourceUrl: lead.sourceUrl,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
      },
      lead.company
        ? {
            id: lead.company.id,
            name: lead.company.name,
            website: lead.company.website,
            industry: lead.company.industry,
            city: lead.company.city,
            country: lead.company.country,
          }
        : null,
      findings
        ? {
            id: lead.id,
            requestedUrl: findings.requestedUrl,
            findings: findings as unknown as Record<string, unknown>,
          }
        : null,
    );
    await recordAiIntelligenceUsage(ctx.organizationId);
    return { intelligence: result.output, warnings: result.warnings };
  } catch (err) {
    throw mapDomainError(err);
  }
}

// ── lead.scoring ─────────────────────────────────────────────────────────

const leadScoringPayload = z
  .object({
    leadId: z.string().cuid(),
    website: httpUrl.optional(),
    ...jobMetadataFields,
  })
  .strict();

async function handleLeadScoring(ctx: JobContext, raw: unknown) {
  const input = parsePayload(leadScoringPayload, raw, "lead.scoring");
  const lead = await getLead(ctx.organizationId, input.leadId);
  if (!lead) {
    throw new JobError("LEAD_NOT_FOUND", "Lead not found in this organization.", false);
  }
  const website = input.website ?? lead.website ?? undefined;
  let findings: Awaited<ReturnType<typeof runWebsiteInspection>> | null = null;
  const warnings: string[] = [];
  if (website) {
    try {
      findings = await runWebsiteInspection(website);
    } catch (err) {
      // Mirror the pipeline: uninspectable sites score without website
      // data rather than failing the job.
      warnings.push(err instanceof Error ? err.message : "Website inspection failed.");
    }
  }
  const result = calculateScore(
    {
      id: lead.id,
      fullName: lead.fullName,
      website: lead.website,
      phone: lead.phone,
      email: lead.email,
      industry: lead.industry,
      city: lead.city,
      country: lead.country,
      location: lead.location,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      externalId: lead.externalId,
      sourceUrl: lead.sourceUrl,
      company: lead.company
        ? {
            id: lead.company.id,
            name: lead.company.name,
            website: lead.company.website,
            industry: lead.company.industry,
            city: lead.company.city,
            country: lead.company.country,
          }
        : null,
    },
    findings
      ? { id: lead.id, findings: findings as unknown as Record<string, unknown> }
      : null,
    null,
  );
  // Persist exactly like the existing lead-score route (deterministic only).
  const record = await db.leadScore.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: lead.id,
      score: result.score,
      scoreBand: result.scoreBand,
      scoringVersion: SCORING_VERSION,
      factors: result.factors as object,
      evidence: result.evidence as object,
      provider: "deterministic",
      aiEnriched: false,
      warnings: warnings as object,
      breakdown: {},
      model: "wdd-scoring-v1",
    },
  });
  await recordLeadScoringUsage(ctx.organizationId);
  return { leadScoreId: record.id, score: result.score, scoreBand: result.scoreBand };
}

// ── followup.create ──────────────────────────────────────────────────────

const followupCreatePayload = z
  .object({
    leadId: z.string().cuid(),
    channel: z.nativeEnum(Channel),
    scheduledAt: z
      .string()
      .datetime()
      .refine((v) => new Date(v).getTime() > Date.now(), {
        message: "scheduledAt must be in the future.",
      }),
    body: z.string().trim().max(5000).optional(),
    ...jobMetadataFields,
  })
  .strict();

async function handleFollowupCreate(ctx: JobContext, raw: unknown) {
  const input = parsePayload(followupCreatePayload, raw, "followup.create");
  const lead = await getLead(ctx.organizationId, input.leadId);
  if (!lead) {
    throw new JobError("LEAD_NOT_FOUND", "Lead not found in this organization.", false);
  }
  const followUp = await db.followUp.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: input.leadId,
      channel: input.channel,
      scheduledAt: new Date(input.scheduledAt),
      body: input.body,
    },
  });
  return { followUpId: followUp.id };
}

// ── message.generate (DRAFT ONLY — never sends) ──────────────────────────

const messageGeneratePayload = z
  .object({
    leadId: z.string().cuid().optional(),
    channel: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN"]),
    subject: z.string().trim().max(300).optional(),
    /** Verified facts the message may use. Never invent beyond these. */
    facts: z.record(z.string(), z.string().max(500)).default({}),
    tone: z.enum(["professional", "friendly", "concise"]).default("professional"),
    ...jobMetadataFields,
  })
  .strict();

async function handleMessageGenerate(ctx: JobContext, raw: unknown) {
  const input = parsePayload(messageGeneratePayload, raw, "message.generate");
  let lead: Awaited<ReturnType<typeof getLead>> = null;
  if (input.leadId) {
    lead = await getLead(ctx.organizationId, input.leadId);
    if (!lead) {
      throw new JobError("LEAD_NOT_FOUND", "Lead not found in this organization.", false);
    }
  }
  const aiQuota = await checkAiIntelligenceQuota(ctx.organizationId);
  if (!aiQuota.allowed) {
    throw new JobError("QUOTA_EXCEEDED", aiQuota.reason ?? "AI quota exceeded.", false);
  }
  const facts: Record<string, string> = { ...input.facts };
  if (lead) {
    if (lead.fullName) facts.contactName = lead.fullName;
    if (lead.company?.name) facts.companyName = lead.company.name;
    if (lead.industry) facts.industry = lead.industry;
    if (lead.city || lead.country) {
      facts.location = [lead.city, lead.country].filter(Boolean).join(", ");
    }
  }
  const factLines = Object.entries(facts)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const system =
    "You write short sales outreach message drafts. Use ONLY the verified facts provided below. " +
    "Do not invent names, companies, numbers, offers, or claims. If facts are sparse, keep the message short and generic. " +
    "Return only the message body, no preamble.";
  const user =
    `Channel: ${input.channel}\nTone: ${input.tone}\n` +
    (input.subject ? `Subject: ${input.subject}\n` : "") +
    `Verified facts:\n${factLines || "(none provided)"}`;
  let body: string;
  try {
    const provider = getAIProvider();
    const gen = await provider.generateText(system, user, { maxTokens: 500 });
    body = gen.text.trim();
    if (!body) throw new JobError("INVALID_RESPONSE", "Message generation returned no content.", true);
    await recordAiIntelligenceUsage(ctx.organizationId);
  } catch (err) {
    throw mapDomainError(err);
  }
  // Draft only: status stays DRAFT, approval required. No send path exists here.
  const message = await db.message.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: input.leadId,
      channel: input.channel as Channel,
      direction: "OUTBOUND",
      status: "DRAFT",
      subject: input.subject,
      body,
      approvalMode: "APPROVAL_REQUIRED",
      dataLabel: "USER_PROVIDED",
      personalizationUsed: JSON.stringify({ facts: Object.keys(facts), tone: input.tone }),
    },
  });
  return { messageId: message.id, channel: input.channel };
}

// ── Registry ─────────────────────────────────────────────────────────────

type Handler = (ctx: JobContext, payload: unknown) => Promise<{ summary?: unknown } | unknown>;

// ── prospecting.instagram.daily ──────────────────────────────────────────

const prospectingInstagramDailyPayload = z
  .object({
    planId: z.string().cuid().optional(),
    /** true when enqueued from the manual "Run Now" button. */
    manual: z.boolean().optional(),
    ...jobMetadataFields,
  })
  .strict();

async function handleProspectingInstagramDaily(ctx: JobContext, raw: unknown) {
  const input = parsePayload(
    prospectingInstagramDailyPayload,
    raw,
    "prospecting.instagram.daily",
  );
  // The pipeline is idempotent per org/day and enforces quotas, kill
  // switch, and global dedup internally.
  const stats = await runDailyProspecting(ctx.organizationId, ctx.actorId, {
    triggeredBy: input.manual ? "MANUAL" : "SCHEDULED",
  });
  if (stats.status === "FAILED") {
    throw new JobError("PROSPECTING_RUN_FAILED", "Instagram prospecting run failed.", true);
  }
  return {
    runId: stats.runId,
    runDate: stats.runDate,
    found: stats.found,
    newCount: stats.newCount,
    crmImported: stats.crmImported,
  };
}

const JOB_HANDLERS: Record<JobTypeName, { schema: z.ZodTypeAny; handler: Handler }> = {
  "discovery.pipeline": { schema: discoveryPipelinePayload, handler: handleDiscoveryPipeline },
  "research.website": { schema: researchWebsitePayload, handler: handleResearchWebsite },
  "research.lead": { schema: researchLeadPayload, handler: handleResearchLead },
  "lead.scoring": { schema: leadScoringPayload, handler: handleLeadScoring },
  "followup.create": { schema: followupCreatePayload, handler: handleFollowupCreate },
  "message.generate": { schema: messageGeneratePayload, handler: handleMessageGenerate },
  "prospecting.instagram.daily": {
    schema: prospectingInstagramDailyPayload,
    handler: handleProspectingInstagramDaily,
  },
};

/** Payload schemas by job type — used by enqueueJob for validation. */
export const JOB_PAYLOAD_SCHEMAS: Record<JobTypeName, z.ZodTypeAny> =
  Object.fromEntries(
    Object.entries(JOB_HANDLERS).map(([type, { schema }]) => [type, schema]),
  ) as Record<JobTypeName, z.ZodTypeAny>;

export function listJobTypes(): JobTypeName[] {
  return Object.keys(JOB_HANDLERS) as JobTypeName[];
}

export function isKnownJobType(type: string): type is JobTypeName {
  return type in JOB_HANDLERS;
}

/** Returns undefined for unknown types — the runner fails those safely. */
export function getJobHandler(type: string): Handler | undefined {
  return (JOB_HANDLERS as Record<string, { handler: Handler }>)[type]?.handler;
}
