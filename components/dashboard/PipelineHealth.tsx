import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { TONE } from "@/components/ui/tone";
import { cn } from "@/lib/cn";
import type { PipelineRow } from "@/lib/dashboard";

/**
 * Figma "Pipeline health": one neon bar per stage plus the lead→qualified
 * conversion box. Counts are real; each row drills into the matching lead list.
 */
export function PipelineHealth({
  rows,
  conversion,
  demo = false,
}: {
  rows: PipelineRow[];
  /** lead → qualified-or-later, one-decimal percent; null when there are no leads */
  conversion: number | null;
  demo?: boolean;
}) {
  return (
    <Card aria-labelledby="pipeline-title" className="rise-in" style={{ "--i": 5 } as React.CSSProperties}>
      <CardHeader id="pipeline-title" title="Pipeline health" description="Where every opportunity stands" />
      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_160px]">
        <ul className="space-y-3">
          {rows.map((r) => {
            const inner = (
              <>
                <span className="w-[88px] shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted sm:w-[104px]">
                  {r.label}
                </span>
                <ProgressBar value={r.pct} max={100} tone={r.tone} label={`${r.label}: ${r.count} leads`} className="flex-1" />
                <span className="tnum w-12 shrink-0 text-right text-[13px] font-semibold text-ink">
                  {r.count.toLocaleString("en-IN")}
                </span>
              </>
            );
            return (
              <li key={r.status}>
                {r.count > 0 && !demo ? (
                  <Link
                    href={`/leads?status=${r.status}`}
                    aria-label={`${r.label}: ${r.count} leads. View them.`}
                    className="-mx-1.5 flex min-h-8 items-center gap-3 rounded-md px-1.5 transition hover:bg-tint/5 motion-reduce:transition-none"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="-mx-1.5 flex min-h-8 items-center gap-3 px-1.5">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col rounded-xl border border-line bg-surface-2/60 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Conversion</p>
          <p
            className={cn(
              "tnum mt-1 text-[32px] font-semibold leading-none",
              conversion === null ? "text-ink-dim" : TONE.lime.text,
            )}
          >
            {conversion === null ? "—" : `${conversion.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">
            {conversion === null ? "No leads yet" : "of leads reached qualified or later"}
          </p>
          {!demo && (
            <Link
              href="/crm"
              className="mt-auto inline-flex min-h-10 items-end pt-4 text-xs font-semibold text-neon-cyan hover:underline"
            >
              View CRM →
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
