"use client";

import { Bot, Check } from "lucide-react";
import Reveal from "@/components/ui/Reveal";

const capabilities = [
  "Research a lead and summarize the company",
  "Generate a personalized sales angle",
  "Draft emails, WhatsApp and LinkedIn messages",
  "Write follow-ups and call scripts",
  "Summarize conversations and classify replies",
  "Suggest the next best action per lead",
];

const chat = [
  { role: "user", text: "Write a personalized email for Acme Industrial Exports." },
  {
    role: "assistant",
    text: "Based on verified data — Ahmedabad-based exporter, freight forwarding services — here's a draft grounded in their public profile. No invented facts.",
  },
];

export default function AIAssistant() {
  return (
    <section
      id="ai-assistant"
      aria-labelledby="ai-assistant-heading"
      className="relative py-24 sm:py-32"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-transparent via-[#D4AF37]/[0.03] to-transparent"
      />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
        <Reveal delay={0.1} className="order-2 lg:order-1">
          <div
            className="rounded-2xl border border-white/10 bg-[#0A1420]/80 p-6 backdrop-blur"
            role="img"
            aria-label="Illustration of the AI sales assistant drafting a personalized email from verified lead data"
          >
            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D4AF37]/15">
                <Bot className="h-5 w-5 text-[#D4AF37]" aria-hidden="true" />
              </div>
              <div>
                <p className="font-display text-sm font-semibold text-white">AI Sales Assistant</p>
                <p className="flex items-center gap-1.5 text-xs text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  Grounded in verified data
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {chat.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-8 rounded-xl rounded-br-sm bg-[#D4AF37]/15 p-3.5 text-sm text-white/85"
                      : "mr-8 rounded-xl rounded-bl-sm border border-white/10 bg-white/[0.05] p-3.5 text-sm text-white/70"
                  }
                >
                  {m.text}
                </div>
              ))}
              <div className="mr-8 rounded-xl border border-dashed border-[#D4AF37]/30 bg-[#D4AF37]/5 p-3.5">
                <p className="text-xs font-semibold text-[#D4AF37]">Subject</p>
                <p className="mt-1 text-sm text-white/80">
                  Export documentation support for Acme Industrial
                </p>
                <p className="mt-2 text-xs font-semibold text-[#D4AF37]">Opening</p>
                <p className="mt-1 text-sm text-white/70">
                  “Noticed Acme handles freight forwarding across Gujarat — most
                  exporters we work with lose days to documentation back-and-forth…”
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal className="order-1 lg:order-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            AI Sales Assistant
          </p>
          <h2
            id="ai-assistant-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            A copilot that does the research, you close the deal
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            The assistant works only from verified lead information, your notes
            and conversation history. External webpage content is treated as
            untrusted data — it can inform, never instruct.
          </p>
          <ul className="mt-8 space-y-3">
            {capabilities.map((c) => (
              <li key={c} className="flex items-start gap-3 text-sm text-white/75">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#D4AF37]/15">
                  <Check className="h-3 w-3 text-[#D4AF37]" aria-hidden="true" />
                </span>
                {c}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
