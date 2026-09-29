"use client";

import { useEffect, useState } from "react";
import { DEMO_ACTION_DISABLED_MESSAGE } from "@/lib/demo";

interface DiscoveredCompany {
  provider: string;
  providerId: string;
  name: string;
  category?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  website?: string;
  sourceUrl?: string;
  rating?: number;
  reviewCount?: number;
  discoveredAt: string;
  provenance: "VERIFIED_DATA" | "AI_INFERENCE" | "USER_PROVIDED" | "DEMO_DATA";
}

interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  searchable: boolean;
  setupInstructions: string[];
}

interface ImportItem {
  providerId: string;
  name: string;
  status: "imported" | "skipped";
  leadId?: string;
  reason?: string;
}

interface DiscoveryProps {
  /** "/api" in production, "/api/demo" in demo mode. */
  apiBase: string;
  demo?: boolean;
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#D4AF37]";
const labelCls = "mb-1 block text-xs font-medium text-white/60";

function provenanceBadge(p: DiscoveredCompany["provenance"]) {
  const styles: Record<DiscoveredCompany["provenance"], string> = {
    VERIFIED_DATA: "bg-emerald-400/15 text-emerald-300",
    AI_INFERENCE: "bg-purple-400/15 text-purple-300",
    USER_PROVIDED: "bg-sky-400/15 text-sky-300",
    DEMO_DATA: "bg-[#D4AF37]/15 text-[#D4AF37]",
  };
  const labels: Record<DiscoveredCompany["provenance"], string> = {
    VERIFIED_DATA: "Verified data",
    AI_INFERENCE: "AI inference",
    USER_PROVIDED: "User provided",
    DEMO_DATA: "Demo data",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${styles[p]}`}
      title={`Data provenance: ${labels[p]}`}
    >
      {labels[p]}
    </span>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function Discovery({ apiBase, demo = false }: DiscoveryProps) {
  // In demo mode the provider list is static — no fetch, no effect needed.
  const [providers, setProviders] = useState<ProviderInfo[]>(() =>
    demo
      ? [
          {
            id: "google-places",
            label: "Google Places",
            configured: true,
            searchable: true,
            setupInstructions: [],
          },
        ]
      : [],
  );
  const [providersLoading, setProvidersLoading] = useState(!demo);
  const [providersTick, setProvidersTick] = useState(0);

  const [keyword, setKeyword] = useState("");
  const [country, setCountry] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [radiusMeters, setRadiusMeters] = useState("");
  const [maxResults, setMaxResults] = useState("20");
  const [category, setCategory] = useState("");

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveredCompany[]>([]);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [quota, setQuota] = useState<{
    searches: { used: number; limit: number };
    records: { used: number; limit: number };
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    imported: ImportItem[];
    skipped: ImportItem[];
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const googleProvider = providers.find((p) => p.id === "google-places");
  const googleReady = demo || (googleProvider?.configured && googleProvider?.searchable);

  // Provider list is fetched asynchronously (never setState synchronously in
  // the effect body). providersTick re-runs it after a 409 refresh.
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
  }, [apiBase, demo, providersTick]);

  function blockDemo() {
    setNotice(`${DEMO_ACTION_DISABLED_MESSAGE} — importing is not available in demo mode.`);
  }

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    setImportSummary(null);
    if (!keyword.trim()) {
      setError("Enter a search keyword.");
      return;
    }
    setSearching(true);
    try {
      const payload: Record<string, unknown> = {
        providerId: "google-places",
        keyword: keyword.trim(),
        maxResults: Math.min(20, Math.max(1, parseInt(maxResults, 10) || 20)),
      };
      if (country.trim()) payload.country = country.trim();
      if (state.trim()) payload.state = state.trim();
      if (city.trim()) payload.city = city.trim();
      if (radiusMeters.trim()) payload.radiusMeters = parseInt(radiusMeters, 10);
      if (category.trim()) payload.category = category.trim();
      const res = await fetch(`${apiBase}/discovery/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "PROVIDER_NOT_CONFIGURED") {
          setProvidersTick((t) => t + 1); // refresh so the setup panel appears
          throw new Error("Google Places is not connected.");
        }
        throw new Error(
          data.reason || data.message || data.error || "Search failed.",
        );
      }
      setResults(data.companies ?? []);
      setSearchedAt(data.searchedAt ?? null);
      setQuota(data.quota ?? null);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === results.length ? new Set() : new Set(results.map((r) => r.providerId)),
    );
  }

  async function importSelected() {
    if (demo) {
      blockDemo();
      return;
    }
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const companies = results.filter((r) => selected.has(r.providerId));
      const res = await fetch(`${apiBase}/discovery/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "google-places",
          searchQuery: keyword.trim(),
          companies,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.reason || data.error || "Import failed.");
      }
      setImportSummary({
        imported: data.imported ?? [],
        skipped: data.skipped ?? [],
      });
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-4 py-3 text-sm text-[#D4AF37]">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-[#D4AF37]/70 hover:text-[#D4AF37]"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-300/70 hover:text-red-300"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search panel */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-lg font-semibold">Find companies</h2>
        <p className="mt-1 text-sm text-white/50">
          {demo
            ? "Demo mode — searching fictional sample companies. No external APIs are called."
            : "Search Google Places for real businesses. Only publicly listed data is returned."}
        </p>

        {providersLoading ? (
          <p className="mt-4 text-sm text-white/40">Loading providers…</p>
        ) : !googleReady && googleProvider ? (
          <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4">
            <p className="font-semibold text-amber-300">Google Places not connected</p>
            <p className="mt-1 text-sm text-white/60">
              Discovery search needs a Google Places API key. It stays on your
              server — never in the browser.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-white/70">
              {googleProvider.setupInstructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        ) : (
          <form onSubmit={runSearch} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label htmlFor="dq-keyword" className={labelCls}>
                Search keyword *
              </label>
              <input
                id="dq-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="manufacturers, exporters, gyms…"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="dq-category" className={labelCls}>
                Category / business type
              </label>
              <input
                id="dq-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="manufacturer"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="dq-country" className={labelCls}>
                Country
              </label>
              <input
                id="dq-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="India"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="dq-state" className={labelCls}>
                State / Region
              </label>
              <input
                id="dq-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="Gujarat"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="dq-city" className={labelCls}>
                City
              </label>
              <input
                id="dq-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ahmedabad"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="dq-radius" className={labelCls}>
                Radius (meters, optional)
              </label>
              <input
                id="dq-radius"
                type="number"
                min={100}
                max={50000}
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(e.target.value)}
                placeholder="10000"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="dq-max" className={labelCls}>
                Maximum results
              </label>
              <input
                id="dq-max"
                type="number"
                min={1}
                max={20}
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={searching}
                className="w-full rounded-lg bg-[#D4AF37] py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
          </form>
        )}

        {quota && !demo && (
          <p className="mt-3 text-xs text-white/40">
            Quota today: {quota.searches.used}/{quota.searches.limit} searches ·{" "}
            {quota.records.used}/{quota.records.limit} records
          </p>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Results{" "}
                <span className="text-sm font-normal text-white/40">
                  ({results.length}
                  {searchedAt ? ` · ${fmtDate(searchedAt)}` : ""})
                </span>
              </h2>
              <p className="mt-1 text-xs text-white/40">
                Fields shown as — were not provided by the source and are never
                invented.
              </p>
            </div>
            <button
              onClick={importSelected}
              disabled={importing || selected.size === 0}
              className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {importing
                ? "Importing…"
                : `Import selected (${selected.size})`}
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-white/40">
                  <th className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={results.length > 0 && selected.size === results.length}
                      onChange={toggleSelectAll}
                      aria-label="Select all visible results"
                    />
                  </th>
                  <th className="py-2 pr-3">Company</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Location</th>
                  <th className="py-2 pr-3">Phone</th>
                  <th className="py-2 pr-3">Website</th>
                  <th className="py-2 pr-3">Rating</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Provenance</th>
                </tr>
              </thead>
              <tbody>
                {results.map((c) => (
                  <tr
                    key={c.providerId}
                    className="border-b border-white/5 hover:bg-white/[0.02]"
                  >
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.providerId)}
                        onChange={() => toggleSelect(c.providerId)}
                        aria-label={`Select ${c.name}`}
                      />
                    </td>
                    <td className="py-2 pr-3 font-medium">{c.name}</td>
                    <td className="py-2 pr-3 text-white/70">{c.category ?? "—"}</td>
                    <td className="py-2 pr-3 text-white/70">
                      {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-3 text-white/70">{c.phone ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {c.website ? (
                        <a
                          href={c.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all text-sky-300 hover:underline"
                        >
                          {c.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                        </a>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-white/70">
                      {typeof c.rating === "number"
                        ? `${c.rating.toFixed(1)}${typeof c.reviewCount === "number" ? ` (${c.reviewCount})` : ""}`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {c.sourceUrl ? (
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-300 hover:underline"
                          title={`${c.sourceUrl} · Place ID: ${c.providerId}`}
                        >
                          Maps link
                        </a>
                      ) : (
                        <span className="text-white/40" title={`Place ID: ${c.providerId}`}>
                          {c.providerId}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{provenanceBadge(c.provenance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import summary */}
      {importSummary && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Import summary</h2>
          <p className="mt-1 text-sm text-white/60">
            Imported {importSummary.imported.length} · skipped{" "}
            {importSummary.skipped.length}
          </p>
          {importSummary.skipped.length > 0 && (
            <ul className="mt-3 space-y-2">
              {importSummary.skipped.map((s) => (
                <li
                  key={s.providerId}
                  className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-white/50"> — {s.reason ?? "skipped"}</span>
                </li>
              ))}
            </ul>
          )}
          {importSummary.imported.length > 0 && (
            <p className="mt-3 text-sm text-emerald-300">
              {importSummary.imported.length} new lead
              {importSummary.imported.length === 1 ? "" : "s"} added to your
              database with source URL and provenance preserved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
