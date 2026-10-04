import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { getBatch } from "@/lib/outreach/instagram-service";

export const GET = withWorkspace(
  async (_req: NextRequest, ctx, { params }) => {
    const { id } = await params;
    try {
      const batch = await getBatch(ctx.organization.id, id);
      return NextResponse.json({ batch });
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND")
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      throw err;
    }
  },
  { minRole: "VIEWER" },
);
