import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { discoverySearchSchema } from "@/lib/validators";
import { getDiscoveryProvider } from "@/lib/discovery/registry";
import { DiscoveryError } from "@/lib/discovery/types";
import {
  checkDiscoveryQuota,
  recordDiscoveryUsage,
} from "@/lib/quotas";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * POST /api/discovery/search
 * Body: { providerId, keyword, country?, state?, city?, radiusMeters?,
 *         maxResults?, category?, latitude?, longitude? }
 *
 * Runs a compliant discovery search via the chosen provider. Quota is
 * enforced BEFORE the provider is called so a workspace can never silently
 * exceed its configured limits. Every search is recorded as a DiscoveryRun
 * and counted in the daily UsageCounter.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`discovery:${ctx.user.id}`, LIMITS.discovery);
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = discoverySearchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const provider = getDiscoveryProvider(input.providerId);
    if (!provider || !provider.searchable) {
      return NextResponse.json({ error: "UNKNOWN_PROVIDER" }, { status: 400 });
    }
    if (!provider.isConfigured()) {
      return NextResponse.json(
        {
          error: "PROVIDER_NOT_CONFIGURED",
          providerId: provider.id,
          setupInstructions: provider.setupInstructions(),
        },
        { status: 409 },
      );
    }

    const quota = await checkDiscoveryQuota(ctx.organization.id, input.maxResults);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: "DISCOVERY_QUOTA_EXCEEDED",
          reason: quota.reason,
          quota: { searches: quota.searches, records: quota.records },
        },
        { status: 403 },
      );
    }

    const run = await db.discoveryRun.create({
      data: {
        organizationId: ctx.organization.id,
        providerId: provider.id,
        params: { ...input },
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    try {
      const result = await provider.search({
        keyword: input.keyword,
        country: input.country,
        state: input.state,
        city: input.city,
        radiusMeters: input.radiusMeters,
        maxResults: input.maxResults,
        category: input.category,
        latitude: input.latitude,
        longitude: input.longitude,
      });

      await db.discoveryRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          finishedAt: new Date(),
          stats: { found: result.companies.length },
        },
      });
      await recordDiscoveryUsage(ctx.organization.id, {
        searches: 1,
        records: result.companies.length,
      });
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "discovery.search",
        resource: "DiscoveryRun",
        resourceId: run.id,
        metadata: {
          provider: provider.id,
          keyword: input.keyword,
          found: result.companies.length,
        },
        req,
      });

      return NextResponse.json({
        provider: result.provider,
        searchedAt: result.searchedAt,
        companies: result.companies,
        quota: {
          searches: {
            used: quota.searches.used + 1,
            limit: quota.searches.limit,
          },
          records: {
            used: quota.records.used + result.companies.length,
            limit: quota.records.limit,
          },
        },
      });
    } catch (err) {
      const message =
        err instanceof DiscoveryError ? err.message : "Discovery search failed.";
      await db.discoveryRun.update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(), error: message },
      });
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "discovery.search",
        resource: "DiscoveryRun",
        resourceId: run.id,
        result: "FAILED",
        metadata: { provider: provider.id, keyword: input.keyword, error: message },
        req,
      });
      const status =
        err instanceof DiscoveryError && err.code === "PROVIDER_NOT_CONFIGURED"
          ? 409
          : 502;
      return NextResponse.json({ error: "PROVIDER_ERROR", message }, { status });
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
