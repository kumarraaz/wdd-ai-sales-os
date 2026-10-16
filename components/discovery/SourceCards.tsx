"use client";

import Link from "next/link";

export interface CatalogSource {
  id: string;
  label: string;
  kind: string;
  description: string;
  searchable: boolean;
  availability: "CONNECTED" | "NOT_CONFIGURED" | "FREE_LIMIT_REACHED" | "LIMITED" | "ERROR";
  configured: boolean;
  reason?: string;
  usage: {
    display: string | null;
    resetLabel: string;
  };
  setupInstructions: string[];
  costNote?: string;
}

const DOT: Record<CatalogSource["availability"], string> = {
  CONNECTED: "bg-neon-lime",
  NOT_CONFIGURED: "bg-tint/25",
  FREE_LIMIT_REACHED: "bg-red-400",
  LIMITED: "bg-amber-400",
  ERROR: "bg-red-400",
};

const AVAIL_LABEL: Record<CatalogSource["availability"], string> = {
  CONNECTED: "Connected",
  NOT_CONFIGURED: "Not configured",
  FREE_LIMIT_REACHED: "Free limit reached",
  LIMITED: "Limited",
  ERROR: "Error",
};

export function SourceStatusDot({ availability }: { availability: CatalogSource["availability"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span className={`inline-block h-2 w-2 rounded-full ${DOT[availability]}`} />
      {AVAIL_LABEL[availability]}
    </span>
  );
}

export function SourceCards({
  sources,
  mode,
  onModeChange,
  primaryId,
  onPrimaryChange,
  fallbackIds,
  onFallbackToggle,
}: {
  sources: CatalogSource[];
  mode: "all" | "custom";
  onModeChange: (m: "all" | "custom") => void;
  primaryId: string;
  onPrimaryChange: (id: string) => void;
  fallbackIds: string[];
  onFallbackToggle: (id: string) => void;
}) {
  const searchable = sources.filter((s) => s.searchable);
  const others = sources.filter((s) => !s.searchable);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onModeChange("all")}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
            mode === "all"
              ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
              : "border-line bg-tint/5 text-ink-muted hover:bg-tint/10"
          }`}
        >
          All enabled sources
        </button>
        <button
          type="button"
          onClick={() => onModeChange("custom")}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
            mode === "custom"
              ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
              : "border-line bg-tint/5 text-ink-muted hover:bg-tint/10"
          }`}
        >
          Choose primary + fallbacks
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {searchable.map((s) => {
          const isPrimary = mode === "custom" && primaryId === s.id;
          const isFallback = mode === "custom" && fallbackIds.includes(s.id);
          const blocked = s.availability === "FREE_LIMIT_REACHED";
          return (
            <div
              key={s.id}
              className={`rounded-xl border p-4 ${
                isPrimary
                  ? "border-neon-cyan bg-neon-cyan/10"
                  : isFallback
                    ? "border-line-strong bg-tint/5"
                    : "border-line bg-tint/5"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-ink">{s.label}</div>
                <SourceStatusDot availability={s.availability} />
              </div>
              <p className="mt-1 text-xs text-ink-muted">{s.description}</p>
              {s.usage.display && (
                <p className="mt-2 text-xs text-ink-muted">
                  Usage: <span className="font-mono">{s.usage.display}</span>
                  <span className="text-ink-dim"> · {s.usage.resetLabel}</span>
                </p>
              )}
              {s.reason && s.availability !== "CONNECTED" && (
                <p className="mt-1 text-xs text-amber-200/80">{s.reason}</p>
              )}
              {mode === "custom" && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => onPrimaryChange(s.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                      isPrimary
                        ? "bg-neon-cyan text-[#021614]"
                        : "bg-tint/10 text-ink-muted hover:bg-tint/20 disabled:opacity-40"
                    }`}
                  >
                    {isPrimary ? "★ Primary" : "Set primary"}
                  </button>
                  {s.id !== primaryId && (
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => onFallbackToggle(s.id)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        isFallback
                          ? "bg-tint/25 text-ink"
                          : "bg-tint/10 text-ink-muted hover:bg-tint/20 disabled:opacity-40"
                      }`}
                    >
                      {isFallback ? "✓ Fallback" : "Add fallback"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {others.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">
            Reference / manual sources (not searchable)
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((s) => (
              <div key={s.id} className="rounded-xl border border-line bg-tint/[0.04] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink">{s.label}</div>
                  <SourceStatusDot availability={s.availability} />
                </div>
                <p className="mt-1 text-xs text-ink-muted">{s.description}</p>
                {s.reason && (
                  <p className="mt-1 text-xs text-amber-200/70">{s.reason}</p>
                )}
                {s.id === "csv-import" && (
                  <Link
                    href="/leads"
                    className="mt-2 inline-block text-xs font-semibold text-neon-cyan hover:underline"
                  >
                    Go to Leads (CSV import lives there) →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
