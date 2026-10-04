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
import { Plus, Upload, Download, Trash2, X, Globe, ChevronDown, Loader2 } from "lucide-react";
import { DEMO_ACTION_DISABLED_MESSAGE } from "@/lib/demo";
import {
  SOURCE_OPTIONS,
  IG_PRESET_VISIBLE,
  ConnectionStatusDropdown,
  MessageViewerModal,
  RemarkModal,
  ProfileLink,
} from "./InstagramLeadCells";

interface Lead {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  websiteStatus: string | null;
  opportunityType: string | null;
  contactable: boolean;
  industry: string | null;
  instagramUrl: string | null;
  instagramUsername: string | null;
  instagramConnectionStatus: string | null;
  aiMessage: string | null;
  aiMessageSource: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  scoreReason: string | null;
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

function statusPillClass(status: string): string {
  switch (status) {
    case "WON":
      return "bg-emerald-400/15 text-emerald-300";
    case "LOST":
      return "bg-red-400/15 text-red-300";
    case "QUALIFIED":
    case "CONTACTED":
    case "REPLIED":
    case "MEETING":
    case "PROPOSAL":
    case "NEGOTIATION":
      return "bg-[#D4AF37]/15 text-[#D4AF37]";
    default:
      return "bg-white/10 text-white/80";
  }
}

/**
 * Inline status dropdown — saves immediately via the server-side
 * PATCH /api/leads/[id] (tenant-isolated, RBAC-checked, audited).
 * Optimistic update with rollback + visible error on failure.
 */
function LeadStatusDropdown({
  lead,
  orgId,
  apiBase,
  canWrite,
  demo,
  onBlocked,
  onChanged,
}: {
  lead: Lead;
  orgId: string;
  apiBase: string;
  canWrite: boolean;
  demo: boolean;
  onBlocked: () => void;
  onChanged: (id: string, status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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
      <span className={`rounded-full px-2.5 py-0.5 text-xs ${statusPillClass(lead.status)}`}>
        {lead.status}
      </span>
    );
  }

  async function pick(next: string) {
    setOpen(false);
    if (next === lead.status) return;
    if (demo) {
      onBlocked();
      return;
    }
    const prev = lead.status;
    setSaving(true);
    setError(null);
    onChanged(lead.id, next); // optimistic
    try {
      const res = await fetch(`${apiBase}/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "x-org-id": orgId, "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          res.status === 400 ? "Invalid status." :
          res.status === 403 ? "Access denied." :
          res.status === 404 ? "Lead not found." :
          (data?.error as string) || "Status update failed.",
        );
      }
    } catch (e) {
      onChanged(lead.id, prev); // rollback
      setError(e instanceof Error ? e.message : "Status update failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        aria-label={`Change status for ${lead.company?.name ?? lead.fullName ?? lead.id}`}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs transition hover:brightness-125 disabled:opacity-60 ${statusPillClass(lead.status)}`}
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : null}
        {lead.status}
        <ChevronDown size={12} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-36 overflow-hidden rounded-lg border border-white/15 bg-[#101c2e] shadow-xl">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-white/10 ${
                s === lead.status ? "font-semibold text-[#D4AF37]" : "text-white/80"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 max-w-[180px] text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
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
  const [sourceType, setSourceType] = useState("");
  const [messageLead, setMessageLead] = useState<Lead | null>(null);
  const [remarkLead, setRemarkLead] = useState<Lead | null>(null);
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
        ...(sourceType ? { sourceType } : {}),
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
  }, [page, q, status, sourceType, headers, apiBase]);

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
            aria-label={`Select lead ${info.row.original.company?.name ?? info.row.original.fullName ?? info.row.original.id}`}
            checked={selected.has(info.row.original.id)}
            onChange={() => toggle(info.row.original.id)}
            className="h-4 w-4 accent-[#D4AF37]"
          />
        ),
      }),
      columnHelper.accessor((r) => r.company?.name ?? r.fullName ?? "", {
        id: "company",
        header: "Company",
        cell: (info) => (
          <Link
            href={`/leads/${info.row.original.id}`}
            className="font-medium text-white hover:text-[#D4AF37] hover:underline"
          >
            {info.getValue() || "—"}
          </Link>
        ),
      }),
      columnHelper.accessor("phone", {
        id: "phone",
        header: "Phone",
        cell: (info) => <span className="text-white/70">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("email", {
        id: "email",
        header: "Email",
        cell: (info) => <span className="text-white/70">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("websiteStatus", {
        id: "website",
        header: "Website",
        cell: (info) => {
          const lead = info.row.original;
          if (lead.website)
            return (
              <a
                href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#D4AF37] hover:underline"
              >
                Open site
              </a>
            );
          if (info.getValue() === "NO_WEBSITE")
            return (
              <span className="rounded-full bg-[#D4AF37]/15 px-2.5 py-0.5 text-xs font-semibold text-[#D4AF37]">
                NO WEBSITE
              </span>
            );
          return <span className="text-white/30">—</span>;
        },
      }),
      columnHelper.accessor((r) => [r.city, r.state, r.country].filter(Boolean).join(", "), {
        id: "location",
        header: "Location",
        cell: (info) => <span className="text-white/70">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("industry", {
        id: "industry",
        header: "Industry",
        cell: (info) => <span className="text-white/70">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("opportunityType", {
        id: "opportunity",
        header: "Opportunity",
        cell: (info) => {
          const v = info.getValue();
          if (v === "HIGH")
            return (
              <span className="rounded-full bg-[#D4AF37]/15 px-2.5 py-0.5 text-xs font-semibold text-[#D4AF37]">
                HIGH
              </span>
            );
          if (v === "MEDIUM")
            return (
              <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                MEDIUM
              </span>
            );
          if (v === "LOW") return <span className="text-xs text-white/50">LOW</span>;
          return <span className="text-white/30">—</span>;
        },
      }),
      columnHelper.accessor("leadScore", {
        id: "score",
        header: "Score",
        cell: (info) => (
          <span
            className={`font-semibold ${scoreColor(info.getValue())}`}
            title={info.row.original.scoreReason ?? undefined}
          >
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor("contactable", {
        id: "contactable",
        header: "Contactability",
        cell: (info) =>
          info.getValue() ? (
            <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
              CONTACTABLE
            </span>
          ) : (
            <span className="text-xs text-white/40">Not yet</span>
          ),
      }),
      columnHelper.accessor("status", {
        id: "status",
        header: "Status",
        cell: (info) => (
          <LeadStatusDropdown
            lead={info.row.original}
            orgId={orgId}
            apiBase={apiBase}
            canWrite={canWrite}
            demo={demo}
            onBlocked={blockDemo}
            onChanged={handleStatusChanged}
          />
        ),
      }),
      columnHelper.accessor("sourceType", {
        id: "source",
        header: "Source",
        cell: (info) => (
          <span className="text-xs text-white/50">
            {info.getValue() === "GOOGLE_BUSINESS" ? "GOOGLE MAPS" : info.getValue().replace(/_/g, " ")}
          </span>
        ),
      }),
      columnHelper.accessor("instagramUsername", {
        id: "ig_username",
        header: "Instagram Username",
        cell: (info) => (
          <span className="text-xs text-white/70">
            {info.getValue() ? `@${info.getValue()}` : <span className="text-white/30">—</span>}
          </span>
        ),
      }),
      columnHelper.accessor("instagramUrl", {
        id: "ig_profile",
        header: "Profile URL",
        cell: (info) => <ProfileLink url={info.getValue()} />,
      }),
      columnHelper.accessor("instagramConnectionStatus", {
        id: "ig_connected",
        header: "Connected",
        cell: (info) => (
          <ConnectionStatusDropdown
            lead={info.row.original}
            orgId={orgId}
            apiBase={apiBase}
            canWrite={canWrite}
            demo={demo}
            onBlocked={blockDemo}
            onChanged={handleConnectionChanged}
          />
        ),
      }),
      columnHelper.accessor("aiMessage", {
        id: "ai_message",
        header: "AI Message",
        cell: (info) =>
          info.getValue() ? (
            <button
              type="button"
              onClick={() => setMessageLead(info.row.original)}
              className="rounded-lg border border-[#D4AF37]/30 px-2.5 py-1 text-xs text-[#D4AF37] hover:bg-[#D4AF37]/10"
            >
              View Message
            </button>
          ) : (
            <span className="text-white/30">—</span>
          ),
      }),
      columnHelper.display({
        id: "remark",
        header: "Remark",
        cell: (info) => (
          <button
            type="button"
            onClick={() => setRemarkLead(info.row.original)}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:text-white"
          >
            Remarks
          </button>
        ),
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
              aria-label={`Inspect website for ${lead.company?.name ?? lead.fullName ?? lead.id}`}
              className="inline-flex items-center text-white/50 transition hover:text-[#D4AF37]"
            >
              <Globe size={16} />
            </Link>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leads, selected, orgId, apiBase, canWrite, demo],
  );

  /** All toggleable columns (id + label) for the Columns chooser. */
  const TOGGLEABLE_COLUMNS = useMemo(
    () => [
      { id: "company", label: "Company" },
      { id: "phone", label: "Phone" },
      { id: "email", label: "Email" },
      { id: "website", label: "Website" },
      { id: "location", label: "Location" },
      { id: "industry", label: "Industry" },
      { id: "opportunity", label: "Opportunity" },
      { id: "score", label: "Score" },
      { id: "contactable", label: "Contactability" },
      { id: "status", label: "Status" },
      { id: "source", label: "Source" },
      { id: "ig_username", label: "Instagram Username" },
      { id: "ig_profile", label: "Profile URL" },
      { id: "ig_connected", label: "Connected" },
      { id: "ai_message", label: "AI Message" },
      { id: "remark", label: "Remark" },
      { id: "inspect", label: "Site" },
    ],
    [],
  );

  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wdd-leads-columns");
      if (raw) setHiddenCols(JSON.parse(raw));
    } catch {
      /* keep defaults */
    }
  }, []);

  const toggleColumn = (id: string) => {
    setHiddenCols((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      try {
        localStorage.setItem("wdd-leads-columns", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.id === "select" || !hiddenCols.includes(c.id as string)),
    [columns, hiddenCols],
  );

  const [showColumns, setShowColumns] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showColumns) return;
    const close = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setShowColumns(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showColumns]);

  /** Instant local update for the inline status dropdown (server persists). */
  const handleStatusChanged = useCallback((id: string, status: string) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
  }, []);
  const handleConnectionChanged = useCallback((id: string, instagramConnectionStatus: string) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, instagramConnectionStatus } : l)),
    );
  }, []);
  const handleMessageSaved = useCallback((id: string, aiMessage: string) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, aiMessage } : l)));
    setMessageLead((prev) => (prev && prev.id === id ? { ...prev, aiMessage } : prev));
  }, []);

  const table = useReactTable({
    data: leads,
    columns: visibleColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const visibleColCount = visibleColumns.length;

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
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <select
          value={sourceType}
          onChange={(e) => {
            const next = e.target.value;
            setSourceType(next);
            setPage(1);
            // Instagram source → apply the Instagram-oriented column preset.
            if (next === "INSTAGRAM") {
              const hidden = TOGGLEABLE_COLUMNS.map((c) => c.id).filter(
                (id) => !IG_PRESET_VISIBLE.includes(id),
              );
              setHiddenCols(hidden);
              try {
                localStorage.setItem("wdd-leads-columns", JSON.stringify(hidden));
              } catch {
                /* ignore */
              }
            }
          }}
          aria-label="Filter by source"
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]"
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div ref={columnsRef} className="relative">
          <button
            onClick={() => setShowColumns((v) => !v)}
            aria-label="Show or hide columns"
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
          >
            Columns
          </button>
          {showColumns && (
            <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-white/15 bg-[#101c2e] p-2 shadow-xl">
              {TOGGLEABLE_COLUMNS.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-white/80 hover:bg-white/10"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenCols.includes(c.id)}
                    onChange={() => toggleColumn(c.id)}
                    className="h-3.5 w-3.5 accent-[#D4AF37]"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
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
                <td colSpan={visibleColCount} className="px-4 py-10 text-center text-white/40">
                  Loading leads…
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={visibleColCount} className="px-4 py-10 text-center text-white/40">
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
      {messageLead && (
        <MessageViewerModal
          lead={messageLead}
          orgId={orgId}
          apiBase={apiBase}
          canWrite={canWrite}
          demo={demo}
          onBlocked={blockDemo}
          onClose={() => setMessageLead(null)}
          onSaved={handleMessageSaved}
        />
      )}
      {remarkLead && (
        <RemarkModal
          leadId={remarkLead.id}
          leadLabel={remarkLead.company?.name ?? remarkLead.fullName ?? remarkLead.id}
          orgId={orgId}
          apiBase={apiBase}
          canWrite={canWrite}
          demo={demo}
          onBlocked={blockDemo}
          onClose={() => setRemarkLead(null)}
        />
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
