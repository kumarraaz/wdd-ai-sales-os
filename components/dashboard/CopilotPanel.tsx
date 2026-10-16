import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { NextMove } from "@/lib/dashboard";

/**
 * Figma "WDD Intelligence" panel. The moves are rule-based and computed from this
 * workspace's own counts (see buildNextMoves) — the panel says so, because no
 * language model is involved and nothing here sends anything.
 */
export function CopilotPanel({ moves }: { moves: NextMove[] }) {
  return (
    <Card aria-labelledby="copilot-title" className="rise-in" style={{ "--i": 4 } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-neon-violet bg-surface-2 text-neon-violet shadow-glow-violet"
        >
          <Sparkles size={20} />
        </span>
        <div className="min-w-0">
          <h2 id="copilot-title" className="text-[17px] font-semibold leading-snug text-ink">
            WDD Intelligence
          </h2>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-neon-lime">
            Next best moves <span aria-hidden="true">•</span> from your pipeline
          </p>
        </div>
      </div>

      <h3 className="mt-5 text-xl font-semibold text-ink">Your next best moves</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        Ranked from your live pipeline data. Nothing is sent without your approval.
      </p>

      <ol className="mt-4 space-y-2">
        {moves.map((m, i) => (
          <li key={m.id}>
            <Link
              href={m.href}
              className="group flex min-h-[52px] items-center gap-3 rounded-control border border-line bg-surface-2 px-3 py-2 transition hover:border-neon-violet/60 motion-reduce:transition-none"
            >
              <span aria-hidden="true" className="tnum w-6 shrink-0 text-xs font-semibold text-neon-cyan">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-ink">{m.title}</span>
                <span className="block truncate text-[11px] text-ink-muted">{m.detail}</span>
              </span>
              <span aria-hidden="true" className="text-ink-dim transition group-hover:translate-x-0.5 group-hover:text-neon-violet motion-reduce:transition-none">
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="mt-4 h-0.5 rounded-full bg-gradient-to-r from-neon-violet/80 via-neon-violet/40 to-transparent" />
    </Card>
  );
}
