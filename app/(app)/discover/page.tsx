import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDemoSession } from "@/lib/demo-session";
import { DiscoveryPipeline } from "@/components/app/DiscoveryPipeline";
import { DiscoveryWorkspace } from "@/components/discovery/DiscoveryWorkspace";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  // Demo mode: pipeline runs on fictional DEMO_DATA fixtures — no external
  // APIs are called and import is disabled.
  if (demo && !session?.user) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            Discover{" "}
            <span className="ml-2 rounded bg-[#D4AF37]/15 px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              DEMO_DATA
            </span>
          </h1>
          <p className="text-sm text-white/50">
            Find real companies and import them into your lead database.
          </p>
        </div>
        <DiscoveryPipeline apiBase="/api/demo" demo />
      </div>
    );
  }

  return <DiscoveryWorkspace />;
}
