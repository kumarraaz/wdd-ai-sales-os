"use client";

import { useMemo, useState } from "react";
import type { DiscoveredCompany } from "@/lib/discovery/types";
import { EMPTY_FILTERS, filterCandidates, type ResultsFilters } from "@/lib/discovery/result-filters";

function Pill({ tone, children }: { tone: "gold" | "green" | "amber" | "muted" | "red"; children: React.ReactNode }) {
  const cls = {
    gold: "bg-[#D4AF37]/15 text-[#D4AF37]",
    green: "bg-emerald-400/15 text-emerald-300",
    amber: "bg-amber-400/15 text-amber-300",
    muted: "bg-white/10 text-white/50",
    red: "bg-red-400/15 text-red-300",
  }[tone];
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function ExtLink({ href, label }: { href?: string; label: string }) {
  if (!href) return <span className="text-white/25">—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-[#D4AF37] hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {label} ↗
    </a>
  );
}

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  render: (c: DiscoveredCompany) => React.ReactNode;
}

const COLUMNS: ColumnDef[] = [
  {
    key: "company",
    label: "Company",
    defaultVisible: true,
    render: (c) => (
      <span>
        <span className="font-semibold text-white">{c.name}</span>
        {c.inCrm && (
          <span className="ml-2">
            <Pill tone="muted">In CRM</Pill>
          </span>
        )}
      </span>
    ),
  },
  { key: "industry", label: "Industry", defaultVisible: true, render: (c) => c.category ?? "—" },
  {
    key: "location",
    label: "Location",
    defaultVisible: true,
    render: (c) => [c.city, c.state, c.country].filter(Boolean).join(", ") || "—",
  },
  {
    key: "phone",
    label: "Phone",
    defaultVisible: true,
    render: (c) =>
      c.phone ? (
        <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="text-white/85 hover:text-[#D4AF37]" onClick={(e) => e.stopPropagation()}>
          {c.phone}
        </a>
      ) : (
        "—"
      ),
  },
  {
    key: "email",
    label: "Email",
    defaultVisible: false,
    render: (c) =>
      c.email ? (
        <a href={`mailto:${c.email}`} className="text-white/85 hover:text-[#D4AF37]" onClick={(e) => e.stopPropagation()}>
          {c.email}
        </a>
      ) : (
        "—"
      ),
  },
  {
    key: "website",
    label: "Website",
    defaultVisible: true,
    render: (c) =>
      c.website ? (
        <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-[#D4AF37] hover:underline" onClick={(e) => e.stopPropagation()}>
          {c.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
        </a>
      ) : (
        <span className="text-white/25">—</span>
      ),
  },
  {
    key: "websiteStatus",
    label: "Website Status",
    defaultVisible: true,
    render: (c) =>
      c.websiteStatus === "NO_WEBSITE" ? (
        <Pill tone="gold">NO WEBSITE</Pill>
      ) : c.websiteStatus === "HAS_WEBSITE" ? (
        <Pill tone="muted">Has website</Pill>
      ) : (
        <Pill tone="muted">Unknown</Pill>
      ),
  },
  {
    key: "contactable",
    label: "Contactable",
    defaultVisible: true,
    render: (c) => (c.contactable ? <Pill tone="green">Yes</Pill> : <Pill tone="red">No</Pill>),
  },
  { key: "source", label: "Source", defaultVisible: true, render: (c) => <span className="whitespace-nowrap">{c.provider}</span> },
  {
    key: "score",
    label: "Score",
    defaultVisible: true,
    render: (c) => (
      <span className="font-semibold text-white" title={c.scoreReason ?? ""}>
        {c.score ?? "—"}
      </span>
    ),
  },
  {
    key: "qualification",
    label: "Qualification",
    defaultVisible: true,
    render: (c) =>
      c.qualification === "qualified" ? (
        <Pill tone="green">Qualified</Pill>
      ) : c.qualification === "maybe" ? (
        <Pill tone="amber">Maybe</Pill>
      ) : c.qualification === "not_qualified" ? (
        <Pill tone="muted">Not qualified</Pill>
      ) : (
        <span className="text-white/30">Unreviewed</span>
      ),
  },
  {
    key: "opportunity",
    label: "Opportunity",
    defaultVisible: true,
    render: (c) =>
      c.opportunityType === "HIGH" ? (
        <Pill tone="gold">HIGH</Pill>
      ) : c.opportunityType === "MEDIUM" ? (
        <Pill tone="amber">MEDIUM</Pill>
      ) : c.opportunityType === "LOW" ? (
        <span className="text-white/40">LOW</span>
      ) : (
        <span className="text-white/40">—</span>
      ),
  },
  { key: "rating", label: "Rating", defaultVisible: false, render: (c) => (c.rating != null ? `★ ${c.rating.toFixed(1)}` : "—") },
  { key: "reviewCount", label: "Reviews", defaultVisible: false, render: (c) => c.reviewCount?.toLocaleString() ?? "—" },
  { key: "instagram", label: "Instagram", defaultVisible: false, render: (c) => <ExtLink href={c.instagramUrl} label="Open" /> },
  { key: "facebook", label: "Facebook", defaultVisible: false, render: (c) => <ExtLink href={c.facebookUrl} label="Open" /> },
  { key: "linkedin", label: "LinkedIn", defaultVisible: false, render: (c) => <ExtLink href={c.linkedinUrl} label="Open" /> },
  { key: "googleMaps", label: "Google Maps", defaultVisible: false, render: (c) => <ExtLink href={c.googleMapsUrl} label="Open" /> },
  {
    key: "recentEvidence",
    label: "Recent Evidence",
    defaultVisible: false,
    render: (c) => <span title="Recent source evidence — not a company creation date">{fmtDate(c.recentEvidenceDate)}</span>,
  },
  { key: "discovered", label: "Discovered", defaultVisible: true, render: (c) => fmtDate(c.discoveredAt) },
];

export function ResultsTable({
  candidates,
  selection,
  onToggle,
  onSelectIds,
  onClearSelection,
  filters,
  onFiltersChange,
  visibleColumns,
  onToggleColumn,
  drafts,
  onCopyDraft,
}: {
  candidates: DiscoveredCompany[];
  selection: Set<string>;
  onToggle: (providerId: string) => void;
  onSelectIds: (ids: string[]) => void;
  onClearSelection: () => void;
  filters: ResultsFilters;
  onFiltersChange: (f: ResultsFilters) => void;
  visibleColumns: Set<string>;
  onToggleColumn: (key: string) => void;
  drafts?: Map<string, string>;
  onCopyDraft?: (providerId: string) => void;
}) {
  const [showColumns, setShowColumns] = useState(false);
  const filtered = useMemo(() => filterCandidates(candidates, filters), [candidates, filters]);
  const visibleCols = useMemo(() => COLUMNS.filter((c) => visibleColumns.has(c.key)), [visibleColumns]);
  const sources = useMemo(() => [...new Set(candidates.map((c) => c.provider))], [candidates]);

  const filteredIds = filtered.map((c) => c.providerId);
  const selectedVisible = filteredIds.filter((id) => selection.has(id));
  const allVisibleSelected = filteredIds.length > 0 && selectedVisible.length === filteredIds.length;

  const set = (patch: Partial<ResultsFilters>) => onFiltersChange({ ...filters, ...patch });
  const selectCls = "rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80";
  const inputCls = "rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80 placeholder:text-white/30";

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={filters.source} onChange={(e) => set({ source: e.target.value })} className={selectCls} aria-label="Filter by source">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={filters.websiteStatus} onChange={(e) => set({ websiteStatus: e.target.value })} className={selectCls} aria-label="Filter by website status">
          <option value="">Website: any</option>
          <option value="NO_WEBSITE">No website</option>
          <option value="HAS_WEBSITE">Has website</option>
          <option value="UNKNOWN">Unknown</option>
        </select>
        <select value={filters.contactable} onChange={(e) => set({ contactable: e.target.value })} className={selectCls} aria-label="Filter by contactability">
          <option value="">Contactable: any</option>
          <option value="yes">Contactable</option>
          <option value="no">Not contactable</option>
        </select>
        <select value={filters.qualification} onChange={(e) => set({ qualification: e.target.value })} className={selectCls} aria-label="Filter by qualification">
          <option value="">Qualification: any</option>
          <option value="qualified">Qualified</option>
          <option value="maybe">Maybe</option>
          <option value="not_qualified">Not qualified</option>
          <option value="unreviewed">Unreviewed</option>
        </select>
        <select value={filters.opportunity} onChange={(e) => set({ opportunity: e.target.value })} className={selectCls} aria-label="Filter by opportunity">
          <option value="">Opportunity: any</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
          <option value="UNKNOWN">Unknown</option>
        </select>
        <select value={filters.score} onChange={(e) => set({ score: e.target.value })} className={selectCls} aria-label="Filter by score">
          <option value="">Score: any</option>
          <option value="80">80+</option>
          <option value="60">60+</option>
          <option value="40">40+</option>
          <option value="below40">Below 40</option>
        </select>
        <select value={filters.recentEvidence} onChange={(e) => set({ recentEvidence: e.target.value })} className={selectCls} aria-label="Filter by recent evidence">
          <option value="">Evidence: any</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="6m">Last 6 months</option>
          <option value="1y">Last 1 year</option>
        </select>
        <input value={filters.industry} onChange={(e) => set({ industry: e.target.value })} placeholder="Industry…" className={inputCls} />
        <input value={filters.location} onChange={(e) => set({ location: e.target.value })} placeholder="Location…" className={inputCls} />
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColumns((v) => !v)}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            Columns ▾
          </button>
          {showColumns && (
            <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-white/10 bg-[#0D1B2A] p-2 shadow-xl">
              {COLUMNS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-white/80 hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(c.key)}
                    onChange={() => onToggleColumn(c.key)}
                    className="accent-[#D4AF37]"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selection bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
        <span>
          <strong className="text-white">{selection.size}</strong> selected ·{" "}
          <strong className="text-white">{filtered.length}</strong> matching filters ·{" "}
          <strong className="text-white">{candidates.length}</strong> total
        </span>
        <button
          type="button"
          onClick={() => onSelectIds(filteredIds)}
          className="rounded-md bg-white/10 px-2.5 py-1 font-semibold text-white/80 hover:bg-white/20"
        >
          Select all {filtered.length} matching
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className="rounded-md bg-white/10 px-2.5 py-1 font-semibold text-white/80 hover:bg-white/20"
        >
          Clear selection
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[1200px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/5 text-left">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedVisible.length > 0 && !allVisibleSelected;
                  }}
                  onChange={() => (allVisibleSelected ? onClearSelection() : onSelectIds(filteredIds))}
                  className="h-4 w-4 accent-[#D4AF37]"
                  aria-label="Select all visible"
                />
              </th>
              {visibleCols.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-white/50">
                  {c.label}
                </th>
              ))}
              {drafts && drafts.size > 0 && (
                <th className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-white/50">
                  Draft
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.providerId} className="border-b border-white/5 hover:bg-white/[0.03]">
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selection.has(c.providerId)}
                    onChange={() => onToggle(c.providerId)}
                    className="h-4 w-4 accent-[#D4AF37]"
                    aria-label={`Select ${c.name}`}
                  />
                </td>
                {visibleCols.map((col) => (
                  <td key={col.key} className="px-3 py-2.5 text-white/80">
                    {col.render(c)}
                  </td>
                ))}
                {drafts && drafts.size > 0 && (
                  <td className="px-3 py-2.5">
                    {drafts.has(c.providerId) ? (
                      <button
                        type="button"
                        onClick={() => onCopyDraft?.(c.providerId)}
                        className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/80 hover:bg-white/20"
                      >
                        Copy message
                      </button>
                    ) : (
                      <span className="text-white/25">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleCols.length + 2} className="px-3 py-10 text-center text-white/40">
                  No results match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
