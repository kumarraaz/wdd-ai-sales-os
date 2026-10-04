import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { listHistory } from "@/lib/discovery/history";

/** GET /api/discovery/history — paginated discovery run history. */
export const GET = withWorkspace(async (req: NextRequest, ctx) => {
  const rl = await checkRateLimit(`api:${ctx.user.id}`, LIMITS.api);
  if (!rl.success) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const take = Math.min(
    Math.max(Number(new URL(req.url).searchParams.get("take") ?? 25), 1),
    100,
  );
  const rows = await listHistory(ctx.organization.id, take);
  return NextResponse.json({
    runs: rows.map((r) => ({
      id: r.id,
      label: r.label,
      profile: r.profile,
      providerIds: r.providerIds,
      params: r.params,
      requested: r.requested,
      discovered: r.discovered,
      deduplicated: r.deduplicated,
      withWebsite: r.withWebsite,
      withoutWebsite: r.withoutWebsite,
      contactable: r.contactable,
      unreachable: r.unreachable,
      imported: r.imported,
      duplicate: r.duplicate,
      perSource: r.perSource,
      durationMs: r.durationMs,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt,
    })),
  });
});
