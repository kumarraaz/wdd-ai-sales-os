import type { Metadata } from "next";
import { WebsiteIntelligence } from "@/components/app/WebsiteIntelligence";
import { DemoBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lead intelligence" };

export default async function IntelligencePage() {
  const ctx = await getPageContext();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Intelligence"
        description="Technical website inspection — what a prospect's site reveals."
        badge={ctx.demo ? <DemoBadge /> : undefined}
      />
      {ctx.demo ? (
        // Demo mode: fictional DEMO_DATA inspection reports — no real external HTTP requests are made.
        <WebsiteIntelligence apiBase="/api/demo" demo />
      ) : (
        <WebsiteIntelligence apiBase="/api" />
      )}
    </div>
  );
}
