"use client";

import {
  Radar,
  Database,
  BrainCircuit,
  SquareKanban,
  Mail,
  Workflow,
  Plug,
  Command,
  BarChart3,
} from "lucide-react";
import Reveal from "@/components/ui/Reveal";

const features = [
  {
    icon: Radar,
    title: "Lead Discovery Engine",
    text: "Search businesses by country, city, industry and keywords. Modular provider architecture — add new sources without rewriting the app.",
  },
  {
    icon: Database,
    title: "Lead Database",
    text: "Powerful table with search, filters, sorting, bulk actions, CSV import/export and automatic deduplication.",
  },
  {
    icon: BrainCircuit,
    title: "AI Lead Scoring",
    text: "Every lead scored 0–100 against your ICP with a transparent breakdown of why it scored high.",
  },
  {
    icon: SquareKanban,
    title: "CRM Pipeline",
    text: "Drag-and-drop kanban from NEW to WON, with activities, notes, tasks, messages and a full timeline per lead.",
  },
  {
    icon: Mail,
    title: "Multi-Channel Outreach",
    text: "Email, WhatsApp, Telegram, LinkedIn drafts and SMS — unified drafts, previews, approvals and history.",
  },
  {
    icon: Workflow,
    title: "Automation Builder",
    text: "Visual trigger → condition → action workflows with delays, follow-up sequences and human approval gates.",
  },
  {
    icon: Plug,
    title: "Integration Center",
    text: "Connect email, messaging, calendar, storage and AI providers. Credentials encrypted, never shown in full.",
  },
  {
    icon: Command,
    title: "AI Command Center",
    text: "Type “show me leads scored above 80” or “research this company” — the assistant turns words into safe actions.",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    text: "Lead growth, pipeline, source, campaign and channel performance — generated from your real workspace data.",
  },
];

export default function Features() {
  return (
    <section id="features" aria-labelledby="features-heading" className="relative py-24 sm:py-32">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-transparent via-white/[0.02] to-transparent"
      />
      <div className="relative mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            Features
          </p>
          <h2
            id="features-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            An operating system for your entire sales motion
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Not another scraper. Nine deeply integrated modules that carry a
            prospect from first discovery to closed deal.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={Math.min((i % 3) * 0.08, 0.24)}>
              <article className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur transition-all hover:-translate-y-1 hover:border-[#D4AF37]/40 hover:shadow-[0_12px_40px_rgba(212,175,55,0.12)]">
                <div className="inline-flex rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/10 p-2.5">
                  <f.icon className="h-5 w-5 text-[#D4AF37]" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-white">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{f.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
