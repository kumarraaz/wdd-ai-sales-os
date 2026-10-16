import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { Tone } from "@/components/ui/tone";
import { stagger } from "@/lib/cn";
import type { UsageMeters } from "@/lib/dashboard-data";

function toneFor(used: number, limit: number): Tone {
  const ratio = used / Math.max(1, limit);
  return ratio >= 0.9 ? "red" : ratio >= 0.7 ? "amber" : "cyan";
}

/** Real usage against the workspace plan's limits. Bars turn amber at 70% and red at 90%. */
export function PlanUsagePanel({ usage, demo }: { usage: UsageMeters; demo: boolean }) {
  const rows = [
    { label: "Leads", note: "all time", u: usage.leads },
    { label: "AI tokens", note: "today", u: usage.aiTokens },
    { label: "Messages sent", note: "today", u: usage.messages },
  ];
  return (
    <Card aria-labelledby="usage-title" className="rise-in" style={stagger(9)}>
      <CardHeader
        id="usage-title"
        title="Plan usage"
        description="Against your workspace plan"
        actions={
          !demo && (
            <Link href="/billing" className="text-xs font-semibold text-neon-cyan hover:underline">
              Details →
            </Link>
          )
        }
      />
      <ul className="mt-4 space-y-4">
        {rows.map(({ label, note, u }) => (
          <li key={label}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-ink">
                {label} <span className="font-normal text-ink-muted">· {note}</span>
              </span>
              <span className="tnum text-ink-muted">
                {u.used.toLocaleString("en-IN")} / {u.limit.toLocaleString("en-IN")}
              </span>
            </div>
            <ProgressBar
              className="mt-1.5"
              value={u.used}
              max={u.limit}
              tone={toneFor(u.used, u.limit)}
              label={`${label} (${note}): ${u.used} of ${u.limit}`}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
