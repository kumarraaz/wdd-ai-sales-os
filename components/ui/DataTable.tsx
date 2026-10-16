import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Table chrome shared by the read-only pages. The scroll region is keyboard-focusable
 * and named, so a wide table never traps a keyboard or screen-reader user.
 *
 * It is `relative` on purpose: visually hidden (`sr-only`) text is absolutely positioned,
 * and without a positioned ancestor it escapes the scroller and widens the whole page.
 */
export function DataTable({
  label,
  minWidth = 640,
  head,
  children,
  className,
}: {
  label: string;
  minWidth?: number;
  head: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={`${label} (scrolls sideways on small screens)`}
      tabIndex={0}
      className={cn("relative -mx-5 overflow-x-auto px-5", className)}
    >
      <table className="w-full border-collapse" style={{ minWidth }}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-line">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ right, children }: { right?: boolean; children?: ReactNode }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted",
        right ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="border-b border-line/60 last:border-0 hover:bg-tint/5">{children}</tr>;
}

export function Td({
  right,
  nowrap,
  className,
  children,
}: {
  right?: boolean;
  nowrap?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <td className={cn("px-3 py-2.5 align-middle text-xs text-ink", right && "tnum text-right", nowrap && "whitespace-nowrap", className)}>
      {children}
    </td>
  );
}
