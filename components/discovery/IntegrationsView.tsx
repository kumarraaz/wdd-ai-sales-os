"use client";

import { useCallback, useEffect, useState } from "react";
import { SourceStatusDot, type CatalogSource } from "./SourceCards";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";

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

  if (!catalog) return <p className="text-sm text-ink-dim">Loading integrations…</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Discovery sources, their status, usage, and setup. Secret values are never shown — only configured / not configured."
        actions={
          <span title="Paid provider usage is blocked. Only configured free-tier safety budgets are used.">
            <Badge tone={catalog.zeroSpendMode ? "lime" : "amber"} dot>
              Zero-spend mode {catalog.zeroSpendMode ? "on" : "off"}
            </Badge>
          </span>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {catalog.sources.map((s) => {
          const result = testResults[s.id];
          return (
            <div key={s.id} className="rounded-2xl border border-line bg-tint/[0.03] p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold text-ink">{s.label}</div>
                  <p className="mt-1 text-sm text-ink-muted">{s.description}</p>
                </div>
                <SourceStatusDot availability={s.availability} />
              </div>

              {s.reason && s.availability !== "CONNECTED" && (
                <p className="mt-2 text-sm text-amber-200/80">{s.reason}</p>
              )}

              <div className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-muted">Status</span>
                  <span className="font-mono text-ink">{s.configured ? "● Configured" : "○ Not configured"}</span>
                </div>
                {s.usage.display ? (
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Usage</span>
                    <span className="font-mono text-ink">
                      {s.usage.display}
                      <span className="text-ink-dim"> · {s.usage.resetLabel}</span>
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Usage</span>
                    <span className="text-ink">Unmetered (free API)</span>
                  </div>
                )}
                {s.costNote && <p className="pt-1 text-xs text-ink-dim">{s.costNote}</p>}
              </div>

              {!s.configured && s.setupInstructions.length > 0 && (
                <div className="mt-4 rounded-lg border border-line bg-tint/5 p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">Setup</div>
                  <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-muted">
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
                  className="rounded-lg border border-line bg-tint/5 px-4 py-2 text-sm font-semibold text-ink hover:bg-tint/10 disabled:opacity-40"
                >
                  {testing === s.id ? "Testing…" : "Test connection"}
                </button>
                {result && (
                  <span className={`text-sm ${result.ok ? "text-neon-lime" : "text-red-300"}`}>
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
