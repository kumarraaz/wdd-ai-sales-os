import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn, stagger } from "@/lib/cn";
import { CountUp } from "./CountUp";
import { TONE, type Tone } from "./tone";
import type { Trend } from "./trend";

/**
 * Figma "KPI card": icon tile, uppercase label, large value, trend, footnote.
 * Renders as a link when `href` is given (drill-down), otherwise a plain article.
 * Values are always computed by the caller from real data — nothing here is a default.
 */
export function KpiTile({
  label,
  value,
  decimals = 0,
  suffix,
  icon: Icon,
  tone,
  trend,
  foot,
  href,
  index = 0,
}: {
  label: string;
  /** A number animates; a string (e.g. "—") renders as-is. */
  value: number | string;
  decimals?: number;
  suffix?: string;
  icon: LucideIcon;
  tone: Tone;
  trend?: Trend | null;
  foot?: string;
  href?: string;
  index?: number;
}) {
  const t = TONE[tone];
  const trendClass =
    trend?.direction === "down" ? "text-red-300" : trend?.direction === "flat" ? "text-ink-muted" : t.text;

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn("flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border", t.border, t.soft, t.text)}
      >
        <Icon size={18} strokeWidth={2} />
      </span>
      <p className="mt-3.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{label}</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-3">
        <p className="tnum text-[26px] font-semibold leading-tight text-ink">
          {typeof value === "number" ? <CountUp value={value} decimals={decimals} suffix={suffix} /> : value}
        </p>
        {trend && <p className={cn("tnum pb-1 text-[11px] font-semibold", trendClass)}>{trend.label}</p>}
      </div>
      {foot && <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{foot}</p>}
    </>
  );

  const cls = cn(
    "rise-in relative block min-w-0 rounded-tile border border-line bg-surface p-3.5 shadow-panel sm:p-[18px]",
    href &&
      "transition duration-200 hover:-translate-y-px hover:border-neon-cyan/40 motion-reduce:transform-none motion-reduce:transition-none",
  );

  return href ? (
    <Link href={href} className={cls} style={stagger(index)}>
      {body}
    </Link>
  ) : (
    <article className={cls} style={stagger(index)}>
      {body}
    </article>
  );
}
