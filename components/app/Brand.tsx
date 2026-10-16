import { cn } from "@/lib/cn";

/** Figma brand lockup: cyan "WDD" with a 4px neon bar, "AI SALES OS" beneath. */
export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("relative flex items-center", className)}>
      <span
        aria-hidden="true"
        className="mr-2.5 h-10 w-1 shrink-0 rounded-full bg-neon-cyan shadow-[0_0_14px_rgba(67,245,226,0.55)]"
      />
      <span className="leading-none">
        <span className="block text-xl font-semibold tracking-tight text-neon-cyan">{compact ? "W" : "WDD"}</span>
        {!compact && (
          <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.16em] text-ink-muted">
            AI Sales OS
          </span>
        )}
      </span>
    </span>
  );
}
