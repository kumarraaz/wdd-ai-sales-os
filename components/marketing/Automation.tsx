"use client";

import { ArrowDown, ShieldCheck, Pause } from "lucide-react";
import Reveal from "@/components/ui/Reveal";

const flow = [
  { kind: "trigger", label: "New qualified lead discovered" },
  { kind: "condition", label: "Lead score > 70" },
  { kind: "action", label: "Research company" },
  { kind: "action", label: "Generate personalized email" },
  { kind: "approval", label: "Wait for human approval" },
  { kind: "action", label: "Send email" },
  { kind: "delay", label: "Wait 3 days" },
  { kind: "condition", label: "No reply received" },
  { kind: "action", label: "Generate follow-up draft" },
];

const kindStyles: Record<string, string> = {
  trigger: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  condition: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  action: "border-[#D4AF37]/30 bg-[#D4AF37]/10 text-[#f0d878]",
  approval: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  delay: "border-white/15 bg-white/[0.05] text-white/70",
};

const kindLabels: Record<string, string> = {
  trigger: "Trigger",
  condition: "Condition",
  action: "Action",
  approval: "Approval",
  delay: "Delay",
};

const safeguards = [
  { icon: ShieldCheck, text: "Approval-required is the default for every external message." },
  { icon: Pause, text: "Per-campaign pause and a workspace-wide STOP ALL OUTREACH kill switch." },
];

export default function Automation() {
  return (
    <section
      id="automation"
      aria-labelledby="automation-heading"
      className="relative py-24 sm:py-32"
    >
      <div className="mx-auto max-w-7xl px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#D4AF37]">
            Automation
          </p>
          <h2
            id="automation-heading"
            className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            Visual workflows with a human in the loop
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Build trigger → condition → action sequences in a visual builder.
            Automation does the heavy lifting; nothing external goes out
            without your approval unless you explicitly allow it.
          </p>
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-5xl gap-10 lg:grid-cols-2">
          <Reveal>
            <div
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur"
              role="img"
              aria-label="Illustration of an automation workflow: new qualified lead, score above 70, research company, generate email, wait for approval, send, wait 3 days, generate follow-up"
            >
              <ol className="flex flex-col items-stretch">
                {flow.map((step, i) => (
                  <li key={i} className="flex flex-col items-center">
                    <div
                      className={`w-full rounded-xl border px-4 py-3 text-center text-sm font-medium ${kindStyles[step.kind]}`}
                    >
                      <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                        {kindLabels[step.kind]}
                      </span>
                      {step.label}
                    </div>
                    {i < flow.length - 1 && (
                      <ArrowDown className="my-1 h-4 w-4 text-white/25" aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>

          <div className="flex flex-col justify-center">
            <Reveal delay={0.1}>
              <h3 className="font-display text-xl font-semibold text-white">
                Automation you can trust with your reputation
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                Follow-up sequences stop automatically when a lead replies, a
                meeting is booked, or you hit stop. Every automated step is
                written to the audit log — who approved what, and when.
              </p>
            </Reveal>
            <ul className="mt-6 space-y-4">
              {safeguards.map((s, i) => (
                <Reveal key={s.text} delay={0.15 + i * 0.08}>
                  <li className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/75">
                    <s.icon className="mt-0.5 h-5 w-5 shrink-0 text-[#D4AF37]" aria-hidden="true" />
                    {s.text}
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
