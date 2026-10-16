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
import { useSearchParams } from "next/navigation";
import { Plus, Upload, Download, Trash2, X, Globe, ChevronDown, Loader2, SearchX, Users } from "lucide-react";
import { DEMO_ACTION_DISABLED_MESSAGE } from "@/lib/demo";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  activeFilterCount,
  leadFiltersToParams,
  parseLeadFilters,
  type LeadFilters,
} from "@/lib/lead-filters";
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
  verificationConfidence: string | null;
  verificationReason: string | null;
  industryRelevance: number | null;
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
  "NEW", "RESEARCHING", "VERIFIED", "QUALIFIED", "CONTACTED", "FOLLOW_UP", "REPLIED",
  "MEETING", "PROPOSAL", "NEGOTIATION", "WON", "CONVERTED", "LOST", "NOT_RELEVANT", "NURTURE",
];

const LEAD_FIELDS = [
  "fullName", "email", "phone", "jobTitle", "companyName",
  "industry", "location", "city", "country", "website",
] as const;

const columnHelper = createColumnHelper<Lead>();

function scoreColor(s: number) {
  if (s >= 70) return "text-neon-lime";
  if (s >= 40) return "text-amber-400";
  return "text-ink-muted";
}

function statusPillClass(status: string): string {
  switch (status) {
    case "WON":
      return "bg-neon-lime/15 text-neon-lime";
    case "LOST":
      return "bg-red-400/15 text-red-300";
    case "QUALIFIED":
    case "CONTACTED":
    case "REPLIED":
    case "MEETING":
    case "PROPOSAL":
    case "NEGOTIATION":
      return "bg-neon-cyan/15 text-neon-cyan";
    default:
      return "bg-tint/10 text-ink";
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
        <div className="absolute left-0 z-30 mt-1 w-36 overflow-hidden rounded-lg border border-line-strong bg-surface-2 shadow-xl">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-tint/10 ${
                s === lead.status ? "font-semibold text-neon-cyan" : "text-ink"
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
  // Filters and page live in the URL (shareable, survive refresh, targeted by dashboard links).
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseLeadFilters(searchParams), [searchParams]);
  const { page, status, sourceType, verification, minScore } = filters;
  const confirm = useConfirm();
  const [draft, setDraft] = useState(filters.q);
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

  /** Merge a change into the URL. Anything but an explicit page change returns to page 1. */
  const updateFilters = useCallback((patch: Partial<LeadFilters>) => {
    const next: LeadFilters = { ...parseLeadFilters(new URLSearchParams(window.location.search)), ...patch };
    if (!("page" in patch)) next.page = 1;
    const qs = leadFiltersToParams(next).toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  const clearFilters = useCallback(() => {
    setDraft("");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = leadFiltersToParams(filters);
      params.set("page", String(filters.page));
      params.set("pageSize", String(pageSize));
      params.set("sort", "updatedAt");
      params.set("order", "desc");
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
  }, [filters, headers, apiBase]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Debounced search box → URL. The box also follows the URL when it changes from outside
  // (clear-filters, back/forward); state is set in a frame callback, not synchronously in the effect.
  useEffect(() => {
    if (draft.trim() === filters.q) return;
    const t = setTimeout(() => updateFilters({ q: draft }), 400);
    return () => clearTimeout(t);
  }, [draft, filters.q, updateFilters]);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDraft((d) => (d.trim() === filters.q ? d : filters.q)));
    return () => cancelAnimationFrame(raf);
  }, [filters.q]);

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
    const count = selected.size;
    const ok = await confirm({
      title: `Delete ${count} ${count === 1 ? "lead" : "leads"}?`,
      description: "They are removed from this workspace for everyone. This cannot be undone.",
      confirmLabel: `Delete ${count === 1 ? "lead" : `${count} leads`}`,
      tone: "danger",
    });
    if (!ok) return;
    setBulkBusy(true);
    setError(null);
    try {
      let failed = 0;
      for (const id of selected) {
        const res = await fetch(`${apiBase}/leads/${id}`, { method: "DELETE", headers }).catch(() => null);
        if (!res?.ok) failed += 1;
      }
      if (failed > 0) setError(`${failed} of ${count} leads could not be deleted. They may already be gone or you may lack permission.`);
      await fetchLeads();
    } finally {
      setBulkBusy(false);
    }
  }

  function exportCsv() {
    // window.open cannot send the x-org-id header, so the active workspace goes in the URL
    // (the server checks it against the signed-in user's memberships).
    window.open(`${apiBase}/leads/export?format=csv&orgId=${encodeURIComponent(orgId)}`, "_blank", "noopener");
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
            className="h-4 w-4 accent-neon-cyan"
          />
        ),
        cell: (info) => (
          <input
            type="checkbox"
            aria-label={`Select lead ${info.row.original.company?.name ?? info.row.original.fullName ?? info.row.original.id}`}
            checked={selected.has(info.row.original.id)}
            onChange={() => toggle(info.row.original.id)}
            className="h-4 w-4 accent-neon-cyan"
          />
        ),
      }),
      columnHelper.accessor((r) => r.company?.name ?? r.fullName ?? "", {
        id: "company",
        header: "Company",
        cell: (info) => (
          <Link
            href={`/leads/${info.row.original.id}`}
            className="font-medium text-ink hover:text-neon-cyan hover:underline"
          >
            {info.getValue() || "—"}
          </Link>
        ),
      }),
      columnHelper.accessor("phone", {
        id: "phone",
        header: "Phone",
        cell: (info) => <span className="text-ink-muted">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("email", {
        id: "email",
        header: "Email",
        cell: (info) => <span className="text-ink-muted">{info.getValue() || "—"}</span>,
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
                className="text-xs text-neon-cyan hover:underline"
              >
                Open site
              </a>
            );
          if (info.getValue() === "NO_WEBSITE")
            return (
              <span className="rounded-full bg-neon-cyan/15 px-2.5 py-0.5 text-xs font-semibold text-neon-cyan">
                NO WEBSITE
              </span>
            );
          return <span className="text-ink-dim">—</span>;
        },
      }),
      columnHelper.accessor((r) => [r.city, r.state, r.country].filter(Boolean).join(", "), {
        id: "location",
        header: "Location",
        cell: (info) => <span className="text-ink-muted">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("industry", {
        id: "industry",
        header: "Industry",
        cell: (info) => <span className="text-ink-muted">{info.getValue() || "—"}</span>,
      }),
      columnHelper.accessor("opportunityType", {
        id: "opportunity",
        header: "Opportunity",
        cell: (info) => {
          const v = info.getValue();
          if (v === "HIGH")
            return (
              <span className="rounded-full bg-neon-cyan/15 px-2.5 py-0.5 text-xs font-semibold text-neon-cyan">
                HIGH
              </span>
            );
          if (v === "MEDIUM")
            return (
              <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                MEDIUM
              </span>
            );
          if (v === "LOW") return <span className="text-xs text-ink-muted">LOW</span>;
          return <span className="text-ink-dim">—</span>;
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
      columnHelper.accessor("verificationConfidence", {
        id: "verification",
        header: "Verification",
        cell: (info) => {
          const v = info.getValue() as string | null;
          const reason = (info.row.original as { verificationReason?: string | null }).verificationReason;
          if (!v) return <span className="text-ink-dim">—</span>;
          const cls =
            v === "HIGH"
              ? "bg-neon-lime/15 text-neon-lime"
              : v === "MEDIUM"
                ? "bg-neon-blue/15 text-neon-blue"
                : v === "LOW"
                  ? "bg-amber-400/15 text-amber-300"
                  : "bg-red-400/15 text-red-300";
          return (
            <span title={reason ?? undefined} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
              {v}
            </span>
          );
        },
      }),
      columnHelper.accessor("contactable", {
        id: "contactable",
        header: "Contactability",
        cell: (info) =>
          info.getValue() ? (
            <span className="rounded-full bg-neon-lime/15 px-2.5 py-0.5 text-xs font-semibold text-neon-lime">
              CONTACTABLE
            </span>
          ) : (
            <span className="text-xs text-ink-dim">Not yet</span>
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
          <span className="text-xs text-ink-muted">
            {info.getValue() === "GOOGLE_BUSINESS" ? "GOOGLE MAPS" : info.getValue().replace(/_/g, " ")}
          </span>
        ),
      }),
      columnHelper.accessor("instagramUsername", {
        id: "ig_username",
        header: "Instagram Username",
        cell: (info) => (
          <span className="text-xs text-ink-muted">
            {info.getValue() ? `@${info.getValue()}` : <span className="text-ink-dim">—</span>}
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
              className="rounded-lg border border-neon-cyan/30 px-2.5 py-1 text-xs text-neon-cyan hover:bg-neon-cyan/10"
            >
              View Message
            </button>
          ) : (
            <span className="text-ink-dim">—</span>
          ),
      }),
      columnHelper.display({
        id: "remark",
        header: "Remark",
        cell: (info) => (
          <button
            type="button"
            onClick={() => setRemarkLead(info.row.original)}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
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
          if (!lead.website) return <span className="text-ink-dim">—</span>;
          return (
            <Link
              href={`/intelligence?leadId=${lead.id}`}
              title={`Inspect website: ${lead.website}`}
              aria-label={`Inspect website for ${lead.company?.name ?? lead.fullName ?? lead.id}`}
              className="inline-flex items-center text-ink-muted transition hover:text-neon-cyan"
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
      { id: "verification", label: "Verification" },
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
        <div className="flex items-center justify-between rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-2 text-sm text-neon-cyan">
          <span>{demoNotice}</span>
          <button
            onClick={() => setDemoNotice(null)}
            aria-label="Dismiss"
            className="ml-3 text-neon-cyan/70 hover:text-neon-cyan"
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
          className="min-h-11 w-full rounded-control border border-line bg-black/30 px-3 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-neon-cyan sm:min-h-10 sm:w-64"
        />
        <select
          value={status}
          onChange={(e) => updateFilters({ status: e.target.value })}
          aria-label="Filter by status"
          className="min-h-11 rounded-control border border-line bg-black/30 px-3 text-sm text-ink outline-none focus:border-neon-cyan sm:min-h-10"
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
            updateFilters({ sourceType: next });
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
          className="min-h-11 rounded-control border border-line bg-black/30 px-3 text-sm text-ink outline-none focus:border-neon-cyan sm:min-h-10"
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={verification}
          onChange={(e) => updateFilters({ verification: e.target.value })}
          aria-label="Filter by verification"
          title="Verification confidence from the AI sales agent"
          className="min-h-11 rounded-control border border-line bg-black/30 px-3 text-sm text-ink outline-none focus:border-neon-cyan sm:min-h-10"
        >
          <option value="">All verification</option>
          <option value="HIGH">Verified · High</option>
          <option value="MEDIUM">Verified · Medium</option>
          <option value="LOW">Low confidence</option>
          <option value="REJECTED">Rejected</option>
          <option value="UNVERIFIED">Not verified</option>
        </select>
        <input
          value={minScore}
          inputMode="numeric"
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
            updateFilters({ minScore: v !== "" && Number(v) <= 100 ? String(Number(v)) : v === "" ? "" : "100" });
          }}
          placeholder="Min score"
          aria-label="Minimum lead score"
          title="Minimum lead score (0-100)"
          className="min-h-11 w-24 rounded-control border border-line bg-black/30 px-3 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-neon-cyan sm:min-h-10"
        />
        <div ref={columnsRef} className="relative">
          <Button
            variant="secondary"
            onClick={() => setShowColumns((v) => !v)}
            aria-haspopup="true"
            aria-expanded={showColumns}
            aria-label="Show or hide columns"
          >
            Columns
          </Button>
          {showColumns && (
            <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-line-strong bg-surface-2 p-2 shadow-xl">
              {TOGGLEABLE_COLUMNS.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-ink hover:bg-tint/10"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenCols.includes(c.id)}
                    onChange={() => toggleColumn(c.id)}
                    className="h-3.5 w-3.5 accent-neon-cyan"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {canWrite && (
            <>
              <Button onClick={() => (demo ? blockDemo() : setShowAdd(true))}>
                <Plus size={16} aria-hidden="true" /> Add lead
              </Button>
              <Button variant="secondary" onClick={() => (demo ? blockDemo() : setShowImport(true))}>
                <Upload size={16} aria-hidden="true" /> Import
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={exportCsv}>
            <Download size={16} aria-hidden="true" /> Export
          </Button>
        </div>
      </div>

      {/* Filters that arrive by link (dashboard drill-downs) have no dropdown, so they show as removable chips. */}
      {(filters.followUp || filters.contactable || filters.websiteStatus) && (
        <div role="group" aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {filters.followUp === "due" && (
            <FilterChip label="Follow-up due" onRemove={() => updateFilters({ followUp: "" })} />
          )}
          {filters.contactable === "true" && (
            <FilterChip label="Contactable" onRemove={() => updateFilters({ contactable: "" })} />
          )}
          {filters.websiteStatus && (
            <FilterChip
              label={
                filters.websiteStatus === "NO_WEBSITE"
                  ? "No website"
                  : filters.websiteStatus === "HAS_WEBSITE"
                    ? "Has a website"
                    : "Website unknown"
              }
              onRemove={() => updateFilters({ websiteStatus: "" })}
            />
          )}
        </div>
      )}

      {/* Bulk bar */}
      {selected.size > 0 && canWrite && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-2 text-sm">
          <span className="text-neon-cyan">{selected.size} selected</span>
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
            className="rounded border border-line-strong bg-black/40 px-2 py-1 text-sm text-ink"
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
          <button onClick={() => setSelected(new Set())} className="ml-auto text-ink-muted hover:text-ink">
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
      <div
        role="region"
        aria-label="Leads table (scrolls sideways and down)"
        tabIndex={0}
        className="max-h-[70vh] overflow-auto rounded-card border border-line"
      >
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line bg-surface-2">
                {hg.headers.map((h) => (
                  <th key={h.id} scope="col" className="whitespace-nowrap px-4 py-3 font-medium text-ink-muted">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} aria-hidden="true" className="border-b border-line/60">
                  <td colSpan={visibleColCount} className="px-4 py-3.5">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={visibleColCount} className="p-4 sm:p-8">
                  {activeFilterCount(filters) > 0 ? (
                    <EmptyState
                      icon={SearchX}
                      tone="muted"
                      title="No leads match these filters"
                      description="Remove a filter or search for something else."
                      action={
                        <Button variant="secondary" size="sm" onClick={clearFilters}>
                          Clear all filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={Users}
                      title="No leads yet"
                      description="Add a lead by hand, import a CSV, or run a discovery to find real businesses."
                      action={
                        <>
                          {canWrite && (
                            <Button size="sm" onClick={() => (demo ? blockDemo() : setShowAdd(true))}>
                              <Plus size={16} aria-hidden="true" /> Add lead
                            </Button>
                          )}
                          <Link href="/discover" className="text-sm font-semibold text-neon-cyan hover:underline">
                            Run a discovery →
                          </Link>
                        </>
                      }
                    />
                  )}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-line/60 transition hover:bg-tint/5">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`px-4 py-3 ${cell.column.id === "company" ? "min-w-[12rem] max-w-[18rem]" : "whitespace-nowrap"}`}
                    >
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
      <div className="flex items-center justify-between text-sm text-ink-muted">
        <span>
          {total} lead{total === 1 ? "" : "s"} · Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            aria-label="Previous page"
            onClick={() => updateFilters({ page: page - 1 })}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            aria-label="Next page"
            onClick={() => updateFilters({ page: page + 1 })}
          >
            Next
          </Button>
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

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-neon-cyan/40 bg-neon-cyan/10 pl-3 pr-1 text-xs font-medium text-neon-cyan">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-neon-cyan/20"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // The control sits inside the <label>, so the association is implicit (click + screen readers).
  return (
    <label className="block">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

const inputCls =
  "w-full rounded-control border border-line bg-black/30 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-neon-cyan sm:py-2";

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
    <Dialog
      open
      onClose={onClose}
      title="Add lead"
      description="Add one prospect by hand. Only fields you know — nothing is guessed."
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="add-lead-form" loading={busy}>
            {busy ? "Saving…" : "Save lead"}
          </Button>
        </>
      }
    >
      <form id="add-lead-form" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Full name"><input data-autofocus className={inputCls} value={form.fullName} onChange={set("fullName")} /></Field>
          <Field label="Company"><input className={inputCls} value={form.companyName} onChange={set("companyName")} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={form.email} onChange={set("email")} /></Field>
          <Field label="Phone"><input className={inputCls} value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Job title"><input className={inputCls} value={form.jobTitle} onChange={set("jobTitle")} /></Field>
          <Field label="Industry"><input className={inputCls} value={form.industry} onChange={set("industry")} /></Field>
          <Field label="Location"><input className={inputCls} value={form.location} onChange={set("location")} /></Field>
          <Field label="Website"><input className={inputCls} value={form.website} onChange={set("website")} placeholder="https://…" /></Field>
        </div>
        {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
      </form>
    </Dialog>
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
        setError(null);
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
    <Dialog
      open
      onClose={step === "done" ? () => { onDone(); onClose(); } : onClose}
      title="Import leads from CSV"
      size="lg"
      dismissible={!busy}
      footer={
        step === "map" ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={runImport} loading={busy}>
              {busy ? "Importing…" : `Import ${rows.length} rows`}
            </Button>
          </>
        ) : step === "done" ? (
          <Button onClick={() => { onDone(); onClose(); }} data-autofocus>Done</Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        )
      }
    >
      <div className="space-y-4">
        {step === "file" && (
          <>
            <input ref={fileRef} data-autofocus type="file" accept=".csv" onChange={onFile} aria-label="Choose CSV file"
              className="block w-full text-sm text-ink-muted file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-control file:border-0 file:bg-neon-cyan file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#021614]" />
            <p className="text-xs text-ink-muted">Max 5 MB. Columns like name, email, phone, company, website are auto-mapped; you can adjust next.</p>
          </>
        )}

        {step === "map" && (
          <>
            <p className="text-sm text-ink-muted">{rows.length} rows detected. Map your columns:</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LEAD_FIELDS.map((f) => (
                <Field key={f} label={f}>
                  <select value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}
                    className={inputCls}>
                    <option value="">— skip —</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </>
        )}

        {step === "done" && result && (
          <div className="rounded-control bg-tint/5 p-4 text-sm" role="status">
            <p><span className="font-semibold text-neon-lime">{result.created}</span> created</p>
            <p><span className="font-semibold text-amber-300">{result.duplicates}</span> possible duplicates flagged</p>
            <p><span className="text-ink-muted">{result.skipped}</span> skipped (invalid rows)</p>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      </div>
    </Dialog>
  );
}
