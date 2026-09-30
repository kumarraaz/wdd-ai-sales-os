"use client";

import { useEffect, useRef, useState } from "react";
import type { PipelineCompanyResult, PipelineStage } from "@/lib/discovery/pipeline";

interface DiscoveryPipelineProps {
  apiBase: string;
  demo?: boolean;
}

interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  searchable: boolean;
  setupInstructions: string[];
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  searching: "Searching businesses",
  deduping: "Checking for duplicates",
  researching: "Researching websites",
  analyzing: "Analyzing opportunities",
  qualifying: "Qualifying leads",
};

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null)
    return <span className="text-white/30">—</span>;
  const color =
    score >= 70
      ? "bg-emerald-400/15 text-emerald-300"
      : score >= 40
        ? "bg-[#D4AF37]/15 text-[#D4AF37]"
        : "bg-white/5 text-white/40";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-bold ${color}`}>{score}</span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-emerald-400"
      : status === "failed"
        ? "bg-red-400"
        : status === "pending"
          ? "bg-[#D4AF37]"
          : "bg-white/20";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function DiscoveryPipeline({ apiBase, demo = false }: DiscoveryPipelineProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>(() =>
    demo
      ? [{ id: "openstreetmap", label: "OpenStreetMap (Overpass)", configured: true, searchable: true, setupInstructions: [] }]
      : [],
  );
  const [providersLoading, setProvidersLoading] = useState(!demo);

  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [websiteFilter, setWebsiteFilter] = useState("has_website");
  const [opportunity, setOpportunity] = useState("website_improvement");
  const [limit, setLimit] = useState("10");

  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [stageMessage, setStageMessage] = useState("");
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [results, setResults] = useState<PipelineCompanyResult[]>([]);
  const [summary, setSummary] = useState<{
    searched: number; researched: number; analyzed: number;
    qualified: number; duplicates: number; failed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState<string[] | null>(null);
  const [researchView, setResearchView] = useState<PipelineCompanyResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const osmProvider = providers.find((p) => p.id === "openstreetmap");
  const providerReady = demo || (osmProvider?.configured && osmProvider?.searchable);

  useEffect(() => {
    if (demo) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/discovery/providers`);
        if (!res.ok) throw new Error("Could not load providers.");
        const data = await res.json();
        setProviders(data.providers ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load providers.");
      } finally {
        setProvidersLoading(false);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [apiBase, demo]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function startPipeline(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotConfigured(null);
    setImportDone(null);
    if (!industry.trim() || !location.trim()) {
      setError("Enter an industry and a location.");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResults([]);
    setSummary(null);
    setStage(null);
    setProgress(null);

    try {
      const endpoint = demo ? `${apiBase}/discovery/pipeline` : `${apiBase}/discovery/pipeline`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "openstreetmap",
          industry: industry.trim(),
          location: location.trim(),
          websiteFilter,
          opportunity,
          limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 10)),
        }),
        signal: controller.signal,
      });

      // Non-streaming error (validation, quota, provider not configured).
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok && !contentType.includes("text/event-stream")) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "PROVIDER_NOT_CONFIGURED") {
          setNotConfigured(data.setupInstructions ?? []);
          return;
        }
        throw new Error(data.reason || data.message || data.error || "Discovery failed.");
      }
      if (!res.body) throw new Error("Streaming not supported.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleEvent = (type: string, data: string) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(data);
        } catch {
          return;
        }
        if (type === "stage") {
          setStage(payload.stage as PipelineStage);
          setStageMessage(String(payload.message ?? ""));
          setProgress(null);
        } else if (type === "progress") {
          setProgress({
            completed: Number(payload.completed ?? 0),
            total: Number(payload.total ?? 0),
          });
        } else if (type === "company") {
          setResults((prev) => [...prev, payload.result as PipelineCompanyResult]);
        } else if (type === "complete") {
          setSummary(payload.summary as typeof summary);
          setStage(null);
        } else if (type === "error") {
          throw new Error(String(payload.message ?? "Discovery failed."));
        }
      };

      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const lines = part.split("\n");
          let type = "";
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (type) handleEvent(type, dataLines.join("\n"));
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Discovery failed.");
    } finally {
      setRunning(false);
      setStage(null);
    }
  }

  async function addToCrm() {
    const qualified = results.filter((r) => r.qualified && !r.duplicate);
    if (qualified.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const research: Record<string, Record<string, unknown>> = {};
      for (const r of qualified) {
        const entry: Record<string, unknown> = {};
        if (r.website.status === "completed" && r.website.findings) {
          entry.websiteFindings = r.website.findings as unknown as Record<string, unknown>;
        }
        if (r.ai.status === "completed" && r.ai.output) {
          entry.aiOutput = r.ai.output as unknown as Record<string, unknown>;
          entry.aiWarnings = r.ai.warnings ?? [];
        }
        if (Object.keys(entry).length > 0) research[r.company.providerId] = entry;
      }
      const res = await fetch(`${apiBase}/discovery/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "openstreetmap",
          searchQuery: `${industry.trim()}, ${location.trim()}`,
          companies: qualified.map((r) => r.company),
          research,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.reason || data.message || data.error || "Import failed.");
      const n = data.counts?.imported ?? 0;
      setImportDone(`${n} lead${n === 1 ? "" : "s"} added to CRM.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-[#D4AF37]";
  const labelCls = "text-sm text-white/70";

  return (
    <div className="space-y-6">
      {/* ── Criteria form ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-bold text-white">AI Lead Discovery</h2>
        <p className="mt-1 text-sm text-white/50">
          Discover real businesses, research their public websites, and qualify
          them for your CRM.
          {demo && (
            <span className="ml-2 rounded bg-[#D4AF37]/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              DEMO_DATA
            </span>
          )}
        </p>
        <form onSubmit={startPipeline} className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="dp-industry">Industry</label>
            <input id="dp-industry" className={inputCls} placeholder="Manufacturers"
              value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={running} />
          </div>
          <div>
            <label className={labelCls} htmlFor="dp-location">Location</label>
            <input id="dp-location" className={inputCls} placeholder="Gujarat, India"
              value={location} onChange={(e) => setLocation(e.target.value)} disabled={running} />
          </div>
          <div>
            <label className={labelCls} htmlFor="dp-website">Website</label>
            <select id="dp-website" className={inputCls} value={websiteFilter}
              onChange={(e) => setWebsiteFilter(e.target.value)} disabled={running}>
              <option value="any">Any</option>
              <option value="has_website">Has website</option>
              <option value="no_website">No website</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="dp-opportunity">Opportunity</label>
            <select id="dp-opportunity" className={inputCls} value={opportunity}
              onChange={(e) => setOpportunity(e.target.value)} disabled={running}>
              <option value="website_improvement">Website improvement</option>
              <option value="new_website">New website</option>
              <option value="seo">SEO</option>
              <option value="any">Any</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="dp-limit">Number of leads</label>
            <input id="dp-limit" type="number" min={1} max={50} className={inputCls}
              value={limit} onChange={(e) => setLimit(e.target.value)} disabled={running} />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={running || providersLoading}
              className="w-full rounded-lg bg-[#D4AF37] py-2.5 font-semibold text-black transition hover:brightness-110 disabled:opacity-50">
              {running ? "Discovering…" : "Start Lead Discovery"}
            </button>
          </div>
        </form>
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        {importDone && <p className="mt-3 text-sm text-emerald-300">{importDone}</p>}
      </div>

      {/* ── Discovery source info ─────────────────────────────────── */}
      {!demo && !providersLoading && providerReady && !running && (
        <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/5 p-6">
          <h3 className="font-bold text-white">Free Lead Discovery is ready</h3>
          <p className="mt-1 text-sm text-white/60">
            Powered by OpenStreetMap public business data. No API key required.
          </p>
          <p className="mt-2 text-xs text-white/40">
            OpenStreetMap is community-maintained and does not list every
            business. Phone and website details appear only when the public
            listing includes them — missing data is common.
          </p>
          <p className="mt-2 text-xs text-white/30">© OpenStreetMap contributors</p>
        </div>
      )}

      {/* ── Provider unavailable (edge case) ────────────────────────── */}
      {!demo && !providersLoading && !providerReady && !running && (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6">
          <h3 className="font-bold text-white">Lead discovery is unavailable</h3>
          <p className="mt-1 text-sm text-white/60">
            The discovery provider could not be reached. Please try again later.
          </p>
          {notConfigured && notConfigured.length > 0 && (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-white/70">
              {notConfigured.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
        </div>
      )}

      {/* ── Progress ──────────────────────────────────────────────── */}
      {(running || stage) && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 animate-pulse rounded-full bg-[#D4AF37]" />
            <p className="font-semibold text-white">
              {stage ? STAGE_LABELS[stage] : "Starting"}…
            </p>
          </div>
          {stageMessage && <p className="mt-1 text-sm text-white/50">{stageMessage}</p>}
          {progress && progress.total > 0 && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[#D4AF37] transition-all"
                  style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-white/40">
                {progress.completed}/{progress.total} completed
              </p>
            </div>
          )}
          {results.length > 0 && (
            <p className="mt-2 text-xs text-white/40">{results.length} companies processed so far</p>
          )}
        </div>
      )}

      {/* ── Summary ───────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {[
            ["Searched", summary.searched],
            ["Researched", summary.researched],
            ["Analyzed", summary.analyzed],
            ["Qualified", summary.qualified],
            ["Duplicates", summary.duplicates],
            ["Failed", summary.failed],
          ].map(([label, n]) => (
            <div key={String(label)} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
              <p className="text-xl font-bold text-white">{n}</p>
              <p className="text-xs text-white/50">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-white">Results</h3>
            {!demo && (
              <button onClick={addToCrm} disabled={importing || results.filter((r) => r.qualified && !r.duplicate).length === 0}
                className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50">
                {importing ? "Adding…" : `Add qualified to CRM (${results.filter((r) => r.qualified && !r.duplicate).length})`}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-white/40">
                  <th className="pb-2 pr-4">Company</th>
                  <th className="pb-2 pr-4">Location</th>
                  <th className="pb-2 pr-4">Website</th>
                  <th className="pb-2 pr-4">Site</th>
                  <th className="pb-2 pr-4">AI</th>
                  <th className="pb-2 pr-4">Score</th>
                  <th className="pb-2 pr-4">Source</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.company.providerId} className="border-b border-white/5">
                    <td className="py-2 pr-4">
                      <p className="font-semibold text-white">{r.company.name}</p>
                      {r.duplicate && (
                        <p className="text-xs text-[#D4AF37]">Duplicate — {r.duplicate.reason}</p>
                      )}
                      {!r.duplicate && !r.qualified && (
                        <p className="text-xs text-white/40">{r.qualificationReasons.join("; ")}</p>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-white/60">
                      {[r.company.city, r.company.state, r.company.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-4 text-white/60">
                      {r.company.website ? (
                        <a href={r.company.website} target="_blank" rel="noreferrer" className="text-[#D4AF37] hover:underline">
                          {new URL(r.company.website).hostname}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-4"><StatusDot status={r.website.status} /></td>
                    <td className="py-2 pr-4"><StatusDot status={r.ai.status} /></td>
                    <td className="py-2 pr-4"><ScoreBadge score={r.score?.score ?? null} /></td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.company.provenance === "DEMO_DATA" ? "bg-[#D4AF37]/15 text-[#D4AF37]" : "bg-emerald-400/15 text-emerald-300"}`}>
                        {r.company.provenance === "DEMO_DATA" ? "demo" : "verified"}
                      </span>
                    </td>
                    <td className="py-2">
                      <button onClick={() => setResearchView(r)}
                        className="text-xs text-[#D4AF37] hover:underline">
                        View research
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Research modal ────────────────────────────────────────── */}
      {researchView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setResearchView(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0D1B2A] p-6"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-bold text-white">{researchView.company.name}</h3>
              <button onClick={() => setResearchView(null)} className="text-white/40 hover:text-white">✕</button>
            </div>

            <h4 className="text-sm font-bold uppercase tracking-wider text-[#D4AF37]">Qualification</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-white/70">
              {researchView.qualificationReasons.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
            {researchView.score && (
              <div className="mt-3">
                <h4 className="text-sm font-bold uppercase tracking-wider text-[#D4AF37]">Score factors</h4>
                <ul className="mt-1 space-y-1 text-sm text-white/70">
                  {researchView.score.factors.map((f, i) => (
                    <li key={i}>• {f.factor}: {f.points}/{f.maximumPoints} — {f.explanation}</li>
                  ))}
                </ul>
              </div>
            )}

            <h4 className="mt-4 text-sm font-bold uppercase tracking-wider text-[#D4AF37]">Website research</h4>
            {researchView.website.status === "completed" && researchView.website.findings ? (
              <dl className="mt-1 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-white/40">Title</dt><dd className="text-white/80">{researchView.website.findings.title ?? "Not found"}</dd></div>
                <div><dt className="text-white/40">HTTPS</dt><dd className="text-white/80">{researchView.website.findings.https ? "Yes" : "No"}</dd></div>
                <div><dt className="text-white/40">Meta description</dt><dd className="text-white/80">{researchView.website.findings.metaDescription ? "Present" : "Missing"}</dd></div>
                <div><dt className="text-white/40">H1</dt><dd className="text-white/80">{researchView.website.findings.h1.count} found</dd></div>
                <div><dt className="text-white/40">Viewport</dt><dd className="text-white/80">{researchView.website.findings.viewportMeta ? "Present" : "Missing"}</dd></div>
                <div><dt className="text-white/40">Load time</dt><dd className="text-white/80">{researchView.website.findings.responseTimeMs}ms</dd></div>
              </dl>
            ) : (
              <p className="mt-1 text-sm text-white/50">
                {researchView.website.status === "failed"
                  ? `Research failed: ${researchView.website.error ?? "unknown error"}`
                  : "No website research (no public website or skipped)."}
              </p>
            )}

            <h4 className="mt-4 text-sm font-bold uppercase tracking-wider text-[#D4AF37]">AI research</h4>
            {researchView.ai.status === "completed" && researchView.ai.output ? (
              <div className="mt-1 text-sm text-white/70">
                <p>{String((researchView.ai.output as Record<string, unknown>).summary ?? JSON.stringify(researchView.ai.output).slice(0, 500))}</p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-white/50">
                {researchView.ai.status === "pending"
                  ? "AI research pending — AI is not configured."
                  : researchView.ai.status === "failed"
                    ? `AI research failed: ${researchView.ai.error ?? "unknown error"}`
                    : "AI research skipped."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
