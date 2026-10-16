"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

interface HistoryRun {
  id: string;
  label: string;
  profile: { id: string; name: string } | null;
  providerIds: string[];
  params: Record<string, unknown>;
  requested: number;
  discovered: number;
  deduplicated: number;
  withWebsite: number;
  withoutWebsite: number;
  contactable: number;
  unreachable: number;
  imported: number;
  duplicate: number;
  perSource: {
    providerId: string;
    label: string;
    role: string;
    status: string;
    discovered: number;
    requestsMade: number;
    creditsUsed: number;
    queriesRun: string[];
    message: string | null;
  }[];
  durationMs: number | null;
  status: string;
  error: string | null;
  createdAt: string;
}

const STATUS_CLS: Record<string, string> = {
  COMPLETE: "bg-neon-lime/15 text-neon-lime",
  PARTIAL: "bg-amber-400/15 text-amber-300",
  FAILED: "bg-red-400/15 text-red-300",
  LIMIT_REACHED: "bg-red-400/15 text-red-300",
};

export function RunHistoryView() {
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/discovery/history?take=50");
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/discovery/history?take=50");
        if (!cancelled && res.ok) {
          const data = await res.json();
          setRuns(data.runs ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runAgain(run: HistoryRun) {
    // Re-run with the stored params (fresh results, new history row).
    setRerunning(run.id);
    try {
      const params = run.params as {
        sources?: { providerId: string; role: "primary" | "fallback" }[];
        industry?: string;
        location?: string;
        websiteFilter?: "any" | "no_website" | "has_website";
        contactRequired?: boolean;
        opportunity?: "any" | "new_website" | "website_improvement" | "seo";
        recentEvidence?: "any" | "30d" | "90d" | "6m" | "1y";
        limit?: number;
      };
      const res = await fetch("/api/discovery/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: params.sources ?? [{ providerId: "all", role: "primary" }],
          industry: params.industry ?? "",
          location: params.location ?? "",
          websiteFilter: params.websiteFilter ?? "any",
          contactRequired: params.contactRequired ?? true,
          opportunity: params.opportunity ?? "any",
          recentEvidence: params.recentEvidence ?? "any",
          limit: params.limit ?? 20,
          profileId: run.profile?.id,
        }),
      });
      // Drain the SSE stream to completion.
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
      refresh();
    } finally {
      setRerunning(null);
    }
  }

  if (loading) return <p className="text-sm text-ink-dim">Loading run history…</p>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Discovery history"
        description="Every discovery run, with truthful counts."
        actions={<ButtonLink href="/discover">New discovery</ButtonLink>}
      />

      {runs.length === 0 ? (
        <p className="text-sm text-ink-dim">No discovery runs yet. Run your first discovery to see it here.</p>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="rounded-2xl border border-line bg-tint/[0.03] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink">{run.label}</div>
                  <div className="mt-0.5 text-xs text-ink-dim">
                    {new Date(run.createdAt).toLocaleString("en-IN")} · {run.profile?.name ?? "Ad-hoc run"} ·
                    {" "}{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}
                  </div>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-semibold uppercase ${STATUS_CLS[run.status] ?? "bg-tint/10 text-ink-muted"}`}>
                  {run.status.replace(/_/g, " ")}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {[
                  ["Requested", run.requested],
                  ["Discovered", run.discovered],
                  ["Contactable", run.contactable],
                  ["Imported", run.imported],
                ].map(([label, v]) => (
                  <span key={label as string} className="rounded-md border border-line bg-tint/5 px-2.5 py-1.5">
                    <span className="text-ink-muted">{label}: </span>
                    <strong className="text-ink">{v as number}</strong>
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => (e === run.id ? null : run.id))}
                  className="rounded-md bg-tint/10 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint/20"
                >
                  {expanded === run.id ? "Hide details" : "View results"}
                </button>
                <button
                  type="button"
                  disabled={rerunning === run.id}
                  onClick={() => runAgain(run)}
                  className="rounded-md bg-tint/10 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint/20 disabled:opacity-40"
                >
                  {rerunning === run.id ? "Running…" : "Run again"}
                </button>
                <Link
                  href="/discover"
                  className="rounded-md bg-tint/10 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-tint/20"
                >
                  Duplicate search
                </Link>
              </div>

              {expanded === run.id && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  {run.perSource.map((s, i) => (
                    <div key={i} className="text-xs text-ink-muted">
                      <span className="font-semibold text-ink">{s.label}</span>
                      {" "}({s.role}) — <span className="uppercase">{s.status.replace(/_/g, " ")}</span>
                      {s.status === "ok" && ` · ${s.discovered} discovered · ${s.requestsMade} req / ${s.creditsUsed} credits`}
                      {s.message && s.status !== "ok" && ` · ${s.message}`}
                      {s.queriesRun.length > 0 && (
                        <div className="mt-0.5 text-ink-dim">Queries: {s.queriesRun.join(" · ")}</div>
                      )}
                    </div>
                  ))}
                  {run.error && <p className="text-xs text-red-300">{run.error}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
