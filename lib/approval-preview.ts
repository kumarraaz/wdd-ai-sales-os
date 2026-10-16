/**
 * What a reviewer sees for one approval: the recipient and the exact content that
 * will be created if they approve. Built only from the stored, immutable snapshot
 * (`proposedInput` / `target`) — and only from known, bounded string fields, so
 * unexpected data is never dumped on screen. Output is plain text for React to escape.
 */

export type ApprovalKind = "OUTREACH_DRAFT" | "CRM_FOLLOWUP" | "CRM_TASK";

export interface PreviewField {
  label: string;
  value: string;
  /** multi-line body text: shown in a scrollable, whitespace-preserving block */
  long?: boolean;
}

export interface ApprovalPreview {
  heading: string;
  /** the same thing as a lowercase noun phrase for sentences ("Approve this outreach draft?") */
  noun: string;
  /** who/what the action is about (target.label) */
  recipient: string | null;
  channel: string | null;
  /** only set when it is a plain id, so the link can never point anywhere unexpected */
  leadHref: string | null;
  fields: PreviewField[];
  /** plain-words consequence of approving — never claims anything is sent */
  effect: string;
  /** the snapshot held fields that are not displayed here */
  hasHiddenFields: boolean;
}

const HEADING: Record<ApprovalKind, string> = {
  OUTREACH_DRAFT: "Outreach draft",
  CRM_FOLLOWUP: "CRM follow-up",
  CRM_TASK: "CRM task",
};

const NOUN: Record<ApprovalKind, string> = {
  OUTREACH_DRAFT: "outreach draft",
  CRM_FOLLOWUP: "CRM follow-up",
  CRM_TASK: "CRM task",
};

const EFFECT: Record<ApprovalKind, string> = {
  OUTREACH_DRAFT: "Approving creates this draft in your workspace. It is not sent to anyone.",
  CRM_FOLLOWUP: "Approving schedules this follow-up record in the CRM. Nothing is sent.",
  CRM_TASK: "Approving adds this task to your workspace.",
};

/** Fields shown per kind, in order. Anything else in the snapshot is counted but not displayed. */
const FIELDS: Record<ApprovalKind, ReadonlyArray<{ key: string; label: string; long?: boolean; date?: boolean; max?: number }>> = {
  OUTREACH_DRAFT: [
    { key: "channel", label: "Channel", max: 40 },
    { key: "subject", label: "Subject", max: 300 },
    { key: "body", label: "Message", long: true, max: 4000 },
  ],
  CRM_FOLLOWUP: [
    { key: "channel", label: "Channel", max: 40 },
    { key: "scheduledAt", label: "Scheduled for", date: true },
    { key: "body", label: "Note", long: true, max: 4000 },
  ],
  CRM_TASK: [
    { key: "title", label: "Title", max: 300 },
    { key: "priority", label: "Priority", max: 40 },
    { key: "dueAt", label: "Due", date: true },
    { key: "detail", label: "Details", long: true, max: 4000 },
  ],
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function formatUtc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function previewApproval(actionType: string, proposedInput: unknown, target: unknown): ApprovalPreview {
  const kind = (actionType in HEADING ? actionType : "OUTREACH_DRAFT") as ApprovalKind;
  const input = asRecord(proposedInput);
  const tgt = asRecord(target);

  const shown = new Set<string>(["leadId"]);
  const fields: PreviewField[] = [];
  for (const spec of FIELDS[kind]) {
    shown.add(spec.key);
    const value = spec.date ? formatUtc(input[spec.key]) : text(input[spec.key], spec.max ?? 300);
    if (value) fields.push({ label: spec.label, value, long: spec.long });
  }

  const leadId = typeof (tgt.leadId ?? input.leadId) === "string" ? String(tgt.leadId ?? input.leadId) : "";
  const channel = text(input.channel, 40) ?? text(tgt.channel, 40);

  return {
    heading: HEADING[kind],
    noun: NOUN[kind],
    recipient: text(tgt.label, 200),
    channel,
    leadHref: /^[a-z0-9]{8,40}$/i.test(leadId) ? `/leads/${leadId}` : null,
    fields,
    effect: EFFECT[kind],
    hasHiddenFields: Object.keys(input).some((k) => !shown.has(k) && input[k] !== undefined),
  };
}
