"use client";

/**
 * Instagram-oriented CRM cells: source switch options, connection-status
 * dropdown, AI message viewer/editor modal, and the universal remark modal.
 * Used by LeadsTable; all writes go through the tenant-isolated, audited
 * PATCH /api/leads/[id] and /api/leads/[id]/remarks endpoints.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { X, Copy, Check, ExternalLink, StickyNote } from "lucide-react";
import { DEMO_ACTION_DISABLED_MESSAGE } from "@/lib/demo";

export const SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "GOOGLE_BUSINESS", label: "Google Maps" },
  { value: "WEB_SEARCH", label: "Google Search" },
  { value: "CSV", label: "CSV" },
  { value: "MANUAL", label: "Manual" },
  { value: "GEOAPIFY", label: "Geoapify" },
  { value: "OPENSTREETMAP", label: "OpenStreetMap" },
  { value: "DIRECTORY", label: "Directory" },
  { value: "API", label: "API" },
];

/** Column ids visible in the Instagram-oriented preset. */
export const IG_PRESET_VISIBLE = [
  "ig_username",
  "ig_profile",
  "ig_connected",
  "company",
  "industry",
  "location",
  "website",
  "opportunity",
  "score",
  "ai_message",
  "status",
  "remark",
  "source",
];

export const CONNECTION_STATUSES = ["UNKNOWN", "CONNECTED", "NOT_CONNECTED"] as const;

function connectionPillClass(status: string): string {
  switch (status) {
    case "CONNECTED":
      return "bg-emerald-400/15 text-emerald-300";
    case "NOT_CONNECTED":
      return "bg-white/10 text-white/50";
    default:
      return "bg-amber-400/15 text-amber-300";
  }
}

function connectionLabel(status: string): string {
  switch (status) {
    case "CONNECTED":
      return "Connected";
    case "NOT_CONNECTED":
      return "Not connected";
    default:
      return "Unknown";
  }
}

interface LeadLike {
  id: string;
  instagramUsername: string | null;
  instagramConnectionStatus: string | null;
  aiMessage: string | null;
  aiMessageSource: string | null;
  company?: { name: string } | null;
  fullName?: string | null;
}

