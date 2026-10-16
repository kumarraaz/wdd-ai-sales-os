"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

export interface MomentumPoint {
  label: string;
  leads: number;
  /** omitted when the data source has no qualified breakdown (e.g. demo fixtures) */
  qualified?: number;
}

interface TooltipRow {
  name?: string | number;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipRow>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-control border border-line-strong bg-surface px-3 py-2 text-xs shadow-[0_12px_30px_-12px_rgba(0,0,0,0.8)]">
      <p className="mb-1 font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
      {payload.map((row) => (
        <p key={String(row.name)} className="flex items-center gap-2 text-ink">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: row.color }} />
          <span className="text-ink-muted">{row.name}</span>
          <span className="tnum ml-auto font-semibold">{Number(row.value ?? 0).toLocaleString("en-IN")}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Figma "Lead momentum" chart: thin neon lines over a faint grid, two series.
 * Data comes from real per-day counts; with reduced motion the draw-in is skipped.
 */
export function MomentumChart({ points, showQualified }: { points: MomentumPoint[]; showQualified: boolean }) {
  const reduced = usePrefersReducedMotion();
  const total = points.reduce((n, p) => n + p.leads, 0);

  return (
    <div
      role="img"
      aria-label={`Area chart of new leads per day over ${points.length} days: ${total.toLocaleString("en-IN")} in total.`}
      className="h-[220px] w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 6, left: 6, bottom: 0 }}>
          <defs>
            <linearGradient id="momentum-cyan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#43f5e2" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#43f5e2" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="momentum-violet" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1d2a40" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={32}
            tick={{ fill: "#8a98b3", fontSize: 10, fontWeight: 500 }}
            dy={6}
          />
          <YAxis hide allowDecimals={false} domain={[0, (max: number) => Math.max(4, max)]} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#2a3b57" }} />
          <Area
            type="monotone"
            dataKey="leads"
            name="Leads found"
            stroke="#43f5e2"
            strokeWidth={2}
            fill="url(#momentum-cyan)"
            dot={false}
            activeDot={{ r: 4, fill: "#43f5e2", stroke: "#070b14", strokeWidth: 2 }}
            isAnimationActive={!reduced}
            animationDuration={900}
          />
          {showQualified && (
            <Area
              type="monotone"
              dataKey="qualified"
              name="Qualified"
              stroke="#a78bfa"
              strokeWidth={2}
              fill="url(#momentum-violet)"
              dot={false}
              activeDot={{ r: 4, fill: "#a78bfa", stroke: "#070b14", strokeWidth: 2 }}
              isAnimationActive={!reduced}
              animationDuration={900}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
