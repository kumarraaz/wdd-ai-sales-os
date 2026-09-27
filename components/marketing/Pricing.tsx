"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import Reveal from "@/components/ui/Reveal";
import { cn } from "@/lib/format";

interface Tier {
  name: string;
  price: string;
  blurb: string;
  features: string[];
  cta: { label: string; href?: string };
  comingSoon?: boolean;
  highlight?: boolean;
}

const tiers: Tier[] = [
  {
    name: "Free",
    price: "₹0",
    blurb: "Start building your pipeline today.",
    features: [
      "1 workspace, 1 user",
      "Up to 500 leads",
      "Lead discovery (demo + CSV)",
      "CRM pipeline & lead profiles",
      "AI lead scoring",
      "Manual outreach mode",
    ],
    cta: { label: "Start free", href: "/signup" },
  },
  {
    name: "Pro",
    price: "Coming soon",
    blurb: "For solo closers ready to scale.",
    features: [
      "Everything in Free",
      "Advanced lead discovery",
      "Unlimited leads",
      "AI research & personalization",
      "Email campaigns",
      "Advanced automation",
    ],
    cta: { label: "Upgrade" },
    comingSoon: true,
    highlight: true,
  },
  {
    name: "Business",
    price: "Coming soon",
    blurb: "For teams running real pipeline.",
    features: [
      "Everything in Pro",
      "Team collaboration & roles",
      "WhatsApp automation",
      "Advanced analytics",
      "Custom AI agents",
      "API access",
    ],
    cta: { label: "Upgrade" },
    comingSoon: true,
  },
  {
    name: "Enterprise",
    price: "Talk to us",
    blurb: "For organizations with serious volume.",
    features: [
      "Everything in Business",
      "White labeling",
      "Enterprise SSO",
      "Custom AI models",
      "Dedicated support",
      "Advanced enrichment",
    ],
    cta: { label: "Upgrade" },
    comingSoon: true,
  },
];

function TierCard({ tier, index }: { tier: Tier; index: number }) {
  const [showNote, setShowNote] = useState(false);

  return (
    <Reveal delay={Math.min(index * 0.08, 0.24)} className="h-full">
      <article
        className={cn(
          "relative flex h-full flex-col rounded-2xl border p-6 backdrop-blur",
          tier.highlight
            ? "border-[#D4AF37]/50 bg-gradient-to-b from-[#D4AF37]/[0.08] to-white/[0.03]"
            : "border-white/10 bg-white/[0.04]"
        )}
      >
        {tier.comingSoon && (
          <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#D4AF37]/40 bg-[#0D1B2A] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#D4AF37]">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Coming soon
          </span>
        )}
        <h3 className="font-display text-lg font-semibold text-white">{tier.name}</h3>
        <p className="mt-2 font-display text-3xl font-bold text-white">{tier.price}</p>
        <p className="mt-1.5 text-sm text-white/55">{tier.blurb}</p>
        <ul className="mt-5 flex-1 space-y-2.5">
          {tier.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-white/70">
              <Check
                className={cn("mt-0.5 h-4 w-4 shrink-0", tier.comingSoon ? "text-white/30" : "text-[#D4AF37]")}
                aria-hidden="true"
              />
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-6">
          {tier.cta.href ? (
            <Link
              href={tier.cta.href}
              className="block rounded-xl bg-[#D4AF37] px-5 py-3 text-center text-sm font-semibold text-[#0D1B2A] transition-colors hover:bg-[#e2be4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
            >
              {tier.cta.label}
            </Link>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowNote((v) => !v)}
                aria-expanded={showNote}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-[#D4AF37]/50 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
              >
                {tier.cta.label}
              </button>
              {showNote && (
                <p role="status" className="mt-3 rounded-lg border border-[#D4AF37]/25 bg-[#D4AF37]/10 px-3 py-2 text-center text-xs text-[#f0d878]">
                  Premium Features Coming Soon
                </p>
              )}
            </>
          )}
        </div>
      </article>
    </Reveal>
  );
}

export default function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            Pricing
          </p>
          <h2
            id="pricing-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            Start free. Scale when you&apos;re ready.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            The free plan is fully usable today — real workspace, real leads,
            real CRM. Paid tiers unlock advanced discovery, automation and team
            features as they launch.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {tiers.map((t, i) => (
            <TierCard key={t.name} tier={t} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
