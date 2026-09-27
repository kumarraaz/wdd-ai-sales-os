"use client";

import {
  Search,
  Database,
  Target,
  Sparkles,
  Send,
  Repeat,
  Trophy,
} from "lucide-react";
import Reveal from "@/components/ui/Reveal";

const steps = [
  {
    n: "01",
    icon: Search,
    title: "Discover",
    text: "Find businesses by location, industry and keywords from permitted public sources, directories and your own imports.",
  },
  {
    n: "02",
    icon: Database,
    title: "Enrich",
    text: "Automatically research each company — website, services, size, public contacts — with every fact sourced.",
  },
  {
    n: "03",
    icon: Target,
    title: "Qualify",
    text: "AI scores every lead against your ideal customer profile and shows exactly why it scored high.",
  },
  {
    n: "04",
    icon: Sparkles,
    title: "Personalize",
    text: "Generate outreach grounded in verified company facts — never invented details, never hallucinated claims.",
  },
  {
    n: "05",
    icon: Send,
    title: "Outreach",
    text: "Review every message before it goes out. Approval-required is the default on every channel.",
  },
  {
    n: "06",
    icon: Repeat,
    title: "Follow Up",
    text: "Multi-step sequences that stop automatically on reply, meeting booked, or your manual stop.",
  },
  {
    n: "07",
    icon: Trophy,
    title: "Convert",
    text: "Move deals through your pipeline, track replies and meetings, and analyze what actually converts.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-heading" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            How it works
          </p>
          <h2
            id="how-it-works-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            One workflow, from stranger to signed deal
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            The complete sales lifecycle — discovery to conversion — managed
            from a single dashboard, with AI assisting and you approving.
          </p>
        </Reveal>

        <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={Math.min(i * 0.06, 0.3)}>
              <li className="group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur transition-colors hover:border-[#D4AF37]/40">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-2 -top-4 font-display text-7xl font-bold text-white/[0.05] transition-colors group-hover:text-[#D4AF37]/10"
                >
                  {s.n}
                </span>
                <s.icon className="h-6 w-6 text-[#D4AF37]" aria-hidden="true" />
                <h3 className="mt-4 font-display text-lg font-semibold text-white">
                  <span className="mr-2 text-xs font-bold tracking-widest text-[#D4AF37]/80">{s.n}</span>
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{s.text}</p>
              </li>
            </Reveal>
          ))}
          {/* CTA tile fills the 8th grid slot */}
          <Reveal delay={0.3}>
            <li className="flex h-full flex-col items-start justify-center rounded-2xl border border-[#D4AF37]/30 bg-gradient-to-br from-[#D4AF37]/15 to-transparent p-6">
              <p className="font-display text-lg font-semibold text-white">
                Ready to run it?
              </p>
              <p className="mt-2 text-sm text-white/60">
                Create a free workspace and discover your first leads today.
              </p>
              <a
                href="/signup"
                className="mt-4 rounded-lg bg-[#D4AF37] px-5 py-2.5 text-sm font-semibold text-[#0D1B2A] transition-colors hover:bg-[#e2be4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
              >
                Start free
              </a>
            </li>
          </Reveal>
        </ol>
      </div>
    </section>
  );
}
