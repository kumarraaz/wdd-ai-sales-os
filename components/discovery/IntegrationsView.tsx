"use client";

import { useCallback, useEffect, useState } from "react";
import { SourceStatusDot, type CatalogSource } from "./SourceCards";

export function IntegrationsView() {
  const [catalog, setCatalog] = useState<{ zeroSpendMode: boolean; sources: CatalogSource[] } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/discovery/sources");
      if (res.ok) setCatalog(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/discovery/sources");
        if (!cancelled && res.ok) setCatalog(await res.json());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function testConnection(id: string) {
    setTesting(id);
    try {
      const res = await fetch("/api/discovery/sources/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: id }),
      });
      const data = await res.json();
      setTestResults((t) => ({ ...t, [id]: { ok: !!data.ok, message: data.message ?? "" } }));
      refresh();
    } finally {
      setTesting(null);
    }
  }

  if (!catalog) return <p className="text-sm text-white/40">Loading integrations…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-sm text-white/50">
            Discovery sources, their status, usage, and setup. Secret values are never shown — only configured / not configured.
          </p>
        </div>
        <div
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold"
          title="Paid provider usage is blocked. Only configured free-tier safety budgets are used."
        >
          <span className={`inline-block h-2 w-2 rounded-full ${catalog.zeroSpendMode ? "bg-emerald-400" : "bg-amber-400"}`} />
          <span className="text-white/80">ZERO-SPEND MODE {catalog.zeroSpendMode ? "● ON" : "● OFF"}</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {catalog.sources.map((s) => {
          const result = testResults[s.id];
          return (
            <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-bold text-white">{s.label}</div>
                  <p className="mt-1 text-sm text-white/50">{s.description}</p>
                </div>
                <SourceStatusDot availability={s.availability} />
              </div>

              {s.reason && s.availability !== "CONNECTED" && (
                <p className="mt-2 text-sm text-amber-200/80">{s.reason}</p>
              )}

              <div className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Status</span>
                  <span className="font-mono text-white/80">{s.configured ? "● Configured" : "○ Not configured"}</span>
                </div>
                {s.usage.display ? (
                  <div className="flex justify-between">
                    <span className="text-white/50">Usage</span>
                    <span className="font-mono text-white/80">
                      {s.usage.display}
                      <span className="text-white/40"> · {s.usage.resetLabel}</span>
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-white/50">Usage</span>
                    <span className="text-white/80">Unmetered (free API)</span>
                  </div>
                )}
                {s.costNote && <p className="pt-1 text-xs text-white/40">{s.costNote}</p>}
              </div>

              {!s.configured && s.setupInstructions.length > 0 && (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="mb-1 text-xs font-bold uppercase tracking-wider text-white/50">Setup</div>
                  <ol className="list-decimal space-y-1 pl-4 text-xs text-white/70">
                    {s.setupInstructions.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  disabled={testing === s.id}
                  onClick={() => testConnection(s.id)}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40"
                >
                  {testing === s.id ? "Testing…" : "Test connection"}
                </button>
                {result && (
                  <span className={`text-sm ${result.ok ? "text-emerald-300" : "text-red-300"}`}>
                    {result.ok ? "✓ " : "✗ "}{result.message}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
