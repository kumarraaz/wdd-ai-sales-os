import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { db } from "@/lib/db";
import { getWebSearchProvider } from "@/lib/research/search-provider";
import { getDiscoveryProvider } from "@/lib/discovery/registry";
import { getAIProvider } from "@/lib/ai/registry";

/**
 * GET /api/system/health — server-side configuration health (SALES_MANAGER+).
 * Never exposes secret values — only CONFIGURED / NOT_CONFIGURED style
 * statuses so the user can see why the agent has no data to work with.
 */
export const GET = withWorkspace(
  async (_req: NextRequest, _ctx) => {
    // Database
    let database: "CONNECTED" | "ERROR" = "ERROR";
    try {
      await db.$queryRaw`SELECT 1`;
      database = "CONNECTED";
    } catch {
      database = "ERROR";
    }

    // Public web search (Tavily today)
    const webSearch = getWebSearchProvider();
    const tavily = webSearch.isConfigured() ? "CONFIGURED" : "NOT_CONFIGURED";

    // Google Places
    let googlePlaces: "CONFIGURED" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
    try {
      const gp = getDiscoveryProvider("google-places");
      if (gp?.isConfigured()) googlePlaces = "CONFIGURED";
    } catch {
      /* treat as not configured */
    }

    // AI provider
    let aiProvider: "CONFIGURED" | "NOT_CONFIGURED" = "NOT_CONFIGURED";
    try {
      if (getAIProvider().isConfigured()) aiProvider = "CONFIGURED";
    } catch {
      /* treat as not configured */
    }

    // Automation: ACTIVE when a prospecting plan exists and is active and
    // the kill switch is off; PAUSED otherwise.
    let automation: "ACTIVE" | "PAUSED" = "PAUSED";
    try {
      const plan = await db.instagramProspectingPlan.findFirst({
        where: { organizationId: _ctx.organization.id },
        select: { isActive: true },
      });
      const killSwitch = process.env.WDD_AUTOMATION_KILL_SWITCH === "true";
      if (plan?.isActive && !killSwitch) automation = "ACTIVE";
    } catch {
      /* leave PAUSED */
    }

    // Last prospecting runs (§19) — statuses and counts only, never secrets.
    let lastSuccessfulRun: {
      runDate: string;
      crmImported: number;
      finishedAt: string | null;
    } | null = null;
    let lastFailedRun: {
      runDate: string;
      failureReason: string | null;
      error: string | null;
      finishedAt: string | null;
    } | null = null;
    let lastImportCount: number | null = null;
    try {
      const okRun = await db.instagramProspectingRun.findFirst({
        where: { organizationId: _ctx.organization.id, status: "COMPLETED" },
        orderBy: { finishedAt: "desc" },
        select: { runDate: true, crmImported: true, finishedAt: true },
      });
      if (okRun) {
        lastSuccessfulRun = {
          runDate: okRun.runDate,
          crmImported: okRun.crmImported,
          finishedAt: okRun.finishedAt?.toISOString() ?? null,
        };
        lastImportCount = okRun.crmImported;
      }
      const failedRun = await db.instagramProspectingRun.findFirst({
        where: { organizationId: _ctx.organization.id, status: "FAILED" },
        orderBy: { finishedAt: "desc" },
        select: { runDate: true, failureReason: true, error: true, finishedAt: true },
      });
      if (failedRun) {
        lastFailedRun = {
          runDate: failedRun.runDate,
          failureReason: failedRun.failureReason,
          // First line only — never stack traces.
          error: failedRun.error?.split("\n")[0].slice(0, 300) ?? null,
          finishedAt: failedRun.finishedAt?.toISOString() ?? null,
        };
      }
    } catch {
      /* run history is best-effort */
    }

    return NextResponse.json({
      tavily,
      tavilyDetail: webSearch.statusDetail(),
      googlePlaces,
      aiProvider,
      database,
      automation,
      lastSuccessfulRun,
      lastFailedRun,
      lastImportCount,
      checkedAt: new Date().toISOString(),
    });
  },
  { minRole: "SALES_MANAGER" },
);
