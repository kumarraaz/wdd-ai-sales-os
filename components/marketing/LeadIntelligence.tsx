"use client";

import { BadgeCheck, Sparkles, Link2, Building2 } from "lucide-react";
import Reveal from "@/components/ui/Reveal";

const points = [
  {
    icon: BadgeCheck,
    title: "Verified data, clearly labeled",
    text: "Company website, public contacts, location and services — each field carries its source, source URL and retrieval date.",
  },
  {
    icon: Sparkles,
    title: "AI inference, never disguised",
    text: "Pain points, sales angles and fit assessments are marked as AI inference. If it can't be verified, the platform says so.",
  },
  {
    icon: Link2,
    title: "Clickable provenance",
    text: "Every important field traces back to where it came from. No black-box claims, no invented employees or revenue.",
  },
];

export default function LeadIntelligence() {
  return (
    <section
      id="intelligence"
      aria-labelledby="intelligence-heading"
      className="relative py-24 sm:py-32"
    >
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            Lead Intelligence
          </p>
          <h2
            id="intelligence-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            Know the company before you ever say hello
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Each lead profile assembles a company overview — what they do,
            products and services, target market, public contacts, potential
            pain points and your AI sales angle — while keeping a hard line
            between what is verified and what is inferred.
          </p>
          <ul className="mt-8 space-y-5">
            {points.map((p) => (
              <li key={p.title} className="flex gap-4">
                <div className="shrink-0 rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/10 p-2.5">
                  <p.icon className="h-5 w-5 text-[#D4AF37]" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-display text-base font-semibold text-white">
                    {p.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-white/60">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.15}>
          <div
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur"
            role="img"
            aria-label="Illustration of a lead intelligence profile showing verified data and AI inference sections"
          >
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#D4AF37]/15">
                <Building2 className="h-5 w-5 text-[#D4AF37]" aria-hidden="true" />
              </div>
              <div>
                <p className="font-display text-base font-semibold text-white">
                  Acme Industrial Exports
                </p>
                <p className="text-xs text-white/50">Ahmedabad, Gujarat · Industrial Manufacturing</p>
              </div>
              <span className="ml-auto rounded-full bg-[#D4AF37]/15 px-3 py-1 text-xs font-bold text-[#D4AF37]">
                82/100
              </span>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3.5">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified
                </p>
                <p className="mt-1.5 text-white/70">
                  “Company website states it provides freight forwarding and
                  export documentation services.”
                </p>
                <p className="mt-1 text-xs text-white/40">Source: company website · Retrieved 2026-09-28</p>
              </div>
              <div className="rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/5 p-3.5">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#D4AF37]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> AI inference
                </p>
                <p className="mt-1.5 text-white/70">
                  “Potentially suitable for international logistics services —
                  confirm on a discovery call.”
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
