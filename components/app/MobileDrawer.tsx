"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { Brand } from "./Brand";

/**
 * Full navigation for phones and tablets (the bottom bar only fits six
 * destinations). Native <dialog>: focus trap, Escape, inert background and
 * focus restoration come from the browser. Links call onClose so the drawer
 * never lingers after navigating.
 */
export function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      id="mobile-drawer"
      aria-label="Navigation menu"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="drawer-in m-0 h-dvh max-h-none w-[19rem] max-w-[86vw] border-r border-line bg-canvas p-0 text-ink backdrop:bg-black/65 backdrop:backdrop-blur-[2px] lg:hidden"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <Link href="/dashboard" onClick={onClose} aria-label="WDD AI Sales OS — Overview">
            <Brand />
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted transition hover:bg-tint/10 hover:text-ink"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </dialog>
  );
}
