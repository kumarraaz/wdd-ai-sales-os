"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const WIDTH = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * Modal built on the native <dialog> element, so the browser provides the focus
 * trap, Escape handling, inert background and focus restoration. Add
 * `data-autofocus` to the control that should receive focus when it opens
 * (use it on Cancel for destructive confirmations).
 *
 * `onClose` fires for Escape, backdrop click, the close button and programmatic
 * closes, so callers must treat it as idempotent.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof WIDTH;
  /** false blocks Escape/backdrop dismissal (e.g. while a request is in flight). */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        if (!dismissible) e.preventDefault();
      }}
      onClick={(e) => {
        // A click on the ::backdrop is reported with the <dialog> itself as target.
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "pop-in m-auto w-[calc(100%-2rem)] rounded-card border border-line-strong bg-surface p-0 text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]",
        "backdrop:bg-black/65 backdrop:backdrop-blur-[2px]",
        WIDTH[size],
      )}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold leading-snug text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mr-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-tint/10 hover:text-ink"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-6 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </dialog>
  );
}
