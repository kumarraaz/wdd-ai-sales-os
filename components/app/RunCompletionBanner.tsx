"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

interface RunNotification {
  id: string;
  title: string;
  body: string | null;
}

/**
 * Non-annoying banner shown once when the user opens the app after a
 * prospecting run completed: "47 new verified leads added" with
 * View Leads / View Today's Run actions. Dismissing marks it read.
 */
export function RunCompletionBanner({ apiBase }: { apiBase: string }) {
  const [note, setNote] = useState<RunNotification | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/notifications?unread=1&take=5`);
        if (!res.ok) return;
        const data = await res.json();
        const runNote = (data.notifications ?? []).find(
          (n: { type: string }) => n.type === "prospecting_run_completed",
        );
        if (!cancelled && runNote) setNote(runNote);
      } catch {
        /* transient */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  async function dismiss() {
    if (note) {
      try {
        await fetch(`${apiBase}/notifications/${note.id}/read`, { method: "POST" });
      } catch {
        /* best-effort */
      }
    }
    setNote(null);
  }

  if (!note) return null;

  return (
    <div className="border-b border-neon-cyan/30 bg-neon-cyan/10 px-4 py-3">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <Sparkles size={18} className="shrink-0 text-neon-cyan" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{note.title}</p>
          {note.body && (
            <p className="whitespace-pre-line text-xs text-ink-muted">{note.body}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/leads"
            onClick={dismiss}
            className="rounded-lg bg-neon-cyan px-3 py-1.5 text-xs font-semibold text-[#021614] transition hover:brightness-110"
          >
            View Leads
          </Link>
          <Link
            href="/prospecting"
            onClick={dismiss}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-tint/5"
          >
            View Today&apos;s Run
          </Link>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="rounded-lg p-1.5 text-ink-muted transition hover:bg-tint/10 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
