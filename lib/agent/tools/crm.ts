/**
 * CRM tools (Phase 2).
 *
 * Safe, org-scoped wrappers over existing CRM operations. Lead creation
 * reuses createLead() from lib/leads.ts with its existing validation and
 * duplicate handling; tasks, follow-ups and activity entries are written
 * directly with the organizationId taken from the server-side workspace
 * context — tool input can never override tenant scope.
 *
 * No destructive operations (no delete, no status transitions on other
 * orgs' data) are exposed in this phase.
 */
import { z } from "zod";
import { Channel, TaskPriority } from "@prisma/client";
import { db } from "../../db";
import { createLead, getLead, isOrgMember } from "../../leads";
import { createLeadSchema } from "../../validators";
import type { ToolDefinition } from "./registry";
import { ToolError } from "./registry";

/** Resolve a lead id to an org-owned lead or throw a typed not-found error. */
async function requireOrgLead(organizationId: string, leadId: string) {
  const lead = await getLead(organizationId, leadId);
  if (!lead) {
    throw new ToolError("LEAD_NOT_FOUND", "Lead not found in this organization.");
  }
  return lead;
}

export const createLeadTool: ToolDefinition<typeof createLeadSchema> = {
  name: "crm.createLead",
  description:
    "Create a CRM lead using the existing lead service (validation, duplicate detection, provenance). Organization and actor come from the server context.",
  inputSchema: createLeadSchema,
  requiresApproval: false,
  handler: async (ctx, input) => {
    const result = await createLead(ctx.organization.id, ctx.user.id, input, {
      dataLabel: "USER_PROVIDED",
    });
    return result;
  },
};

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    detail: z.string().trim().max(5000).optional(),
    priority: z.nativeEnum(TaskPriority).default("MEDIUM"),
    dueAt: z.string().datetime().optional(),
    leadId: z.string().cuid().optional(),
    assignedToId: z.string().cuid().optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const createTaskTool: ToolDefinition<typeof createTaskSchema> = {
  name: "crm.createTask",
  description:
    "Create a task in the caller's organization. Linked leads and assignees are verified against the same organization.",
  inputSchema: createTaskSchema,
  requiresApproval: false,
  handler: async (ctx, input) => {
    const organizationId = ctx.organization.id;
    if (input.leadId) {
      await requireOrgLead(organizationId, input.leadId);
    }
    if (input.assignedToId) {
      const member = await isOrgMember(organizationId, input.assignedToId);
      if (!member) {
        throw new ToolError(
          "INVALID_ASSIGNEE",
          "Assignee is not a member of this organization.",
        );
      }
    }
    return db.task.create({
      data: {
        organizationId,
        title: input.title,
        detail: input.detail,
        priority: input.priority,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        leadId: input.leadId,
        assignedToId: input.assignedToId,
        createdById: ctx.user.id,
      },
    });
  },
};

export const createFollowUpSchema = z
  .object({
    leadId: z.string().cuid(),
    channel: z.nativeEnum(Channel),
    scheduledAt: z
      .string()
      .datetime()
      .refine((v) => new Date(v).getTime() > Date.now(), {
        message: "scheduledAt must be in the future.",
      }),
    body: z.string().trim().max(5000).optional(),
  })
  .strict();

export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

export const createFollowUpTool: ToolDefinition<typeof createFollowUpSchema> = {
  name: "crm.createFollowUp",
  description:
    "Schedule a follow-up for an org-owned lead. Creates a SCHEDULED follow-up record; it does not send anything.",
  inputSchema: createFollowUpSchema,
  requiresApproval: false,
  handler: async (ctx, input) => {
    const organizationId = ctx.organization.id;
    await requireOrgLead(organizationId, input.leadId);
    return db.followUp.create({
      data: {
        organizationId,
        leadId: input.leadId,
        channel: input.channel,
        scheduledAt: new Date(input.scheduledAt),
        body: input.body,
      },
    });
  },
};

const ACTIVITY_TYPES = [
  "note",
  "discovered",
  "researched",
  "scored",
  "task-created",
  "followup-scheduled",
  "draft-created",
] as const;

export const logActivitySchema = z
  .object({
    leadId: z.string().cuid(),
    type: z.enum(ACTIVITY_TYPES),
    title: z.string().trim().min(1).max(300),
    detail: z.string().trim().max(5000).optional(),
  })
  .strict();

export type LogActivityInput = z.infer<typeof logActivitySchema>;

export const logActivityTool: ToolDefinition<typeof logActivitySchema> = {
  name: "crm.logActivity",
  description:
    "Append an activity entry to an org-owned lead's timeline (notes, research events, scoring events).",
  inputSchema: logActivitySchema,
  requiresApproval: false,
  handler: async (ctx, input) => {
    const organizationId = ctx.organization.id;
    await requireOrgLead(organizationId, input.leadId);
    return db.leadActivity.create({
      data: {
        organizationId,
        leadId: input.leadId,
        type: input.type,
        title: input.title,
        detail: input.detail,
        actorId: ctx.user.id,
      },
    });
  },
};
