import type { Metadata } from "next";
import { DemoUnavailable } from "@/components/app/DemoUnavailable";
import { InstagramOutreachAssistant } from "@/components/outreach/InstagramOutreachAssistant";
import { DemoBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Outreach studio" };

export default async function InstagramOutreachPage() {
  const ctx = await getPageContext();

  if (ctx.demo) {
    return (
      <div className="space-y-5">
        <PageHeader title="Instagram outreach" badge={<DemoBadge />} />
        <DemoUnavailable what="Outreach">
          Outreach drafts are prepared for real prospects in a real workspace, and you review and send every message
          yourself. Nothing is sent from demo mode.
        </DemoUnavailable>
      </div>
    );
  }

  // The active workspace comes from the same cookie + membership check as every other page
  // (this page used to always take the user's first workspace).
  return <InstagramOutreachAssistant orgId={ctx.organizationId} />;
}
