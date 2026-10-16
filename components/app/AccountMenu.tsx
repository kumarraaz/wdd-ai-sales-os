"use client";

import Link from "next/link";
import { ChevronDown, CreditCard, LogOut, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Top-bar account control: avatar + name/role, with a menu for settings, plan
 * and sign out (or Exit Demo). Escape and outside-click close it and return
 * focus to the trigger.
 */
export function AccountMenu({
  name,
  email,
  role,
  orgName,
  demo,
  onSignOut,
  onExitDemo,
}: {
  name: string | null;
  email: string;
  role?: string;
  orgName?: string;
  demo: boolean;
  onSignOut: () => void;
  onExitDemo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const initials = (name || email).trim().slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const itemCls =
    "flex min-h-11 w-full items-center gap-2.5 px-4 text-left text-sm text-ink-muted transition hover:bg-tint/10 hover:text-ink";

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Account menu"
        className="flex min-h-11 items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition hover:bg-tint/5 sm:min-h-10 sm:pr-3"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-neon-cyan/60 bg-surface text-xs font-semibold text-ink"
        >
          {initials}
        </span>
        <span className="hidden min-w-0 text-left leading-tight md:block">
          <span className="block max-w-[9rem] truncate text-[13px] font-semibold text-ink">{name || "User"}</span>
          <span className="block max-w-[9rem] truncate text-[10px] font-medium uppercase tracking-wider text-ink-muted">
            {[role, orgName].filter(Boolean).join(" • ")}
          </span>
        </span>
        <ChevronDown size={14} aria-hidden="true" className={cn("hidden text-ink-dim transition md:block", open && "rotate-180")} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="pop-in absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-card border border-line-strong bg-surface shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{name || "User"}</p>
            <p className="truncate text-xs text-ink-muted">{email}</p>
            {orgName && (
              <p className="mt-1 truncate text-[11px] font-medium text-neon-cyan">
                {orgName}
                {role ? ` · ${role}` : ""}
              </p>
            )}
          </div>
          {!demo && (
            <>
              <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className={itemCls}>
                <Settings size={16} aria-hidden="true" /> Workspace settings
              </Link>
              <Link href="/billing" role="menuitem" onClick={() => setOpen(false)} className={itemCls}>
                <CreditCard size={16} aria-hidden="true" /> Plan &amp; usage
              </Link>
              <div className="border-t border-line" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              if (demo) onExitDemo();
              else onSignOut();
            }}
            className={cn(itemCls, demo && "text-neon-cyan hover:text-neon-cyan")}
          >
            <LogOut size={16} aria-hidden="true" /> {demo ? "Exit Demo" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
