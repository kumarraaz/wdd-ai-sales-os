"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Pencil,
  UserCheck,
  Loader2,
  Instagram,
  Link2,
  Plus,
  X,
} from "lucide-react";

interface OutreachItem {
  id: string;
  username: string;
  profileUrl: string;
  status: "DRAFT" | "COPIED" | "CONTACTED";
  businessName: string | null;
  category: string | null;
  location: string | null;
  website: string | null;
  observations: string | null;
  researchSources: string[];
  researchConfidence: string | null;
  researchFailed: boolean;
  researchError: string | null;
  researchedAt: string | null;
  pitchAngle: string | null;
  websiteAnalysis: string | null;
  messageDraft: string | null;
  messageSource: string | null;
  messageEdited: string | null;
  dataLabel: string;
  leadId: string | null;
  copiedAt: string | null;
  contactedAt: string | null;
}

interface LeadCandidate {
  id: string;
  displayName: string;
  instagramUrl: string | null;
  status: string;
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-[#D4AF37] placeholder:text-white/30";

function ProvenanceBadge({ label }: { label: string }) {
  const cls =
    label === "AI_INFERENCE"
      ? "bg-purple-400/15 text-purple-300"
      : label === "VERIFIED"
        ? "bg-emerald-400/15 text-emerald-300"
        : label === "USER_PROVIDED"
          ? "bg-sky-400/15 text-sky-300"
          : "bg-[#D4AF37]/15 text-[#D4AF37]";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence) return null;
  const cls =
    confidence === "HIGH"
      ? "bg-emerald-400/15 text-emerald-300"
      : confidence === "MEDIUM"
        ? "bg-amber-400/15 text-amber-300"
        : confidence === "LOW"
          ? "bg-white/10 text-white/50"
          : "bg-red-400/15 text-red-300";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {confidence === "INSUFFICIENT" ? "Insufficient info" : `${confidence} confidence`}
    </span>
  );
}

const PITCH_ANGLE_LABELS: Record<string, string> = {
  NEW_WEBSITE: "New website",
  REDESIGN: "Redesign",
  UX_CONVERSION: "UX & enquiry flow",
  SEO: "SEO",
  LOCAL_SEO: "Local SEO",
  PERFORMANCE: "Performance",
  CONTENT: "Content",
  GENERAL: "General opener",
};

function PitchAngleBadge({ angle }: { angle: string | null }) {
  if (!angle) return null;
  return (
    <span className="rounded bg-[#D4AF37]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#D4AF37]" title="Recommended pitch angle from research">
      Pitch: {PITCH_ANGLE_LABELS[angle] ?? angle}
    </span>
  );
}

function StatusBadge({ status }: { status: OutreachItem["status"] }) {
  const cls =
    status === "CONTACTED"
      ? "bg-emerald-400/15 text-emerald-300"
      : status === "COPIED"
        ? "bg-sky-400/15 text-sky-300"
        : "bg-white/10 text-white/60";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {status}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-0.5 text-sm text-white/85">{children}</div>
    </div>
  );
}