/** Inline connection-status dropdown — UNKNOWN is never auto-changed. */
export function ConnectionStatusDropdown({
  lead,
  orgId,
  apiBase,
  canWrite,
  demo,
  onBlocked,
  onChanged,
}: {
  lead: LeadLike;
  orgId: string;
  apiBase: string;
  canWrite: boolean;
  demo?: boolean;
  onBlocked: () => void;
  onChanged: (id: string, status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = lead.instagramConnectionStatus ?? "UNKNOWN";

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open ]);

  if (!canWrite) {
    return (
      <span className={`rounded-full px-2.5 py-0.5 text-xs ${connectionPillClass(current)}`}>
        {connectionLabel(current)}
      </span>
    );
  }

  async function pick(next: string) {
    setOpen(false);
    if (next === current) return;
    if (demo) {
      onBlocked();
      return;
    }
    setSaving(true);
    onChanged(lead.id, next); // optimistic
    try {
      const res = await fetch(`${apiBase}/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "x-org-id": orgId, "Content-Type": "application/json" },
        body: JSON.stringify({ instagramConnectionStatus: next }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      onChanged(lead.id, current); // rollback
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={saving}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-full px-2.5 py-0.5 text-xs ${connectionPillClass(current)} hover:opacity-80 disabled:opacity-50`}
        title="Update connection status (manual — never auto-detected)"
      >
        {connectionLabel(current)}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-36 overflow-hidden rounded-lg border border-white/10 bg-[#0D1B2A] shadow-xl">
          {CONNECTION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              className="block w-full px-3 py-2 text-left text-xs text-white/80 hover:bg-white/5"
            >
              {connectionLabel(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "View Message" modal: read, copy, and edit the AI draft. Never sends. */
export function MessageViewerModal({
  lead,
  orgId,
  apiBase,
  canWrite,
  demo,
  onBlocked,
  onClose,
  onSaved,
}: {
  lead: LeadLike;
  orgId: string;
  apiBase: string;
  canWrite: boolean;
  demo?: boolean;
  onBlocked: () => void;
  onClose: () => void;
  onSaved: (id: string, message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lead.aiMessage ?? "");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function copy() {
    if (!lead.aiMessage) return;
    try {
      await navigator.clipboard.writeText(lead.aiMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function save() {
    if (demo) {
      onBlocked();
      return;
    }
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "x-org-id": orgId, "Content-Type": "application/json" },
        body: JSON.stringify({ aiMessage: text }),
      });
      if (!res.ok) throw new Error("save failed");
      onSaved(lead.id, text);
      setEditing(false);
    } catch {
      /* keep editor open on failure */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="AI outreach message"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0D1B2A] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            AI message{" "}
            <span className="text-white/40">
              — @{lead.instagramUsername ?? lead.company?.name ?? lead.fullName ?? "lead"}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {lead.aiMessageSource && (
          <p className="mb-2 text-[11px] uppercase tracking-wide text-white/35">
            {lead.aiMessageSource === "ai" ? "AI-generated" : "Template"} draft — review before sending manually
          </p>
        )}
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            maxLength={2000}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]"
          />
        ) : (
          <p className="whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm leading-relaxed text-white/85">
            {lead.aiMessage || "No message generated for this lead yet."}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {!editing && lead.aiMessage && (
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:text-white"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {canWrite &&
            (editing ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(lead.aiMessage ?? "");
                  }}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !draft.trim()}
                  className="rounded-lg bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              lead.aiMessage && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:text-white"
                >
                  Edit
                </button>
              )
            ))}
        </div>
      </div>
    </div>
  );
}

interface Remark {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

/** Universal remark modal — works for every CRM source. */
export function RemarkModal({
  leadId,
  leadLabel,
  orgId,
  apiBase,
  canWrite,
  demo,
  onBlocked,
  onClose,
}: {
  leadId: string;
  leadLabel: string;
  orgId: string;
  apiBase: string;
  canWrite: boolean;
  demo?: boolean;
  onBlocked: () => void;
  onClose: () => void;
}) {
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/leads/${leadId}/remarks`, {
        headers: { "x-org-id": orgId },
      });
      if (res.ok) {
        const data = await res.json();
        setRemarks(data.remarks ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [leadId, orgId, apiBase]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function add() {
    const text = body.trim();
    if (!text) return;
    if (demo) {
      onBlocked();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/leads/${leadId}/remarks`, {
        method: "POST",
        headers: { "x-org-id": orgId, "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error("save failed");
      setBody("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Remarks"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#0D1B2A] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
            <StickyNote size={16} className="text-[#D4AF37]" />
            Remarks <span className="text-white/40">— {leadLabel}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-white/40">Loading…</p>
          ) : remarks.length === 0 ? (
            <p className="text-sm text-white/40">No remarks yet.</p>
          ) : (
            remarks.map((r) => (
              <div key={r.id} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                <p className="whitespace-pre-wrap text-sm text-white/85">{r.body}</p>
                <p className="mt-1 text-[11px] text-white/35">
                  {r.author} · {new Date(r.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
        {canWrite && (
          <div className="mt-3 flex gap-2">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="Add a remark…"
              maxLength={2000}
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#D4AF37]"
            />
            <button
              type="button"
              onClick={add}
              disabled={saving || !body.trim()}
              className="rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {saving ? "…" : "Add"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileLink({ url, label }: { url: string | null; label?: string }) {
  if (!url)
    return <span className="text-white/30">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-[#D4AF37] hover:underline"
    >
      {label ?? "Open"}
      <ExternalLink size={12} />
    </a>
  );
}
