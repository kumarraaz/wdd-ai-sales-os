import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TONE, type Tone } from "./tone";

/** Small uppercase status chip. `dot` adds a leading status dot; `live` makes it pulse. */
export function Badge({
  tone = "muted",
  dot = false,
  live = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  live?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 align-middle text-[10px] font-semibold uppercase leading-4 tracking-[0.08em]",
        t.border,
        t.soft,
        t.text,
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", t.solid, live && "live-dot")} />}
      {children}
    </span>
  );
}

/** The standard marker for fixture-only demo content (never mixed with real data). */
export function DemoBadge() {
  return <Badge tone="amber">DEMO_DATA</Badge>;
}
