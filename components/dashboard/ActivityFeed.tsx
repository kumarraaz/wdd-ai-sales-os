"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import type { ActivityItem } from "@/lib/activity";
import { relativeTime } from "@/lib/dashboard";

const AVATAR_TONE: Record<string, string> = {
  DS: "text-neon-cyan",
  AI: "text-neon-violet",
  OK: "text-neon-lime",
  NO: "text-neon-pink",
};

/**
 * Real activity from /api/activity. When `live`, it re-polls every 30s while the
 * tab is visible, so the LIVE marker only ever appears when the feed really refreshes.
 * Server-rendered `initial` + `generatedAt` keep first paint (and hydration) identical.
 */
export function ActivityFeed({
  initial,
  generatedAt,
  live,
}: {
  initial: ActivityItem[];
  generatedAt: string;
  live: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [nowMs, setNowMs] = useState(() => new Date(generatedAt).getTime());

  useEffect(() => {
    // Relative times tick even when nothing new arrives (and in demo, where there is no polling).
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    if (!live) return () => clearInterval(tick);

    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/activity?limit=6", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setItems(data.items ?? []);
        setNowMs(Date.now());
      } catch {
        /* transient: keep the last good list */
      }
    };
    const poll = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [live]);

  return (
    <Card aria-labelledby="activity-title" className="rise-in" style={{ "--i": 6 } as React.CSSProperties}>
      <CardHeader
        id="activity-title"
        title="Live activity"
        actions={
          live ? (
            <Badge tone="lime" dot live>
              Live
            </Badge>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={Activity}
          tone="muted"
          className="mt-4 border-line py-8"
          title="No activity yet"
          description={
            live
              ? "Imports, research, scoring and approval decisions will appear here as they happen."
              : "Activity isn't recorded in demo mode."
          }
        />
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.map((a) => {
            const row = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface-2 text-[10px] font-semibold",
                    AVATAR_TONE[a.initials] ?? "text-neon-blue",
                  )}
                >
                  {a.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink">{a.title}</span>
                  {a.detail && <span className="block truncate text-[11px] text-ink-muted">{a.detail}</span>}
                </span>
                <time dateTime={a.at} className="tnum shrink-0 text-[10px] text-ink-muted">
                  {relativeTime(a.at, nowMs)}
                </time>
              </>
            );
            return (
              <li key={a.id}>
                {a.href ? (
                  <Link
                    href={a.href}
                    className="-mx-2 flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-tint/5 motion-reduce:transition-none"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex min-h-12 items-center gap-3 py-2">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
