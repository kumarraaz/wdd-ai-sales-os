/**
 * Outreach draft tool (Phase 2).
 *
 * DRAFT-ONLY. This module creates Message records with status DRAFT and
 * approvalMode APPROVAL_REQUIRED. It contains no sending logic of any
 * kind — no provider calls, no status transitions beyond DRAFT, no
 * scheduled dispatch. Sending belongs to a later phase behind human
 * approval.
 *
 * requiresApproval = true: the future Agent Mind must obtain human
 * approval before anything created here is ever sent. executeTool surfaces
 * the flag on the result.
 */
import { z } from "zod";
import { Channel } from "@prisma/client";
import { db } from "../../db";
import { getLead } from "../../leads";
import type { ToolDefinition } from "./registry";
import { ToolError } from "./registry";

const DRAFT_CHANNELS = ["EMAIL", "WHATSAPP", "LINKEDIN"] as const;

export const outreachCreateDraftSchema = z
  .object({
    /** Optional CRM lead to attach the draft to (must belong to the caller's organization). */
    leadId: z.string().cuid().optional(),
    channel: z.enum(DRAFT_CHANNELS),
    subject: z.string().trim().max(300).optional(),
    body: z.string().trim().min(1).max(20000),
  })
  .strict();

export type OutreachCreateDraftInput = z.infer<typeof outreachCreateDraftSchema>;

export const outreachCreateDraftTool: ToolDefinition<typeof outreachCreateDraftSchema> = {
  name: "outreach.createDraft",
  description:
    "Create an outreach message DRAFT (email/WhatsApp/LinkedIn) for later human approval. Never sends anything; drafts are created with status DRAFT and approval required.",
  inputSchema: outreachCreateDraftSchema,
  requiresApproval: true,
  handler: async (ctx, input) => {
    const organizationId = ctx.organization.id;
    if (input.leadId) {
      const lead = await getLead(organizationId, input.leadId);
      if (!lead) {
        throw new ToolError(
          "LEAD_NOT_FOUND",
          "Lead not found in this organization.",
        );
      }
    }
    const channel: Channel = input.channel;
    // Draft only: status stays DRAFT, approvalMode stays APPROVAL_REQUIRED.
    // There is intentionally no code path here that sends or schedules.
    return db.message.create({
      data: {
        organizationId,
        leadId: input.leadId,
        channel,
        direction: "OUTBOUND",
        status: "DRAFT",
        subject: input.subject,
        body: input.body,
        approvalMode: "APPROVAL_REQUIRED",
        dataLabel: "USER_PROVIDED",
      },
    });
  },
};
