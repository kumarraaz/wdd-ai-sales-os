import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { instagramResearchSchema } from "@/lib/validators";
import { createAndProcessBatch, type BatchProgressEvent } from "@/lib/outreach/instagram-service";
import { audit } from "@/lib/audit";

/**
 * POST /api/outreach/instagram/research — research a pasted batch of
 * Instagram usernames and draft personalized messages (SSE progress).
 *
 * Human-in-the-loop: drafts only. Nothing is sent to Instagram.
 * Per-item failure isolation: one bad profile never fails the batch.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`outreach:${ctx.user.id}`, LIMITS.ai);
    if (!rl.success)
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

    const body = await req.json().catch(() => null);
    const parsed = instagramResearchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };
        try {
          const result = await createAndProcessBatch(
            ctx.organization.id,
            ctx.user.id,
            parsed.data.usernames,
            {
              name: parsed.data.name,
              onEvent: (e: BatchProgressEvent) => send({ event: e.type, ...e }),
            },
          );
          send({ event: "complete", ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Research failed.";
          await audit({
            organizationId: ctx.organization.id,
            actorId: ctx.user.id,
            action: "outreach.instagram.batch_failed",
            result: "FAILED",
            metadata: { error: message },
            req,
          });
          send({ event: "error", message });
        } finally {
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },
  { minRole: "SALES_EXECUTIVE" },
);
