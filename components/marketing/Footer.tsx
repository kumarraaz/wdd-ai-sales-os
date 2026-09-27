"use client";

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";

const productLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

const accountLinks = [
  { label: "Sign in", href: "/login" },
  { label: "Create account", href: "/signup" },
  { label: "Explore demo", href: "/login" },
];

export default function Footer() {
  const [showAppNote, setShowAppNote] = useState(false);

  return (
    <footer className="border-t border-white/10 bg-[#0A1420]">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="font-display text-sm font-bold tracking-[0.18em] text-white">
              WDD <span className="text-[#D4AF37]">AI SALES OS</span>
            </p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/55">
              The AI-powered sales operating system — discover, enrich,
              qualify, personalize, outreach, follow up and convert, all from
              one dashboard.
            </p>
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setShowAppNote((v) => !v)}
                aria-expanded={showAppNote}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-white/30 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D4AF37]"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download App
              </button>
              {showAppNote && (
                <p role="status" className="mt-2 text-xs text-[#f0d878]">
                  Mobile App Coming Soon
                </p>
              )}
            </div>
          </div>

          <nav aria-label="Product">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
              Product
            </p>
            <ul className="mt-4 space-y-2.5">
              {productLinks.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="rounded text-sm text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Account">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
              Account
            </p>
            <ul className="mt-4 space-y-2.5">
              {accountLinks.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="rounded text-sm text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-white/40">
            © 2026 WDD AI SALES OS · Web Digital Development
          </p>
          <p className="text-xs text-white/40">
            Built for teams that sell on substance, not spam.
          </p>
        </div>
      </div>
    </footer>
  );
}
