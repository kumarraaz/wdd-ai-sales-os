"use client";

import Reveal from "@/components/ui/Reveal";
import FAQ from "@/components/ui/FAQ";

const faqs = [
  {
    q: "What is WDD AI SALES OS?",
    a: "An AI-powered sales operating system that carries a prospect from discovery to closed deal: lead discovery, enrichment, AI scoring, research, personalized outreach, campaigns, follow-ups, automation and analytics — all from one dashboard.",
  },
  {
    q: "How does lead discovery work without breaking platform rules?",
    a: "Discovery uses only permitted sources: public business information, official APIs, your own CSV imports and manually added leads. Anything requiring a login shows “Connect Account” or “Use Official API” — the platform never bypasses logins, CAPTCHAs or anti-bot systems.",
  },
  {
    q: "Is my data isolated from other users?",
    a: "Yes. Every lead, campaign, message and credential belongs to your organization/workspace, and tenant isolation is enforced on the server for every request — backed by automated isolation tests.",
  },
  {
    q: "Do I need API keys to start?",
    a: "No. The free plan works out of the box with demo discovery, CSV import, the CRM, AI scoring and manual outreach. You only add keys (email provider, WhatsApp Business, AI provider) when you want automated sending or deeper enrichment.",
  },
  {
    q: "What does “approval required” mean?",
    a: "Before any external message is sent, you see the recipient, channel, message, personalization used and potential risk — and you explicitly approve it. It's the default mode, and you can also pause or kill all outreach instantly.",
  },
  {
    q: "Can I trust the AI's research about a company?",
    a: "The platform separates verified data (with clickable sources and retrieval dates) from AI inference (clearly labeled as such). It never invents employees, revenue, contacts or business activities — and says “not enough verified information” when that's the truth.",
  },
];

export default function FAQSection() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            FAQ
          </p>
          <h2
            id="faq-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            Questions, answered
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="mt-10">
          <FAQ items={faqs} />
        </Reveal>
      </div>
    </section>
  );
}
