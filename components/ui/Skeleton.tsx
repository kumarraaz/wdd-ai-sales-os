import { cn } from "@/lib/cn";

/** Shimmering placeholder block (decorative; screen readers get the parent's aria-busy). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton", className)} />;
}

/** Generic page skeleton used by route-level loading.tsx files. */
export function PageSkeleton({ cards = 4, panels = 2 }: { cards?: number; panels?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-tile border border-line bg-surface p-[18px]">
            <Skeleton className="h-[34px] w-[34px]" />
            <Skeleton className="mt-4 h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-36" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: panels }).map((_, i) => (
          <div
            key={i}
            className={cn("rounded-card border border-line bg-surface p-5", i === 0 && panels > 1 && "lg:col-span-2")}
          >
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-3 w-64 max-w-full" />
            <Skeleton className="mt-6 h-48 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
