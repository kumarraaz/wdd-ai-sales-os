import type { Metadata } from "next";
import { Kanban } from "@/components/app/Kanban";
import { DemoBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CRM pipeline" };

export default async function CrmPage() {
  const ctx = await getPageContext();

  return (
    <div className="space-y-5">
      <PageHeader
        title="CRM pipeline"
        description="Drag cards between stages — every move is saved and logged."
        badge={ctx.demo ? <DemoBadge /> : undefined}
      />
      {ctx.demo ? (
        // Demo mode: the board reads the read-only /api/demo fixtures; moves are blocked.
        <Kanban orgId="demo" canWrite apiBase="/api/demo" demo />
      ) : (
        <Kanban orgId={ctx.organizationId} canWrite={ctx.role !== "VIEWER"} />
      )}
    </div>
  );
}
