"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DiscoveredCompany } from "@/lib/discovery/types";
import { buildCandidatesCsv } from "@/lib/discovery/export";
import { SourceCards, type CatalogSource, SourceStatusDot } from "./SourceCards";
import { ResultsTable } from "./ResultsTable";
import { EMPTY_FILTERS, type ResultsFilters } from "@/lib/discovery/result-filters";
import { ProfilesPanel, type DiscoveryProfile } from "./ProfilesPanel";

interface SourceOutcome {
  providerId: string;
  label: string;
  role: string;
  status: string;
  discovered: number;
  requestsMade: number;
  creditsUsed: number;
  queriesRun: string[];
  message?: string;
}

interface RunSummary {
  requested: number;
  discovered: number;
  deduplicated: number;
  duplicatesRemoved: number;
  filteredOut: number;
  withWebsite: number;
  withoutWebsite: number;
  unknownWebsite: number;
  contactable: number;
  unreachable: number;
}

const STEP = "text-xs font-bold uppercase tracking-widest text-[#D4AF37]";
const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#D4AF37]/60 focus:outline-none";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";

const COLS_KEY = "wdd.discover.columns.v1";
const DEFAULT_COLS = [
  "company",
  "industry",
  "location",
  "phone",
  "website",
  "websiteStatus",
  "contactable",
  "source",
  "score",
  "qualification",
  "opportunity",
  "discovered",
];

function loadCols(): Set<string> {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set(DEFAULT_COLS);
}

interface Analysis {
  providerId: string;
  priority: string;
  opportunity: string;
  approach: string;
  messageDraft: string;
  nextAction: string;
}

