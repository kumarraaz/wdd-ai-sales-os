"use client";

export interface DiscoveryProfile {
  id: string;
  name: string;
  config: Record<string, unknown>;
  updatedAt: string;
}

export function ProfilesPanel({
  profiles,
  onRun,
  onEdit,
  onDuplicate,
  onDelete,
  running,
}: {
  profiles: DiscoveryProfile[];
  onRun: (p: DiscoveryProfile) => void;
  onEdit: (p: DiscoveryProfile) => void;
  onDuplicate: (p: DiscoveryProfile) => void;
  onDelete: (p: DiscoveryProfile) => void;
  running: boolean;
}) {
  if (profiles.length === 0) {
    return (
      <p className="text-sm text-white/40">
        No saved profiles yet. Configure a search above and click “Save as profile”.
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {profiles.map((p) => {
        const cfg = p.config as {
          industry?: string;
          location?: string;
          websiteFilter?: string;
          limit?: number;
          sources?: { providerId: string }[];
        };
        return (
          <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="font-semibold text-white">{p.name}</div>
            <p className="mt-1 text-xs text-white/50">
              {[cfg.industry, cfg.location].filter(Boolean).join(" · ")}
              {cfg.websiteFilter && cfg.websiteFilter !== "any" ? ` · ${cfg.websiteFilter.replace(/_/g, " ")}` : ""}
              {cfg.limit ? ` · ${cfg.limit} leads` : ""}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {(cfg.sources ?? []).map((s) => s.providerId).join(", ")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={running}
                onClick={() => onRun(p)}
                className="rounded-md bg-[#D4AF37] px-3 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-40"
              >
                Run
              </button>
              <button
                type="button"
                onClick={() => onEdit(p)}
                className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDuplicate(p)}
                className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => onDelete(p)}
                className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-red-300/80 hover:bg-white/20"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
