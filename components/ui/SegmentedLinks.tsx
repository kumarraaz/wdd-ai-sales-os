import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Segmented control made of real links (e.g. date range). Because every option is
 * a URL, selection survives refresh/share, needs no client JS, and is keyboard
 * and screen-reader friendly. The caller owns how the href is built.
 */
export function SegmentedLinks({
  label,
  options,
  current,
  hrefFor,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  current: string;
  hrefFor: (value: string) => string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="inline-flex rounded-control border border-line bg-surface p-0.5">
        {options.map((o) => {
          const active = o.value === current;
          return (
            <li key={o.value}>
              <Link
                href={hrefFor(o.value)}
                replace
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex min-h-10 items-center rounded-[7px] px-3 text-xs font-medium transition motion-reduce:transition-none sm:min-h-8",
                  active ? "bg-surface-2 text-ink shadow-[inset_0_0_0_1px_rgba(67,245,226,0.4)]" : "text-ink-muted hover:text-ink",
                )}
              >
                {o.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
