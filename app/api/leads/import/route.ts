import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/tenant";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";
import { importMappingSchema, createLeadSchema } from "@/lib/validators";
import { createLead } from "@/lib/leads";
import { checkLeadQuota } from "@/lib/quotas";
import { audit } from "@/lib/audit";

/**
 * POST /api/leads/import
 * Body: { rows: Record<string,string>[], mapping: { fullName?: csvCol, email?: csvCol, ... } }
 * The client does CSV parsing + column mapping UI; the server validates every
 * row with the same Zod schema as manual creation. Quota is enforced upfront.
 */
export const POST = withWorkspace(
  async (req: NextRequest, ctx) => {
    const rl = await checkRateLimit(`import:${ctx.user.id}`, LIMITS.api);
    if (!rl.success)
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

    const body = await req.json().catch(() => null);
    const parsed = importMappingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_INPUT", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const quota = await checkLeadQuota(ctx.organization.id);
    const room = quota.limit - quota.used;
    if (room <= 0) {
      return NextResponse.json(
        { error: "LEAD_QUOTA_EXCEEDED", used: quota.used, limit: quota.limit },
        { status: 403 },
      );
    }

    const { rows, mapping } = parsed.data;
    const fieldMap = mapping as Record<string, string | undefined>;
    let created = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length && created < room; i++) {
      const raw = rows[i];
      const input: Record<string, string> = {};
      for (const [field, col] of Object.entries(fieldMap)) {
        if (col && raw[col] !== undefined) input[field] = String(raw[col]).trim();
      }
      const validated = createLeadSchema.safeParse({
        ...input,
        sourceType: "CSV",
        sourceDetail: "CSV import",
      });
      if (!validated.success) {
        skipped += 1;
        if (errors.length < 20)
          errors.push({ row: i + 1, message: "Invalid row data" });
        continue;
      }
      try {
        const { duplicate } = await createLead(
          ctx.organization.id,
          ctx.user.id,
          validated.data,
        );
        if (duplicate) duplicates += 1;
        else created += 1;
      } catch {
        skipped += 1;
      }
    }

    await audit({
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      action: "lead.import",
      resource: "lead",
      result: "SUCCESS",
      metadata: { created, skipped, duplicates, total: rows.length },
      req,
    });

    return NextResponse.json({ created, skipped, duplicates, errors, total: rows.length });
  },
  { minRole: "SALES_EXECUTIVE" },
);
