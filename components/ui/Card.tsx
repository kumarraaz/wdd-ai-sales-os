import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TONE, type Tone } from "./tone";

type CardProps = HTMLAttributes<HTMLElement> & {
  /** Element to render (default <section>). */
  as?: "section" | "div" | "article" | "aside";
  /** Tints the border with an accent. */
  tone?: Tone;
  /** Hover lift + neon edge. Only for cards that are themselves a link/button. */
  interactive?: boolean;
  /** Default padding (20px). Pass false when the card hosts a table/edge-to-edge content. */
  padded?: boolean;
};

/** Surface container: Figma "panel" (#0d1424, 1px #1d2a40, 15px radius). */
export function Card({
  as: Tag = "section",
  tone,
  interactive = false,
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        "relative rounded-card border bg-surface shadow-panel",
        tone ? TONE[tone].border : "border-line",
        padded && "p-5",
        interactive &&
          "transition duration-200 hover:-translate-y-px hover:border-neon-cyan/40 motion-reduce:transform-none motion-reduce:transition-none",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Panel heading: 17px semibold title, 11px muted subtitle, optional right-side slot. */
export function CardHeader({
  title,
  description,
  actions,
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** id for the heading so the card can be aria-labelledby it */
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-[17px] font-semibold leading-snug text-ink">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
