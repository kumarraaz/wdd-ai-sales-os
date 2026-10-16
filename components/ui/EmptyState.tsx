import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TONE, type Tone } from "./tone";

/**
 * Honest empty / unavailable state: says what is missing and offers the one
 * next action that fixes it. Never fill these with sample rows.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "cyan",
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      className={cn(
        "rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("mx-auto flex h-11 w-11 items-center justify-center rounded-xl border", t.border, t.soft, t.text)}
      >
        <Icon size={22} />
      </span>
      <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
