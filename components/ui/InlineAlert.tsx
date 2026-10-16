import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TONE, type Tone } from "./tone";

const ICON = { cyan: Info, blue: Info, violet: Info, pink: Info, muted: Info, lime: CheckCircle2, amber: AlertTriangle, red: XCircle } as const;

/** Inline feedback banner. Errors use role="alert"; everything else role="status". */
export function InlineAlert({
  tone = "cyan",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  const Icon = ICON[tone];
  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", t.border, t.soft, className)}
    >
      <Icon aria-hidden="true" size={18} className={cn("mt-0.5 shrink-0", t.text)} />
      <div className="min-w-0 flex-1">
        {title && <p className={cn("font-semibold", t.text)}>{title}</p>}
        {children && <div className={cn("text-ink-muted", title ? "mt-0.5" : undefined)}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
