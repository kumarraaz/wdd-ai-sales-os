import type { Metadata } from "next";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { IntegrationsView } from "@/components/discovery/IntegrationsView";
import { DemoBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await getPageContext();

  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Integrations" badge={<DemoBadge />} />
        <DemoUnavailable what="Integrations" />
      </div>
    );
  }

  return <IntegrationsView />;
}
