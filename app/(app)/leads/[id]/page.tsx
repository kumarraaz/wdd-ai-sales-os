import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDemoSession } from "@/lib/demo-session";
import { LeadDetail } from "@/components/app/LeadDetail";
import { LeadOutreach } from "@/components/app/LeadOutreach";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id || id.length > 64) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  // Demo mode: the detail component reads from the read-only /api/demo fixture.
  if (demo && !session?.user) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            Lead detail{" "}
            <span className="ml-2 rounded bg-[#D4AF37]/15 px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              DEMO_DATA
            </span>
          </h1>
        </div>
        <LeadDetail leadId={id} apiBase="/api/demo" demo />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Lead detail</h1>
        <p className="text-sm text-white/50">
          Source, provenance, intelligence and opportunity score for this lead.
        </p>
      </div>
      <LeadDetail leadId={id} apiBase="/api" />
      <LeadOutreach leadId={id} apiBase="/api" />
    </div>
  );
}
