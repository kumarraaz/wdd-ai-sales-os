"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Reveal from "@/components/ui/Reveal";

export default function FinalCTA() {
  return (
    <section aria-labelledby="final-cta-heading" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-[#D4AF37]/25 bg-gradient-to-br from-[#D4AF37]/[0.12] via-white/[0.04] to-transparent p-10 text-center backdrop-blur sm:p-16">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,rgba(212,175,55,0.18),transparent_70%)]"
            />
            <div className="relative">
              <h2
                id="final-cta-heading"
                className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
              >
                Ready to turn the internet into your pipeline?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/65">
                Create a free workspace, discover your first leads, and let AI
                do the research while you do the closing.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="group inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-7 py-3.5 text-sm font-semibold text-[#0D1B2A] shadow-[0_0_32px_rgba(212,175,55,0.35)] transition-all hover:bg-[#e2be4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
                >
                  Start Building Your Pipeline
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center rounded-xl border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:border-white/40 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
                >
                  Explore Demo
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
