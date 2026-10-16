import Link from "next/link";
import { cn } from "@/lib/cn";

export interface Signal {
  label: string;
  value: number;
  /** drill-down into the matching list; omit when there is no list that reproduces the count */
  href?: string;
}

const chip =
  "inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-xs text-ink-muted";

/**
 * Workspace-wide lead-quality counts shown under the KPI row. Each chip that links
 * opens a lead list filtered by exactly the condition that was counted.
 */
export function SignalChips({ signals }: { signals: Signal[] }) {
  return (
    <ul aria-label="Lead quality signals" className="rise-in flex flex-wrap gap-2" style={{ "--i": 2 } as React.CSSProperties}>
      {signals.map((s) => {
        const body = (
          <>
            {s.label}
            <span className="tnum font-semibold text-ink">{s.value.toLocaleString("en-IN")}</span>
          </>
        );
        return (
          <li key={s.label}>
            {s.href ? (
              <Link
                href={s.href}
                className={cn(chip, "transition hover:border-neon-cyan/40 hover:text-ink motion-reduce:transition-none")}
              >
                {body}
              </Link>
            ) : (
              <span className={chip}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
