import type { Metadata } from "next";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { RunHistoryView } from "@/components/discovery/RunHistoryView";
import { DemoBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Discovery history" };

export default async function DiscoverHistoryPage() {
  const ctx = await getPageContext();

  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Discovery history" badge={<DemoBadge />} />
        <DemoUnavailable what="Run history" />
      </div>
    );
  }

  return <RunHistoryView />;
}
