"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldCheck, Users, Zap } from "lucide-react";

const NetworkCanvas = dynamic(() => import("./NetworkCanvas"), {
  ssr: false,
  loading: () => <StaticBackdrop />,
});

function StaticBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,rgba(212,175,55,0.14),transparent_70%),radial-gradient(ellipse_50%_40%_at_70%_70%,rgba(91,127,166,0.18),transparent_70%)]"
    />
  );
}

const assurances = [
  { icon: Users, label: "Multi-tenant workspaces" },
  { icon: ShieldCheck, label: "Human approval by default" },
  { icon: Zap, label: "Kill switches built in" },
];

export default function Hero() {
  const reduceMotion = useReducedMotion();

  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden">
      {/* 3D / static backdrop */}
      <div className="absolute inset-0" aria-hidden="true">
        {reduceMotion ? <StaticBackdrop /> : <NetworkCanvas />}
        {/* Legibility gradients */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0D1B2A]/70 via-[#0D1B2A]/40 to-[#0D1B2A]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,transparent_40%,#0D1B2A_100%)]" />
      </div>

      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl flex-col items-center justify-center px-6 pb-20 pt-32 text-center">
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]"
        >
          AI-Powered Sales Operating System
        </motion.p>

        <motion.h1
          id="hero-heading"
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="mt-6 max-w-4xl font-display text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-7xl"
        >
          Turn the Internet Into Your{" "}
          <span className="bg-gradient-to-r from-[#D4AF37] to-[#f0d878] bg-clip-text text-transparent">
            Sales Pipeline.
          </span>
        </motion.h1>

        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mt-6 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg"
        >
          Discover qualified prospects, understand their business, personalize
          outreach and manage your entire sales workflow with AI.
        </motion.p>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Link
            href="/signup"
            className="group inline-flex items-center gap-2 rounded-xl bg-[#D4AF37] px-7 py-3.5 text-sm font-semibold text-[#0D1B2A] shadow-[0_0_32px_rgba(212,175,55,0.35)] transition-all hover:bg-[#e2be4a] hover:shadow-[0_0_44px_rgba(212,175,55,0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
          >
            Start Building Your Pipeline
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:border-white/40 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
          >
            Explore Demo
          </Link>
        </motion.div>

        <motion.ul
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3"
          aria-label="Platform assurances"
        >
          {assurances.map((a) => (
            <li key={a.label} className="flex items-center gap-2 text-xs text-white/55">
              <a.icon className="h-4 w-4 text-[#D4AF37]" aria-hidden="true" />
              {a.label}
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
