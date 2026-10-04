import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { listBatches, getBatch } from "@/lib/outreach/instagram-service";

export const GET = withWorkspace(
  async (_req: NextRequest, ctx) => {
    const batches = await listBatches(ctx.organization.id);
    return NextResponse.json({ batches });
  },
  { minRole: "VIEWER" },
);
