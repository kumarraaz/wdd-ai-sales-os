import type { Metadata } from "next";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { ProspectingDashboard } from "@/components/prospecting/ProspectingDashboard";
import { DemoBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prospecting" };

export default async function ProspectingPage() {
  const ctx = await getPageContext();

  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="AI prospecting" badge={<DemoBadge />} />
        <DemoUnavailable what="Prospecting">
          Prospecting runs against connected data sources in a real workspace. Demo mode never calls external services.
        </DemoUnavailable>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI prospecting"
        description="Find real prospects from connected data sources, verify them, research them, and import qualified leads into CRM. 7-day weekly plan, daily automated discovery at 9:00 AM — drafts only, nothing is sent automatically."
      />
      <ProspectingDashboard
        orgId={ctx.organizationId}
        canManage={ctx.role === "OWNER" || ctx.role === "SALES_MANAGER"}
        canRun={ctx.role !== "VIEWER"}
      />
    </div>
  );
}
