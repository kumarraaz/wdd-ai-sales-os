"use client";

import {
  Fingerprint,
  Users,
  ScrollText,
  Gauge,
  Globe,
  KeyRound,
  Webhook,
  OctagonX,
} from "lucide-react";
import Reveal from "@/components/ui/Reveal";

const items = [
  {
    icon: Fingerprint,
    title: "Strict tenant isolation",
    text: "Every record belongs to an organization/workspace. Org A can never see Org B's leads, campaigns, messages or keys — enforced server-side, tested by automated isolation tests.",
  },
  {
    icon: Users,
    title: "RBAC with five roles",
    text: "Owner, Admin, Sales Manager, Sales Executive and Viewer. Every protected API route verifies authentication, authorization and workspace access — never trusting the client.",
  },
  {
    icon: ScrollText,
    title: "Audit logs",
    text: "Who did what, when, where — approvals, sends, status changes and security events, all recorded and reviewable.",
  },
  {
    icon: Gauge,
    title: "Rate limits & quotas",
    text: "Per-user and per-workspace quotas on discovery, AI usage, messages and API calls, with cooldowns and abuse signals monitored.",
  },
  {
    icon: Globe,
    title: "SSRF & URL protection",
    text: "User-submitted URLs are validated; localhost, private IP ranges and cloud metadata endpoints are blocked before any fetch.",
  },
  {
    icon: KeyRound,
    title: "Encrypted credentials",
    text: "Integration secrets are encrypted at rest, never returned in full to the frontend, and never placed in client-side code.",
  },
  {
    icon: Webhook,
    title: "Webhook verification",
    text: "Inbound webhooks require signature verification, so spoofed delivery or reply events can't corrupt your pipeline.",
  },
  {
    icon: OctagonX,
    title: "Kill switches",
    text: "Per-campaign STOP plus a workspace-wide PAUSE ALL AUTOMATIONS that immediately halts scheduled outreach.",
  },
];

export default function Security() {
  return (
    <section
      id="security"
      aria-labelledby="security-heading"
      className="relative py-24 sm:py-32"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-transparent via-white/[0.02] to-transparent"
      />
      <div className="relative mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            Security
          </p>
          <h2
            id="security-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            Security is the foundation, not a feature
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            A public lead-generation platform is a target. WDD AI SALES OS is
            built with defense in depth — from input validation to emergency
            stop controls.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, i) => (
            <Reveal key={item.title} delay={Math.min((i % 4) * 0.07, 0.21)}>
              <article className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur transition-colors hover:border-[#D4AF37]/40">
                <item.icon className="h-5 w-5 text-[#D4AF37]" aria-hidden="true" />
                <h3 className="mt-3 font-display text-sm font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{item.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
