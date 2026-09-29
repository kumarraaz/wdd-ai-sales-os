import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { websiteInspectSchema } from "@/lib/validators";
import { runWebsiteInspection } from "@/lib/intelligence/inspect";
import { SafeFetchError } from "@/lib/intelligence/safe-fetch";
import { SafeUrlError } from "@/lib/ssrf";
import {
  checkWebsiteInspectionQuota,
  recordWebsiteInspectionUsage,
} from "@/lib/quotas";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * POST /api/intelligence/website-inspect
 * Body: { url?: string, leadId?: string } — at least one required.
 *
 * Safely inspects a publicly accessible website through the SSRF-hardened
 * fetcher and stores a structured technical report. Quota is enforced
 * BEFORE any external request is made. Failures are recorded as FAILED
 * inspections with the reason — never fabricated.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(
      `website-inspect:${ctx.user.id}`,
      LIMITS.websiteInspect,
    );
    if (!rl.success) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const parsed = websiteInspectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Resolve the target URL. A leadId links the inspection to a lead in
    // THIS workspace — the lead lookup is tenant-scoped, never trusted
    // from the client alone.
    let url = parsed.data.url?.trim() || null;
    let leadId: string | null = null;
    let companyId: string | null = null;
    if (parsed.data.leadId) {
      const lead = await db.lead.findFirst({
        where: { id: parsed.data.leadId, organizationId: ctx.organization.id },
        select: { id: true, website: true, companyId: true },
      });
      if (!lead) {
        return NextResponse.json({ error: "LEAD_NOT_FOUND" }, { status: 404 });
      }
      leadId = lead.id;
      companyId = lead.companyId;
      if (!url) url = lead.website?.trim() || null;
    }
    if (!url) {
      return NextResponse.json(
        { error: "NO_WEBSITE", message: "The lead has no website URL to inspect." },
        { status: 422 },
      );
    }

    const quota = await checkWebsiteInspectionQuota(ctx.organization.id);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: "INSPECTION_QUOTA_EXCEEDED",
          reason: quota.reason,
          quota: { used: quota.used, limit: quota.limit },
        },
        { status: 403 },
      );
    }

    const inspection = await db.websiteInspection.create({
      data: {
        organizationId: ctx.organization.id,
        leadId,
        companyId,
        requestedUrl: url,
        status: "RUNNING",
      },
    });

    const finish = async (
      status: "COMPLETED" | "FAILED",
      patch: Record<string, unknown>,
    ) => {
      const updated = await db.websiteInspection.update({
        where: { id: inspection.id },
        data: { status, ...patch },
      });
      return updated;
    };

    try {
      const findings = await runWebsiteInspection(url);
      const done = await finish("COMPLETED", {
        finalUrl: findings.finalUrl,
        httpStatus: findings.httpStatus,
        findings: findings as object,
        inspectedAt: new Date(),
      });
      await recordWebsiteInspectionUsage(ctx.organization.id);
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "intelligence.website_inspect",
        resource: "WebsiteInspection",
        resourceId: done.id,
        metadata: {
          url,
          finalUrl: findings.finalUrl,
          httpStatus: findings.httpStatus,
          leadId,
        },
        req,
      });
      return NextResponse.json({ inspection: done });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Website inspection failed.";
      const done = await finish("FAILED", { error: message });
      await recordWebsiteInspectionUsage(ctx.organization.id);
      await audit({
        organizationId: ctx.organization.id,
        actorId: ctx.user.id,
        action: "intelligence.website_inspect",
        resource: "WebsiteInspection",
        resourceId: done.id,
        result: "FAILED",
        metadata: { url, leadId, error: message },
        req,
      });

      // Safety blocks are client errors; network failures are recorded
      // results returned with 200 so the UI can show them clearly.
      const isSafetyBlock =
        err instanceof SafeUrlError ||
        (err instanceof SafeFetchError && err.code === "BLOCKED");
      if (isSafetyBlock) {
        return NextResponse.json(
          { error: "UNSAFE_URL", message, inspection: done },
          { status: 422 },
        );
      }
      return NextResponse.json({ inspection: done });
    }
  },
  { minRole: "SALES_EXECUTIVE" },
);
