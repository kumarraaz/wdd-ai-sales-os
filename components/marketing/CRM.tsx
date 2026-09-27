"use client";

import { FileText, StickyNote, ListChecks, History } from "lucide-react";
import Reveal from "@/components/ui/Reveal";

const stages = [
  { name: "New", count: 24 },
  { name: "Researching", count: 11 },
  { name: "Qualified", count: 9 },
  { name: "Contacted", count: 14 },
  { name: "Replied", count: 6 },
  { name: "Meeting", count: 3 },
  { name: "Proposal", count: 2 },
  { name: "Won", count: 5 },
];

const extras = [
  { icon: History, title: "Full timeline", text: "Every discovery, enrichment, message and status change — one chronological record per lead." },
  { icon: StickyNote, title: "Notes & tasks", text: "Attach notes, create follow-up tasks and assign them to teammates with due dates." },
  { icon: ListChecks, title: "Activities", text: "Calls, meetings and messages logged automatically against the right lead." },
  { icon: FileText, title: "Files & proposals", text: "Attach documents and proposals to leads with secure, private storage." },
];

export default function CRM() {
  return (
    <section id="crm" aria-labelledby="crm-heading" className="relative py-24 sm:py-32">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-transparent via-white/[0.02] to-transparent"
      />
      <div className="relative mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            CRM
          </p>
          <h2
            id="crm-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            A pipeline you can see at a glance
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Drag leads across stages, open a rich profile for any of them, and
            never lose track of a conversation again.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div
            className="mt-12 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur"
            role="img"
            aria-label="Illustration of the CRM kanban board with stages from New to Won"
          >
            <div className="flex min-w-[880px] gap-3">
              {stages.map((s) => (
                <div
                  key={s.name}
                  className="w-40 shrink-0 rounded-xl border border-white/10 bg-[#0D1B2A]/60 p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-white/70">
                      {s.name}
                    </p>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/70 tnum">
                      {s.count}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg border border-white/10 bg-white/[0.05] p-2.5">
                      <div className="h-2 w-3/4 rounded bg-white/15" aria-hidden="true" />
                      <div className="mt-1.5 h-2 w-1/2 rounded bg-white/10" aria-hidden="true" />
                    </div>
                    <div className="rounded-lg border border-[#D4AF37]/25 bg-[#D4AF37]/[0.07] p-2.5">
                      <div className="h-2 w-2/3 rounded bg-[#D4AF37]/30" aria-hidden="true" />
                      <div className="mt-1.5 h-2 w-1/3 rounded bg-white/10" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {extras.map((e, i) => (
            <Reveal key={e.title} delay={Math.min(i * 0.07, 0.21)}>
              <article className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                <e.icon className="h-5 w-5 text-[#D4AF37]" aria-hidden="true" />
                <h3 className="mt-3 font-display text-sm font-semibold text-white">{e.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/60">{e.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
