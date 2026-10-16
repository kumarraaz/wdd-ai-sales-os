import { TrendingUp } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CountUp } from "@/components/ui/CountUp";
import { EmptyState } from "@/components/ui/EmptyState";
import { TONE } from "@/components/ui/tone";
import { cn, stagger } from "@/lib/cn";
import type { DayPoint } from "@/lib/dashboard";
import { MomentumChart } from "./MomentumChart";

/**
 * Figma "Lead momentum" panel: legend, big metric and the per-day chart.
 * The metric is the sum of the plotted points, so panel, chart and the "New leads"
 * KPI tile can never disagree.
 */
export function MomentumPanel({ points, rangeLabel }: { points: DayPoint[]; rangeLabel: string }) {
  const total = points.reduce((n, p) => n + p.leads, 0);
  const showQualified = points.some((p) => p.qualified > 0);
  const perDay = points.length > 0 ? total / points.length : 0;

  return (
    <Card aria-labelledby="momentum-title" className="rise-in" style={stagger(3)}>
      <CardHeader
        id="momentum-title"
        title="Lead momentum"
        description={`New leads per day · ${rangeLabel.toLowerCase()} (UTC days)`}
        actions={
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", TONE.cyan.solid)} />
              Leads found
            </li>
            {showQualified && (
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", TONE.violet.solid)} />
                Qualified or later
              </li>
            )}
          </ul>
        }
      />

      {total === 0 ? (
        <EmptyState
          icon={TrendingUp}
          tone="cyan"
          className="mt-4 py-12"
          title={`No new leads in the ${rangeLabel.toLowerCase()}`}
          description="Leads you import or discover are charted here, day by day. Nothing is estimated."
          action={
            <ButtonLink href="/discover" variant="primary" size="sm">
              Run a discovery
            </ButtonLink>
          }
        />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
            <p className="tnum text-[32px] font-semibold leading-none text-ink">
              <CountUp value={total} />
            </p>
            <p className="pb-0.5 text-xs text-ink-muted">
              new {total === 1 ? "lead" : "leads"} · about {perDay.toLocaleString("en-IN", { maximumFractionDigits: 1 })} per day
            </p>
          </div>
          <div className="mt-3">
            <MomentumChart points={points} showQualified={showQualified} />
          </div>
        </>
      )}
    </Card>
  );
}