function OutreachCard({
  item,
  orgId,
  onUpdate,
}: {
  item: OutreachItem;
  orgId: string;
  onUpdate: (item: OutreachItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [candidates, setCandidates] = useState<LeadCandidate[] | null>(null);

  const message = item.messageEdited ?? item.messageDraft ?? "";
  const headers = { "x-org-id": orgId, "Content-Type": "application/json" };

  async function call(action: string, body?: object) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/outreach/instagram/items/${item.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ action, ...body }),
      });
      if (!res.ok) throw new Error(`Failed: ${action}`);
      const data = await res.json();
      if (data.item) onUpdate(data.item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      await call("copied");
    } catch {
      setError("Could not access the clipboard — select the text manually.");
    }
  }

  function openInstagram() {
    window.open(item.profileUrl, "_blank", "noopener,noreferrer");
    // Fire-and-forget audit event; the user sends manually afterwards.
    fetch(`/api/outreach/instagram/items/${item.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ action: "profile_opened" }),
    }).catch(() => {});
  }

  async function regenerate() {
    setBusy("regenerate");
    setError(null);
    try {
      const res = await fetch(`/api/outreach/instagram/items/${item.id}/regenerate`, {
        method: "POST",
        headers: { "x-org-id": orgId },
      });
      if (!res.ok) throw new Error("Regeneration failed.");
      const data = await res.json();
      onUpdate(data.item);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regeneration failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    if (!draft.trim()) {
      setError("Message cannot be empty.");
      return;
    }
    await call("edit", { message: draft.trim() });
    setEditing(false);
  }

  async function loadCandidates() {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/outreach/instagram/items/${item.id}/link-lead`, {
        headers: { "x-org-id": orgId },
      });
      if (!res.ok) throw new Error("Could not load lead candidates.");
      const data = await res.json();
      setCandidates(data.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load lead candidates.");
    } finally {
      setLinking(false);
    }
  }

  async function linkLead(leadId?: string, create?: boolean) {
    setBusy("link");
    setError(null);
    try {
      const res = await fetch(`/api/outreach/instagram/items/${item.id}/link-lead`, {
        method: "POST",
        headers,
        body: JSON.stringify({ leadId, create }),
      });
      if (!res.ok) throw new Error("Linking failed.");
      const data = await res.json();
      onUpdate(data.item);
      setCandidates(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Linking failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#D4AF37]/30 to-[#D4AF37]/5">
            <Instagram size={18} className="text-[#D4AF37]" />
          </div>
          <div>
            <div className="font-semibold text-white">@{item.username}</div>
            <a
              href={item.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white/40 hover:text-[#D4AF37]"
            >
              {item.profileUrl}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          <ProvenanceBadge label={item.dataLabel} />
          <ConfidenceBadge confidence={item.researchConfidence} />
          <PitchAngleBadge angle={item.pitchAngle} />
        </div>
      </div>

      {item.researchFailed ? (
        <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          Research failed{item.researchError ? `: ${item.researchError}` : "."} You can still
          write a message manually below.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Business name">{item.businessName ?? "—"}</Field>
          <Field label="Category">{item.category ?? "—"}</Field>
          <Field label="Location">{item.location ?? "—"}</Field>
          <Field label="Website">
            {item.website ? (
              <a href={item.website} target="_blank" rel="noopener noreferrer" className="text-[#D4AF37] hover:underline break-all">
                {item.website}
              </a>
            ) : (
              "—"
            )}
          </Field>
        </div>
      )}

      {item.observations && (
        <p className="mt-3 text-sm text-white/60">{item.observations}</p>
      )}

      {item.websiteAnalysis && (
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          <span className="font-semibold text-white/60">Website check: </span>
          {item.websiteAnalysis}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
        <span>Sources: {item.researchSources.length > 0 ? item.researchSources.join(" · ") : "—"}</span>
        {item.researchedAt && <span>· Researched {new Date(item.researchedAt).toLocaleString()}</span>}
        {item.messageSource && <span>· Message: {item.messageSource === "ai" ? "AI-generated" : "template"}</span>}
      </div>

      {/* Message */}
      <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-white/40">
            Outreach message — review before sending
          </span>
          {!editing && (
            <button
              onClick={() => {
                setDraft(message);
                setEditing(true);
              }}
              className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-[#D4AF37]"
            >
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              maxLength={2000}
              className={inputCls}
            />
            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                disabled={busy === "edit"}
                className="rounded-lg bg-[#D4AF37] px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-50"
              >
                {busy === "edit" ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-white/85">
            {message || <span className="text-white/30">No message yet.</span>}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={copyMessage}
          disabled={!message}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied!" : "Copy Message"}
        </button>
        <button
          onClick={openInstagram}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
        >
          <ExternalLink size={15} /> Open Instagram
        </button>
        <button
          onClick={regenerate}
          disabled={busy === "regenerate"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
        >
          {busy === "regenerate" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Regenerate
        </button>
        {item.status !== "CONTACTED" && (
          <button
            onClick={() => call("contacted")}
            disabled={busy === "contacted"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50"
          >
            {busy === "contacted" ? <Loader2 size={15} className="animate-spin" /> : <UserCheck size={15} />}
            Mark Contacted
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-white/35">
        You send the message yourself: open the profile, tap Message, paste, send.
        Nothing here sends automatically.
      </p>

      {/* CRM link */}
      <div className="mt-3 border-t border-white/5 pt-3">
        {item.leadId ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
            <Link2 size={12} /> Linked to CRM lead
          </span>
        ) : (
          <div>
            <button
              onClick={loadCandidates}
              disabled={linking}
              className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-[#D4AF37] disabled:opacity-50"
            >
              {linking ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              Link to CRM lead
            </button>
            {candidates !== null && (
              <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-3">
                {candidates.length === 0 ? (
                  <p className="text-xs text-white/50">No matching lead found.</p>
                ) : (
                  <ul className="space-y-1">
                    {candidates.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-white/75">
                          {c.displayName} <span className="text-white/35">({c.status})</span>
                        </span>
                        <button
                          onClick={() => linkLead(c.id)}
                          disabled={busy === "link"}
                          className="rounded border border-white/15 px-2 py-0.5 text-white/70 hover:bg-white/5 disabled:opacity-50"
                        >
                          Link
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => linkLead(undefined, true)}
                    disabled={busy === "link"}
                    className="inline-flex items-center gap-1 rounded border border-[#D4AF37]/40 px-2 py-1 text-xs text-[#D4AF37] hover:bg-[#D4AF37]/10 disabled:opacity-50"
                  >
                    <Plus size={12} /> Create lead from this profile
                  </button>
                  <button
                    onClick={() => setCandidates(null)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-white/40 hover:text-white"
                  >
                    <X size={12} /> Close
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function InstagramOutreachAssistant({ orgId }: { orgId: string }) {
  const [text, setText] = useState("");
  const [batchName, setBatchName] = useState("");
  const [researching, setResearching] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [items, setItems] = useState<OutreachItem[]>([]);
  const [invalid, setInvalid] = useState<{ raw: string; error: string }[]>([]);
  const [duplicatesRemoved, setDuplicatesRemoved] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<{ id: string; name: string | null; createdAt: string; _count: { items: number } }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/outreach/instagram/batches", {
        headers: { "x-org-id": orgId },
      });
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches);
      }
    } catch {
      /* ignore */
    }
  }, [orgId]);

  useEffect(() => {
    // Deferred so the effect body itself performs no synchronous setState.
    const t = setTimeout(() => {
      loadBatches();
    }, 0);
    return () => clearTimeout(t);
  }, [loadBatches]);

  async function loadBatch(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/outreach/instagram/batches/${id}`, {
        headers: { "x-org-id": orgId },
      });
      if (!res.ok) throw new Error("Could not load batch.");
      const data = await res.json();
      setItems(data.batch.items);
      setInvalid([]);
      setDuplicatesRemoved(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load batch.");
    }
  }

  async function research() {
    if (!text.trim() || researching) return;
    setResearching(true);
    setError(null);
    setItems([]);
    setInvalid([]);
    setDuplicatesRemoved(0);
    setProgress({ current: 0, total: 0, label: "Starting…" });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/outreach/instagram/research", {
        method: "POST",
        headers: { "x-org-id": orgId, "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: text, name: batchName.trim() || undefined }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error === "RATE_LIMITED" ? "Rate limited — try again shortly." : "Research failed to start.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const data = JSON.parse(line.slice(5).trim());
          if (data.event === "item-start") {
            setProgress({ current: data.index ?? 0, total: data.total ?? 0, label: `Researching @${data.username}` });
          } else if (data.event === "item-done") {
            setProgress((p) => ({ ...p, current: data.index ?? p.current }));
          } else if (data.event === "complete") {
            setInvalid(data.invalid ?? []);
            setDuplicatesRemoved(data.duplicatesRemoved ?? 0);
            await loadBatch(data.batchId);
            loadBatches();
          } else if (data.event === "error") {
            throw new Error(data.message || "Research failed.");
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Research failed.");
      }
    } finally {
      setResearching(false);
      setProgress({ current: 0, total: 0, label: "" });
      abortRef.current = null;
    }
  }

  const updateItem = useCallback((updated: OutreachItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Instagram Outreach Assistant</h1>
        <p className="mt-1 text-sm text-white/50">
          Research prospects and prepare personalized Instagram messages. You review and send every
          message manually — nothing is automated.
        </p>
      </div>

      {/* Input */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
        <label htmlFor="ig-usernames" className="mb-2 block text-sm font-medium text-white/70">
          Paste Instagram usernames, one per line
        </label>
        <textarea
          id="ig-usernames"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"@abcmanufacturing\n@xyzexports\n@sampletraders"}
          className={inputCls}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            placeholder="Batch name (optional)"
            aria-label="Batch name"
            className="w-56 rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white outline-none focus:border-[#D4AF37] placeholder:text-white/30"
          />
          <button
            onClick={research}
            disabled={researching || !text.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
          >
            {researching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {researching ? "Researching…" : "Research Profiles"}
          </button>
          {researching && (
            <button
              onClick={() => abortRef.current?.abort()}
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5"
            >
              Stop
            </button>
          )}
          <span className="text-xs text-white/35">Up to 50 usernames per batch.</span>
        </div>
        {researching && progress.total > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-white/50">
              <span>{progress.label}</span>
              <span>
                Researching {progress.current} / {progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[#D4AF37] transition-all"
                style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Batch report */}
      {(invalid.length > 0 || duplicatesRemoved > 0) && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
          {duplicatesRemoved > 0 && (
            <p className="text-white/60">Removed {duplicatesRemoved} duplicate username(s).</p>
          )}
          {invalid.length > 0 && (
            <div className="mt-1">
              <p className="text-white/60">Skipped {invalid.length} invalid line(s):</p>
              <ul className="mt-1 space-y-0.5">
                {invalid.map((v, i) => (
                  <li key={i} className="text-xs text-red-300/80">
                    <span className="font-mono">{v.raw}</span> — {v.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {items.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            Results <span className="text-sm font-normal text-white/40">({items.length})</span>
          </h2>
          {items.map((item) => (
            <OutreachCard key={item.id} item={item} orgId={orgId} onUpdate={updateItem} />
          ))}
        </div>
      )}

      {/* Past batches */}
      {batches.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">
            Past batches
          </h2>
          <ul className="space-y-1">
            {batches.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => loadBatch(b.id)}
                  className="text-sm text-white/70 hover:text-[#D4AF37]"
                >
                  {b.name ?? "Untitled batch"} <span className="text-white/35">· {b._count.items} profiles · {new Date(b.createdAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
