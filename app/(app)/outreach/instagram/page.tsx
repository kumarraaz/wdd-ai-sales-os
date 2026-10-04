import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDemoSession } from "@/lib/demo-session";
import { InstagramOutreachAssistant } from "@/components/outreach/InstagramOutreachAssistant";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InstagramOutreachPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const demo = await getDemoSession();
  if (!session?.user && !demo) redirect("/login");

  // Resolve the workspace org id the same way API routes do (x-org-id header
  // is a client concern; here we take the user's first workspace).
  let orgId = "";
  if (session?.user) {
    const membership = await db.membership.findFirst({
      where: { userId: session.user.id },
      select: { organizationId: true },
      orderBy: { createdAt: "asc" },
    });
    orgId = membership?.organizationId ?? "";
  }

  return <InstagramOutreachAssistant orgId={orgId} />;
}
