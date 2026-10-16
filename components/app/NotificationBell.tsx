"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Header bell: unread count badge + dropdown. Polls every 60s so a run that
 * completes while the app is open surfaces a toast-like entry promptly.
 */
export function NotificationBell({ apiBase }: { apiBase: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/notifications?take=8`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      /* transient — keep last state */
    }
  }, [apiBase]);

  useEffect(() => {
    // Initial load runs async so the effect body itself never sets state
    // synchronously; the interval reuses the same loader for polling.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/notifications?take=8`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setItems(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      } catch {
        /* transient — keep last state */
      }
    })();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [apiBase, load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch(`${apiBase}/notifications/${id}/read`, { method: "POST" });
    } catch {
      /* best-effort */
    }
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    setUnreadCount(0);
    setOpen(false);
    try {
      await fetch(`${apiBase}/notifications`, { method: "POST" });
    } catch {
      /* best-effort */
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        title="Notifications"
        className="relative rounded-lg p-2 text-ink-muted transition hover:bg-tint/10 hover:text-ink"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-neon-cyan px-1 text-[10px] font-semibold text-[#021614]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-line-strong bg-surface-2 shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-neon-cyan hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-ink-dim">No notifications yet.</p>
            )}
            {items.map((n) => (
              <div
                key={n.id}
                className={`border-b border-line/60 px-4 py-3 ${n.readAt ? "opacity-60" : ""}`}
              >
                <p className="text-sm font-medium text-ink">{n.title}</p>
                {n.body && (
                  <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{n.body}</p>
                )}
                <div className="mt-2 flex items-center gap-3">
                  {n.link && (
                    <Link
                      href={n.link}
                      onClick={() => {
                        markRead(n.id);
                        setOpen(false);
                      }}
                      className="text-xs font-medium text-neon-cyan hover:underline"
                    >
                      View
                    </Link>
                  )}
                  {!n.readAt && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="text-xs text-ink-dim hover:text-ink"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
