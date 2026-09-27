"use client";

import Reveal from "@/components/ui/Reveal";

const metrics = [
  { label: "Lead growth", values: [22, 34, 30, 48, 55, 71, 88], note: "Leads discovered per week" },
  { label: "Pipeline value", values: [40, 45, 62, 58, 74, 80, 92], note: "Weighted by stage" },
  { label: "Reply rate", values: [18, 26, 24, 38, 44, 52, 61], note: "Replies per outreach" },
];

function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values);
  return (
    <div className="flex h-28 items-end gap-1.5" role="img" aria-label={`${label} trend chart illustration`}>
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-gradient-to-t from-[#D4AF37]/25 to-[#D4AF37]"
          style={{ height: `${Math.round((v / max) * 100)}%`, opacity: 0.55 + (i / values.length) * 0.45 }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

const tracked = [
  "Leads discovered & qualified",
  "Campaigns, messages & replies",
  "Meetings booked & conversions",
  "Source, channel & campaign performance",
];

export default function Analytics() {
  return (
    <section
      id="analytics"
      aria-labelledby="analytics-heading"
      className="relative py-24 sm:py-32"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            Analytics
          </p>
          <h2
            id="analytics-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            Numbers from your real pipeline, not a demo
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Every chart is generated from your workspace&apos;s actual data —
            signups, discovery, campaigns, replies, meetings and conversion.
            Tenant-aware throughout: you only ever see your own numbers.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {tracked.map((t) => (
              <li
                key={t}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75"
              >
                {t}
              </li>
            ))}
          </ul>
        </Reveal>

        <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {metrics.map((m, i) => (
            <Reveal key={m.label} delay={i * 0.1}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  {m.label}
                </p>
                <Bars values={m.values} label={m.label} />
                <p className="mt-3 text-xs text-white/40">{m.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
