import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ProgressBar } from "./ProgressBar";
import type { Tone } from "./tone";

export interface BarItem {
  key: string;
  label: ReactNode;
  /** plain-text label for the bar's accessible name */
  name: string;
  value: number;
  href?: string;
  tone?: Tone;
}

/**
 * Ranked horizontal bars (breakdowns). Bar length is relative to the largest item;
 * the share column is relative to `total`. Rows link only when the destination
 * list reproduces the count.
 */
export function BarList({ items, total, tone = "cyan" }: { items: BarItem[]; total: number; tone?: Tone }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => {
        const share = total > 0 ? Math.round((i.value / total) * 100) : 0;
        const inner = (
          <>
            <span className="w-28 shrink-0 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted sm:w-36">
              {i.label}
            </span>
            <ProgressBar
              className="flex-1"
              value={i.value}
              max={max}
              tone={i.tone ?? tone}
              label={`${i.name}: ${i.value.toLocaleString("en-IN")} (${share}%)`}
            />
            <span className="tnum w-20 shrink-0 text-right text-xs text-ink">
              <span className="font-semibold">{i.value.toLocaleString("en-IN")}</span>
              <span className="ml-1 text-ink-dim">{share}%</span>
            </span>
          </>
        );
        return (
          <li key={i.key}>
            {i.href && i.value > 0 ? (
              <Link
                href={i.href}
                className={cn("-mx-1.5 flex min-h-8 items-center gap-3 rounded-md px-1.5 transition hover:bg-tint/5 motion-reduce:transition-none")}
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
  );
}
