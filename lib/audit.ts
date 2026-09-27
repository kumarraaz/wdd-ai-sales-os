import { NextRequest } from "next/server";
import { db } from "./db";

interface AuditInput {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  resource?: string;
  resourceId?: string;
  result?: "SUCCESS" | "DENIED" | "FAILED";
  metadata?: Record<string, unknown>;
  req?: NextRequest;
}

function clientIp(req?: NextRequest): string | undefined {
  if (!req) return undefined;
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() ?? undefined;
}

/** Append-only audit record. Fire-and-forget safe — never throws. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        result: input.result ?? "SUCCESS",
        ip: clientIp(input.req),
        userAgent: input.req?.headers.get("user-agent") ?? undefined,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log", err);
  }
}