export function DiscoveryWorkspace() {
  const [catalog, setCatalog] = useState<{ zeroSpendMode: boolean; sources: CatalogSource[] } | null>(null);
  const [profiles, setProfiles] = useState<DiscoveryProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [mode, setMode] = useState<"all" | "custom">("all");
  const [primaryId, setPrimaryId] = useState("google-places");
  const [fallbackIds, setFallbackIds] = useState<string[]>(["geoapify", "openstreetmap"]);
  const [industry, setIndustry] = useState("manufacturers");
  const [location, setLocation] = useState("Gujarat, India");
  const [websiteFilter, setWebsiteFilter] = useState("no_website");
  const [contactRequired, setContactRequired] = useState(true);
  const [opportunity, setOpportunity] = useState("new_website");
  const [recentEvidence, setRecentEvidence] = useState("any");
  const [limit, setLimit] = useState(20);

  // Run state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SourceOutcome[]>([]);
  const [currentSource, setCurrentSource] = useState<string | null>(null);
  const [output, setOutput] = useState<{
    candidates: DiscoveredCompany[];
    summary: RunSummary;
    sources: SourceOutcome[];
    status: string;
    historyId: string | null;
    error?: string;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Results state
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ResultsFilters>(EMPTY_FILTERS);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => loadCols());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const refreshCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/discovery/sources");
      if (res.ok) setCatalog(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  const refreshProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/discovery/profiles");
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([refreshCatalog(), refreshProfiles()]);
      setLoading(false);
    })();
  }, [refreshCatalog, refreshProfiles]);

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify([...visibleCols]));
    } catch {
      /* ignore */
    }
  }, [visibleCols]);

  const sourcesPayload = useMemo((): { providerId: string; role: "primary" | "fallback" }[] => {
    if (mode === "all") return [{ providerId: "all", role: "primary" }];
    const list: { providerId: string; role: "primary" | "fallback" }[] = [
      { providerId: primaryId, role: "primary" },
    ];
    for (const f of fallbackIds) {
      if (f !== primaryId) list.push({ providerId: f, role: "fallback" });
    }
    return list;
  }, [mode, primaryId, fallbackIds]);

  async function runDiscovery(profileId?: string) {
    setRunning(true);
    setProgress([]);
    setOutput(null);
    setRunError(null);
    setSelection(new Set());
    setImportResult(null);
    setAnalyses([]);
    setCurrentSource(null);

    const payload = {
      sources: sourcesPayload,
      industry,
      location,
      websiteFilter,
      contactRequired,
      opportunity,
      recentEvidence,
      limit,
      ...(profileId ? { profileId } : {}),
    };

    try {
      const res = await fetch("/api/discovery/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.reason || err.message || err.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const handleBlock = (block: string) => {
        const eventLine = block.split("\n").find((l) => l.startsWith("event:"));
        const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
        if (!eventLine || !dataLine) return;
        const event = eventLine.slice(7).trim();
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        } catch {
          return;
        }
        if (event === "source-start") {
          setCurrentSource(String(data.label ?? data.providerId));
        } else if (event === "source-done") {
          const outcome = data.outcome as SourceOutcome;
          setProgress((p) => [...p, outcome]);
          setCurrentSource(null);
        } else if (event === "complete") {
          const out = data.output as {
            candidates: DiscoveredCompany[];
            summary: RunSummary;
            sources: SourceOutcome[];
            status: string;
            error?: string;
          };
          setOutput({
            candidates: out.candidates,
            summary: out.summary,
            sources: out.sources,
            status: out.status,
            historyId: (data.historyId as string) ?? null,
            error: out.error,
          });
          setProgress(out.sources);
          refreshCatalog();
        } else if (event === "error") {
          setRunError(String(data.message ?? "Discovery run failed."));
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const b of blocks) handleBlock(b);
      }
      if (buf.trim()) handleBlock(buf);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Discovery run failed.");
    } finally {
      setRunning(false);
      setCurrentSource(null);
    }
  }

  const selectedCandidates = useMemo(
    () => (output ? output.candidates.filter((c) => selection.has(c.providerId)) : []),
    [output, selection],
  );

  async function importSelected() {
    if (selectedCandidates.length === 0 || !output) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/discovery/import-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: selectedCandidates,
          searchQuery: `${industry}, ${location}`,
          historyId: output.historyId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason || data.message || data.error || "Import failed");
      const s = data.summary;
      setImportResult(
        `Imported ${s.imported} · Already in CRM ${s.alreadyExists} · Possible duplicates ${s.possibleDuplicates} · Skipped ${s.skipped} · Failed ${s.failed}`,
      );
      // Mark imported candidates so the user sees progress.
      setOutput((o) =>
        o
          ? {
              ...o,
              candidates: o.candidates.map((c) =>
                selection.has(c.providerId) ? { ...c, inCrm: true } : c,
              ),
            }
          : o,
      );
    } catch (err) {
      setImportResult(`Import failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setImporting(false);
    }
  }

  function downloadCsv(rows: DiscoveredCompany[], filename: string) {
    const csv = buildCandidatesCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function analyzeSelected() {
    if (selectedCandidates.length === 0) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/discovery/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates: selectedCandidates.slice(0, 20) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Analysis failed");
      setAnalyses(data.analyses ?? []);
    } catch (err) {
      setAnalyses([]);
      setImportResult(`Analysis failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setAnalyzing(false);
    }
  }

  const drafts = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of analyses) m.set(a.providerId, a.messageDraft);
    return m;
  }, [analyses]);

  async function copyDraft(providerId: string) {
    const draft = drafts.get(providerId);
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(providerId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  function openInstagram(c: DiscoveredCompany) {
    // Open the real profile URL only — never guess one. Copy the AI draft
    // so the user can paste and send manually.
    const draft = drafts.get(c.providerId);
    (async () => {
      if (draft) {
        try {
          await navigator.clipboard.writeText(draft);
        } catch {
          /* ignore */
        }
      }
      if (c.instagramUrl) {
        window.open(c.instagramUrl, "_blank", "noopener,noreferrer");
        setCopied(`ig:${c.providerId}`);
        setTimeout(() => setCopied(null), 3000);
      }
    })();
  }

  async function saveProfile() {
    const name = profileName.trim();
    if (!name) return;
    setSavingProfile(true);
    try {
      const res = await fetch("/api/discovery/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          config: {
            sources: sourcesPayload.map((s) => ({ ...s, enabled: true })),
            industry,
            location,
            websiteFilter,
            contactRequired,
            opportunity,
            recentEvidence,
            limit,
          },
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || d.error || "Save failed");
      }
      setProfileName("");
      refreshProfiles();
    } finally {
      setSavingProfile(false);
    }
  }

  function loadProfileIntoForm(p: DiscoveryProfile) {
    const cfg = p.config as {
      industry?: string;
      location?: string;
      websiteFilter?: string;
      contactRequired?: boolean;
      opportunity?: string;
      recentEvidence?: string;
      limit?: number;
      sources?: { providerId: string; role: string }[];
    };
    if (cfg.industry) setIndustry(cfg.industry);
    if (cfg.location) setLocation(cfg.location);
    if (cfg.websiteFilter) setWebsiteFilter(cfg.websiteFilter);
    if (typeof cfg.contactRequired === "boolean") setContactRequired(cfg.contactRequired);
    if (cfg.opportunity) setOpportunity(cfg.opportunity);
    if (cfg.recentEvidence) setRecentEvidence(cfg.recentEvidence);
    if (cfg.limit) setLimit(cfg.limit);
    const srcs = cfg.sources ?? [];
    if (srcs.some((s) => s.providerId === "all")) {
      setMode("all");
    } else if (srcs.length > 0) {
      setMode("custom");
      const prim = srcs.find((s) => s.role === "primary");
      if (prim) setPrimaryId(prim.providerId);
      setFallbackIds(srcs.filter((s) => s.role === "fallback").map((s) => s.providerId));
    }
  }

  async function duplicateProfile(p: DiscoveryProfile) {
    const res = await fetch("/api/discovery/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${p.name} (copy)`, config: p.config }),
    });
    if (res.ok) refreshProfiles();
  }

  async function deleteProfile(p: DiscoveryProfile) {
    if (!window.confirm(`Delete profile "${p.name}"?`)) return;
    const res = await fetch(`/api/discovery/profiles/${p.id}`, { method: "DELETE" });
    if (res.ok) refreshProfiles();
  }

  const summary = output?.summary;

  return (
    <div className="space-y-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Discover</h1>
          <p className="text-sm text-white/50">Find real, contactable businesses. Every field carries its provenance.</p>
        </div>
        {catalog && (
          <div className="flex items-center gap-2">
            <a
              href="/discover/history"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
            >
              Run history
            </a>
          <div
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold"
            title="Paid provider usage is blocked. Only configured free-tier safety budgets are used."
          >
            <span className={`inline-block h-2 w-2 rounded-full ${catalog.zeroSpendMode ? "bg-emerald-400" : "bg-amber-400"}`} />
            <span className="text-white/80">ZERO-SPEND MODE {catalog.zeroSpendMode ? "● ON" : "● OFF"}</span>
          </div>
          </div>
        )}
      </div>

      {/* STEP 1 */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className={STEP}>Step 1 — Choose source</div>
        {loading ? (
          <p className="mt-3 text-sm text-white/40">Loading sources…</p>
        ) : catalog ? (
          <div className="mt-3">
            <SourceCards
              sources={catalog.sources}
              mode={mode}
              onModeChange={setMode}
              primaryId={primaryId}
              onPrimaryChange={setPrimaryId}
              fallbackIds={fallbackIds}
              onFallbackToggle={(id) =>
                setFallbackIds((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))
              }
            />
          </div>
        ) : (
          <p className="mt-3 text-sm text-red-300">Could not load source catalog.</p>
        )}
      </section>

      {/* STEP 2 */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className={STEP}>Step 2 — Define target</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="dw-industry">Industry</label>
            <input
              id="dw-industry"
              className={inputCls}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="manufacturers"
              list="dw-industries"
            />
            <datalist id="dw-industries">
              {["manufacturers", "traders", "exporters", "wholesalers", "distributors", "hotels", "restaurants", "clinics", "salons", "gyms", "schools", "real estate", "automobile services"].map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={labelCls} htmlFor="dw-location">Location</label>
            <input
              id="dw-location"
              className={inputCls}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Gujarat, India"
            />
          </div>
        </div>
      </section>

      {/* STEP 3 */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className={STEP}>Step 3 — Set filters</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="dw-website">Website</label>
            <select id="dw-website" className={inputCls} value={websiteFilter} onChange={(e) => setWebsiteFilter(e.target.value)}>
              <option value="any">Any</option>
              <option value="no_website">No website</option>
              <option value="has_website">Has website</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="dw-opportunity">Opportunity</label>
            <select id="dw-opportunity" className={inputCls} value={opportunity} onChange={(e) => setOpportunity(e.target.value)}>
              <option value="any">Any</option>
              <option value="HIGH">High opportunity</option>
              <option value="MEDIUM">Medium opportunity</option>
              <option value="LOW">Low opportunity</option>
              <option value="new_website">New website prospect</option>
              <option value="website_improvement">Website improvement</option>
              <option value="seo">SEO opportunity</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="dw-evidence">Recent evidence</label>
            <select id="dw-evidence" className={inputCls} value={recentEvidence} onChange={(e) => setRecentEvidence(e.target.value)}>
              <option value="any">Any</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="6m">Last 6 months</option>
              <option value="1y">Last 1 year</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="dw-limit">Lead count</label>
            <input
              id="dw-limit"
              type="number"
              min={1}
              max={100}
              className={inputCls}
              value={limit}
              onChange={(e) => setLimit(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex cursor-pointer items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={contactRequired}
                onClick={() => setContactRequired((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition ${contactRequired ? "bg-[#D4AF37]" : "bg-white/15"}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${contactRequired ? "left-[22px]" : "left-0.5"}`}
                />
              </button>
              <span className="text-sm font-semibold text-white/80">
                Contact required
                <span className="block text-xs font-normal text-white/40">Only keep leads with phone, email or social profile</span>
              </span>
            </label>
          </div>
        </div>
      </section>

      {/* STEP 4 */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className={STEP}>Step 4 — Run discovery</div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={running}
            onClick={() => runDiscovery()}
            className="rounded-lg bg-[#D4AF37] px-6 py-3 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40"
          >
            {running ? "SEARCHING…" : "START DISCOVERY"}
          </button>
          <div className="flex items-center gap-2">
            <input
              className="w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30"
              placeholder="Save as profile…"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
            <button
              type="button"
              disabled={savingProfile || !profileName.trim()}
              onClick={saveProfile}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40"
            >
              Save as profile
            </button>
          </div>
        </div>

        {(running || progress.length > 0) && (
          <div className="mt-4 space-y-2">
            {currentSource && (
              <p className="text-sm text-white/70">
                <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-[#D4AF37]" />
                Searching {currentSource}…
              </p>
            )}
            {progress.map((o) => (
              <div key={o.providerId} className="flex flex-wrap items-center gap-2 text-sm">
                <SourceStatusDot
                  availability={
                    o.status === "ok" ? "CONNECTED" : o.status === "blocked" ? "FREE_LIMIT_REACHED" : o.status === "not_configured" ? "NOT_CONFIGURED" : "ERROR"
                  }
                />
                <span className="font-semibold text-white/85">{o.label}</span>
                <span className="text-white/50">
                  {o.status === "ok"
                    ? `${o.discovered} discovered`
                    : o.status === "skipped"
                      ? o.message
                      : o.message}
                </span>
              </div>
            ))}
          </div>
        )}
        {runError && <p className="mt-3 text-sm text-red-300">{runError}</p>}
      </section>

      {/* STEP 5 — results */}
      {output && summary && (
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className={STEP}>Step 5 — Review real results</div>

          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {[
              ["Requested", summary.requested],
              ["Discovered", summary.discovered],
              ["Unique", summary.deduplicated],
              ["No website", summary.withoutWebsite],
              ["Has website", summary.withWebsite],
              ["Contactable", summary.contactable],
              ["Unreachable", summary.unreachable],
            ].map(([label, v]) => (
              <div key={label as string} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <span className="text-white/50">{label}: </span>
                <strong className="text-white">{v as number}</strong>
              </div>
            ))}
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <span className="text-white/50">Status: </span>
              <strong className={output.status === "COMPLETE" ? "text-emerald-300" : output.status === "PARTIAL" ? "text-amber-300" : "text-red-300"}>
                {output.status.replace(/_/g, " ")}
              </strong>
            </div>
          </div>
          {output.error && <p className="mt-2 text-sm text-amber-200/80">{output.error}</p>}
          {output.sources.length > 0 && (
            <p className="mt-2 text-xs text-white/40">
              Source mix: {output.sources.filter((s) => s.status === "ok").map((s) => `${s.label}: ${s.discovered}`).join(" · ") || "none"}
            </p>
          )}

          {output.candidates.length > 0 ? (
            <div className="mt-4 space-y-4">
              <ResultsTable
                candidates={output.candidates}
                selection={selection}
                onToggle={(id) =>
                  setSelection((s) => {
                    const n = new Set(s);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    return n;
                  })
                }
                onSelectIds={(ids) => setSelection((s) => new Set([...s, ...ids]))}
                onClearSelection={() => setSelection(new Set())}
                filters={filters}
                onFiltersChange={setFilters}
                visibleColumns={visibleCols}
                onToggleColumn={(key) =>
                  setVisibleCols((v) => {
                    const n = new Set(v);
                    if (n.has(key)) n.delete(key);
                    else n.add(key);
                    return n;
                  })
                }
                drafts={drafts}
                onCopyDraft={copyDraft}
              />

              {copied && (
                <p className="text-xs text-emerald-300">
                  {copied.startsWith("ig:") ? "Instagram profile opened. Message copied. Paste and send manually." : "Message copied to clipboard."}
                </p>
              )}

              {/* STEP 6/7 — actions */}
              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                <button
                  type="button"
                  disabled={importing || selection.size === 0}
                  onClick={importSelected}
                  className="rounded-lg bg-[#D4AF37] px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40"
                >
                  {importing ? "IMPORTING…" : `IMPORT SELECTED TO CRM (${selection.size})`}
                </button>
                <button
                  type="button"
                  disabled={analyzing || selection.size === 0}
                  onClick={analyzeSelected}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40"
                >
                  {analyzing ? "ANALYZING…" : "Analyze selected leads"}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10"
                    onClick={() => downloadCsv(selectedCandidates.length > 0 ? selectedCandidates : output.candidates, "discovery-export.csv")}
                  >
                    Export CSV {selectedCandidates.length > 0 ? `(${selectedCandidates.length} selected)` : "(all)"}
                  </button>
                </div>
              </div>
              {importResult && <p className="text-sm text-white/70">{importResult}</p>}

              {analyses.length > 0 && (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <div className="text-sm font-bold text-white">AI analysis <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/50">AI inference</span></div>
                  {analyses.map((a) => {
                    const cand = output.candidates.find((c) => c.providerId === a.providerId);
                    return (
                      <div key={a.providerId} className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">{cand?.name ?? a.providerId}</span>
                          <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${a.priority === "high" ? "bg-emerald-400/15 text-emerald-300" : a.priority === "medium" ? "bg-amber-400/15 text-amber-300" : "bg-white/10 text-white/50"}`}>
                            {a.priority} priority
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-white/70"><strong className="text-white/90">Opportunity:</strong> {a.opportunity}</p>
                        <p className="mt-1 text-sm text-white/70"><strong className="text-white/90">Approach:</strong> {a.approach}</p>
                        <p className="mt-1 text-sm text-white/70"><strong className="text-white/90">Next action:</strong> {a.nextAction}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => copyDraft(a.providerId)}
                            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20"
                          >
                            {copied === a.providerId ? "Copied ✓" : "Copy message draft"}
                          </button>
                          {cand && (
                            <button
                              type="button"
                              onClick={() => openInstagram(cand)}
                              disabled={!cand.instagramUrl && !drafts.get(a.providerId)}
                              className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20 disabled:opacity-40"
                            >
                              Instagram: open profile + copy
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-white/50">
              No candidates found. Try a different source, broaden the location, or relax the filters.
            </p>
          )}
        </section>
      )}

      {/* Saved profiles */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className={STEP}>Saved searches / discovery profiles</div>
        <div className="mt-3">
          <ProfilesPanel
            profiles={profiles}
            running={running}
            onRun={(p) => {
              loadProfileIntoForm(p);
              setTimeout(() => runDiscovery(p.id), 50);
            }}
            onEdit={(p) => loadProfileIntoForm(p)}
            onDuplicate={duplicateProfile}
            onDelete={deleteProfile}
          />
        </div>
      </section>

      {/* Sticky mobile action bar */}
      {output && output.candidates.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0D1B2A]/95 p-3 backdrop-blur lg:hidden">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={importing || selection.size === 0}
              onClick={importSelected}
              className="flex-1 rounded-lg bg-[#D4AF37] px-4 py-3 text-sm font-bold text-black disabled:opacity-40"
            >
              Import ({selection.size})
            </button>
            <button
              type="button"
              onClick={() => downloadCsv(selectedCandidates.length > 0 ? selectedCandidates : output.candidates, "discovery-export.csv")}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80"
            >
              CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
