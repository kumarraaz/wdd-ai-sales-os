import type { Metadata } from "next";
import { DiscoveryPipeline } from "@/components/app/DiscoveryPipeline";
import { DiscoveryWorkspace } from "@/components/discovery/DiscoveryWorkspace";
import { DemoBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lead discovery" };

export default async function DiscoverPage() {
  const ctx = await getPageContext();

  // Demo mode: the pipeline runs on fictional DEMO_DATA fixtures — no external
  // APIs are called and import is disabled.
  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Discover"
          description="Find real companies and import them into your lead database."
          badge={<DemoBadge />}
        />
        <DiscoveryPipeline apiBase="/api/demo" demo />
      </div>
    );
  }

  return <DiscoveryWorkspace />;
}
