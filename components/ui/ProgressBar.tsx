import { cn } from "@/lib/cn";
import { TONE, type Tone } from "./tone";

/** 8px neon progress bar (Figma pipeline/usage bars). `label` names it for assistive tech. */
export function ProgressBar({
  value,
  max = 100,
  tone = "cyan",
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  label: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("h-2 overflow-hidden rounded-full bg-tint/10", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none", TONE[tone].solid)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
