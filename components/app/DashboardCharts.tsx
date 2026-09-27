"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";

const STATUS_ORDER = [
  "NEW",
  "RESEARCHING",
  "QUALIFIED",
  "CONTACTED",
  "REPLIED",
  "MEETING",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
  "NURTURE",
];

export function DashboardCharts({
  growth,
  pipeline,
  avgScore,
}: {
  growth: { day: string; leads: number }[];
  pipeline: { status: string; count: number }[];
  avgScore: number;
}) {
  const ordered = STATUS_ORDER.map((s) => ({
    status: s,
    count: pipeline.find((p) => p.status === s)?.count ?? 0,
  })).filter((p) => p.count > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
          Lead growth — last 30 days
        </h2>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={growth}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} interval={6} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} allowDecimals={false} width={30} />
              <Tooltip
                contentStyle={{ background: "#101f33", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
              />
              <Area type="monotone" dataKey="leads" stroke="#D4AF37" fill="#D4AF37" fillOpacity={0.25} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white/60">
            Pipeline by stage
          </h2>
          <span className="text-xs text-white/50">
            Avg score: <span className="font-semibold text-[#D4AF37]">{avgScore}/100</span>
          </span>
        </div>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ordered} layout="vertical">
              <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="status"
                tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 11 }}
                width={95}
              />
              <Tooltip
                contentStyle={{ background: "#101f33", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
              />
              <Bar dataKey="count" fill="#D4AF37" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
