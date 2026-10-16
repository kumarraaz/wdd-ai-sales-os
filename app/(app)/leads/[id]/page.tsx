import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/app/LeadDetail";
import { LeadOutreach } from "@/components/app/LeadOutreach";
import { DemoBadge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lead detail" };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id.length > 64) notFound();

  const ctx = await getPageContext();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Lead detail"
        description="Source, provenance, intelligence and opportunity score for this lead."
        badge={ctx.demo ? <DemoBadge /> : undefined}
        actions={
          <ButtonLink href="/leads" variant="secondary" size="sm">
            ← All leads
          </ButtonLink>
        }
      />
      {ctx.demo ? (
        // Demo mode: the detail component reads from the read-only /api/demo fixture.
        <LeadDetail leadId={id} apiBase="/api/demo" demo />
      ) : (
        <>
          <LeadDetail leadId={id} apiBase="/api" />
          <LeadOutreach leadId={id} apiBase="/api" />
        </>
      )}
    </div>
  );
}
