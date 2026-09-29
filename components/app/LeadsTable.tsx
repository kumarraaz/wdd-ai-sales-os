"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import Papa from "papaparse";
import Link from "next/link";
import { Plus, Upload, Download, Trash2, X, Globe } from "lucide-react";
import { DEMO_ACTION_DISABLED_MESSAGE } from "@/lib/demo";

interface Lead {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  leadScore: number;
  status: string;
  sourceType: string;
  updatedAt: string;
  company: { name: string } | null;
}

const STATUSES = [
  "NEW", "RESEARCHING", "QUALIFIED", "CONTACTED", "REPLIED",
  "MEETING", "PROPOSAL", "NEGOTIATION", "WON", "LOST", "NURTURE",
];

const LEAD_FIELDS = [
  "fullName", "email", "phone", "jobTitle", "companyName",
  "industry", "location", "city", "country", "website",
] as const;

const columnHelper = createColumnHelper<Lead>();

function scoreColor(s: number) {
  if (s >= 70) return "text-emerald-400";
  if (s >= 40) return "text-amber-400";
  return "text-white/50";
}

export function LeadsTable({
  orgId,
  role,
  apiBase = "/api",
  demo = false,
}: {
  orgId: string;
  role: string;
  /** Demo mode passes "/api/demo" so reads hit the fixture API. */
  apiBase?: string;
  /** Demo mode: writes are blocked with "Demo Mode — Action Disabled". */
  demo?: boolean;
}) {
  const canWrite = role !== "VIEWER";
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  /** Demo mode: block a write action with a clear message. */
  function blockDemo() {
    setDemoNotice(`${DEMO_ACTION_DISABLED_MESSAGE} — this action is not available in demo mode.`);
  }

  const headers = useMemo(() => ({ "x-org-id": orgId }), [orgId]);
  const pageSize = 25;

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(q ? { q } : {}),
        ...(status ? { status } : {}),
        sort: "updatedAt",
        order: "desc",
      });
      const res = await fetch(`${apiBase}/leads?${params}`, { headers });
      if (!res.ok) throw new Error(res.status === 403 ? "Access denied." : "Failed to load leads.");
      const data = await res.json();
      setLeads(data.leads);
      setTotal(data.total);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leads.");
    } finally {
      setLoading(false);
    }
  }, [page, q, status, headers, apiBase]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Debounced search
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQ(draft);
    }, 400);
    return () => clearTimeout(t);
  }, [draft]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)),
    );
  };

  async function bulkStatus(newStatus: string) {
    if (selected.size === 0 || !newStatus) return;
    setBulkBusy(true);
    try {
      const res = await fetch(`${apiBase}/leads/bulk`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], status: newStatus }),
      });
      if (!res.ok) throw new Error("Bulk update failed.");
      await fetchLeads();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk update failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} lead(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      for (const id of selected) {
        await fetch(`${apiBase}/leads/${id}`, { method: "DELETE", headers });
      }
      await fetchLeads();
    } finally {
      setBulkBusy(false);
    }
  }

  function exportCsv() {
    window.open(`${apiBase}/leads/export?format=csv`, "_blank");
  }

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all"
            checked={leads.length > 0 && selected.size === leads.length}
            onChange={toggleAll}
            className="h-4 w-4 accent-[#D4AF37]"
          />
        ),
        cell: (info) => (
          <input
            type="checkbox"
            aria-label={`Select lead ${info.row.original.fullName ?? info.row.original.id}`}
            checked={selected.has(info.row.original.id)}
            onChange={() => toggle(info.row.original.id)}
            className="h-4 w-4 accent-[#D4AF37]"
          />
        ),
      }),
      columnHelper.accessor("fullName", {
        header: "Name",
        cell: (info) => (
          <Link
            href={`/leads/${info.row.original.id}`}
            className="font-medium text-white hover:text-[#D4AF37] hover:underline"
          >
            {info.getValue() || "—"}
          </Link>
        ),
      }),
      columnHelper.accessor((r) => r.company?.name ?? "", {
        id: "company",
        header: "Company",
        cell: (info) => <span className="text-white/70">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("email", {
        header: "Email",
        cell: (info) => <span className="text-white/70">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("leadScore", {
        header: "Score",
        cell: (info) => (
          <span className={`font-semibold ${scoreColor(info.getValue())}`}>
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => (
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/80">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor("sourceType", {
        header: "Source",
        cell: (info) => <span className="text-xs text-white/50">{info.getValue()}</span>,
      }),
      columnHelper.display({
        id: "inspect",
        header: "Site",
        cell: (info) => {
          const lead = info.row.original;
          if (!lead.website) return <span className="text-white/30">—</span>;
          return (
            <Link
              href={`/intelligence?leadId=${lead.id}`}
              title={`Inspect website: ${lead.website}`}
              aria-label={`Inspect website for ${lead.fullName ?? lead.id}`}
              className="inline-flex items-center text-white/50 transition hover:text-[#D4AF37]"
            >
              <Globe size={16} />
            </Link>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leads, selected],
  );

  const table = useReactTable({
    data: leads,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {demoNotice && (
        <div className="flex items-center justify-between rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-2 text-sm text-[#D4AF37]">
          <span>{demoNotice}</span>
          <button
            onClick={() => setDemoNotice(null)}
            aria-label="Dismiss"
            className="ml-3 text-[#D4AF37]/70 hover:text-[#D4AF37]"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search name, email, company…"
          aria-label="Search leads"
          className="w-64 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite && (
            <>
              <button
                onClick={() => (demo ? blockDemo() : setShowAdd(true))}
                className="flex items-center gap-1.5 rounded-lg bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-black hover:brightness-110"
              >
                <Plus size={16} /> Add lead
              </button>
              <button
                onClick={() => (demo ? blockDemo() : setShowImport(true))}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
              >
                <Upload size={16} /> Import
              </button>
            </>
          )}
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
          >
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-2 text-sm">
          <span className="text-[#D4AF37]">{selected.size} selected</span>
          <select
            aria-label="Bulk status update"
            defaultValue=""
            disabled={bulkBusy}
            onChange={(e) => {
              if (demo) {
                e.target.value = "";
                blockDemo();
              } else {
                bulkStatus(e.target.value);
              }
            }}
            className="rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white"
          >
            <option value="">Set status…</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {role !== "VIEWER" && (role === "SALES_MANAGER" || role === "ADMIN" || role === "OWNER") && (
            <button
              onClick={() => (demo ? blockDemo() : deleteSelected())}
              disabled={bulkBusy}
              className="flex items-center gap-1 rounded px-2 py-1 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-white/50 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-white/10 bg-white/5">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-3 font-medium text-white/60">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-white/40">
                  Loading leads…
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-white/40">
                  No leads found. Add your first lead to get started.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-white/5 transition hover:bg-white/5">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-white/60">
        <span>
          {total} lead{total === 1 ? "" : "s"} · Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-white/15 px-3 py-1.5 disabled:opacity-40 hover:bg-white/5"
          >
            Previous
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-white/15 px-3 py-1.5 disabled:opacity-40 hover:bg-white/5"
          >
            Next
          </button>
        </div>
      </div>

      {showAdd && (
        <AddLeadDialog orgId={orgId} onClose={() => setShowAdd(false)} onCreated={fetchLeads} />
      )}
      {showImport && (
        <ImportDialog orgId={orgId} onClose={() => setShowImport(false)} onDone={fetchLeads} />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-white/60">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]";

function AddLeadDialog({
  orgId,
  onClose,
  onCreated,
}: {
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", companyName: "", jobTitle: "", industry: "", location: "", website: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "x-org-id": orgId, "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, sourceType: "MANUAL" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error === "LEAD_QUOTA_EXCEEDED" ? "Lead quota exceeded for your plan." : data.error || "Failed to create lead.");
      if (data.duplicate) {
        setError("A possible duplicate already exists — the lead was still created. Review it in the list.");
      } else {
        onClose();
        onCreated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add lead">
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg space-y-3 rounded-2xl border border-white/15 bg-[#101f33] p-6">
        <h2 className="text-lg font-bold">Add lead</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name"><input className={inputCls} value={form.fullName} onChange={set("fullName")} /></Field>
          <Field label="Company"><input className={inputCls} value={form.companyName} onChange={set("companyName")} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={form.email} onChange={set("email")} /></Field>
          <Field label="Phone"><input className={inputCls} value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Job title"><input className={inputCls} value={form.jobTitle} onChange={set("jobTitle")} /></Field>
          <Field label="Industry"><input className={inputCls} value={form.industry} onChange={set("industry")} /></Field>
          <Field label="Location"><input className={inputCls} value={form.location} onChange={set("location")} /></Field>
          <Field label="Website"><input className={inputCls} value={form.website} onChange={set("website")} placeholder="https://…" /></Field>
        </div>
        {error && <p role="alert" className="text-sm text-amber-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50">
            {busy ? "Saving…" : "Save lead"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportDialog({ orgId, onClose, onDone }: { orgId: string; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<"file" | "map" | "done">("file");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ created: number; skipped: number; duplicates: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("File too large (max 5 MB).");
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const cols = res.meta.fields ?? [];
        setColumns(cols);
        setRows(res.data.slice(0, 5000));
        // Auto-map obvious column names.
        const auto: Record<string, string> = {};
        for (const f of LEAD_FIELDS) {
          const hit = cols.find((c) => c.toLowerCase().replace(/[^a-z]/g, "") === f.toLowerCase() || c.toLowerCase().includes(f.toLowerCase().replace("name", "")));
          if (hit) auto[f] = hit;
        }
        setMapping(auto);
        setStep("map");
      },
      error: () => setError("Could not parse CSV."),
    });
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "x-org-id": orgId, "Content-Type": "application/json" },
        body: JSON.stringify({ rows, mapping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed.");
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Import leads">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl space-y-4 rounded-2xl border border-white/15 bg-[#101f33] p-6">
        <h2 className="text-lg font-bold">Import leads from CSV</h2>

        {step === "file" && (
          <>
            <input ref={fileRef} type="file" accept=".csv" onChange={onFile} aria-label="Choose CSV file"
              className="block w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-[#D4AF37] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black" />
            <p className="text-xs text-white/50">Max 5 MB. Columns like name, email, phone, company, website are auto-mapped; you can adjust next.</p>
          </>
        )}

        {step === "map" && (
          <>
            <p className="text-sm text-white/60">{rows.length} rows detected. Map your columns:</p>
            <div className="grid grid-cols-2 gap-3">
              {LEAD_FIELDS.map((f) => (
                <Field key={f} label={f}>
                  <select value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}
                    className={inputCls} aria-label={`Map ${f}`}>
                    <option value="">— skip —</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5">Cancel</button>
              <button onClick={runImport} disabled={busy} className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50">
                {busy ? "Importing…" : `Import ${rows.length} rows`}
              </button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <div className="rounded-lg bg-white/5 p-4 text-sm">
              <p><span className="font-semibold text-emerald-400">{result.created}</span> created</p>
              <p><span className="font-semibold text-amber-400">{result.duplicates}</span> possible duplicates flagged</p>
              <p><span className="text-white/60">{result.skipped}</span> skipped (invalid rows)</p>
            </div>
            <div className="flex justify-end">
              <button onClick={() => { onDone(); onClose(); }} className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black hover:brightness-110">
                Done
              </button>
            </div>
          </>
        )}

        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
