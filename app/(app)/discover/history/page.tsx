import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDemoSession } from "@/lib/demo-session";
import { RunHistoryView } from "@/components/discovery/RunHistoryView";

export const dynamic = "force-dynamic";

export default async function DiscoverHistoryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  if (demo && !session?.user) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">
          Discovery History{" "}
          <span className="ml-2 rounded bg-[#D4AF37]/15 px-2 py-0.5 align-middle text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
            DEMO_DATA
          </span>
        </h1>
        <p className="text-sm text-white/50">History is disabled in demo mode.</p>
      </div>
    );
  }

  return <RunHistoryView />;
}
