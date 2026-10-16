import type { Metadata } from "next";
import { Suspense } from "react";
import { LeadsTable } from "@/components/app/LeadsTable";
import { DemoBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  const ctx = await getPageContext();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        description="Search, filter, enrich and manage every prospect in one place."
        badge={ctx.demo ? <DemoBadge /> : undefined}
      />
      {/* The table reads its filters from the URL (useSearchParams), hence the boundary. */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        {ctx.demo ? (
          // Demo mode: the table reads the read-only /api/demo fixture API; writes are blocked.
          <LeadsTable orgId="demo" role="OWNER" apiBase="/api/demo" demo />
        ) : (
          <LeadsTable orgId={ctx.organizationId} role={ctx.role} />
        )}
      </Suspense>
    </div>
  );
}
