import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Consistent page title block. Every page renders exactly one of these, and it
 * owns the page's single <h1>. The shell's top bar shows breadcrumb context only.
 */
export function PageHeader({
  title,
  description,
  badge,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** e.g. <DemoBadge /> */
  badge?: ReactNode;
  /** right-aligned buttons / controls */
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("rise-in flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-neon-cyan">{eyebrow}</p>
        )}
        <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
          {title}
          {badge}
        </h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
