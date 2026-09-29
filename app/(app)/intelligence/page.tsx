import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDemoSession } from "@/lib/demo-session";
import { WebsiteIntelligence } from "@/components/app/WebsiteIntelligence";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  // Demo mode: fictional DEMO_DATA inspection reports — no real external
  // HTTP requests are ever made.
  if (demo && !session?.user) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            Intelligence{" "}
            <span className="ml-2 rounded bg-[#D4AF37]/15 px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              DEMO_DATA
            </span>
          </h1>
          <p className="text-sm text-white/50">
            Technical website inspection — what a prospect&apos;s site reveals.
          </p>
        </div>
        <WebsiteIntelligence apiBase="/api/demo" demo />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Intelligence</h1>
        <p className="text-sm text-white/50">
          Technical website inspection — what a prospect&apos;s site reveals.
        </p>
      </div>
      <WebsiteIntelligence apiBase="/api" />
    </div>
  );
}
