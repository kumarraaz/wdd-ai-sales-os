"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/ui/ProgressBar";

interface PlanInfo {
  name: string;
  tier: string;
  leads: { used: number; limit: number };
}

/**
 * Sidebar footer card (replaces the Figma "Unlock more signal" upsell). It only
 * ever shows the workspace's real plan and lead usage from /api/usage, and links
 * to the read-only plan page — there is no payment flow to advertise.
 */
export function SidebarPlanCard() {
  const [plan, setPlan] = useState<PlanInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/usage", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setPlan({
          name: data.plan?.name ?? "Free",
          tier: data.plan?.tier ?? "FREE",
          leads: data.usage?.leads ?? { used: 0, limit: 0 },
        });
      } catch {
        /* transient: keep whatever was shown */
      }
    };
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!plan) return null;

  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neon-lime">{plan.name} plan</p>
      <p className="mt-2 flex items-baseline justify-between text-xs text-ink-muted">
        <span>Leads</span>
        <span className="tnum text-ink">
          {plan.leads.used.toLocaleString("en-IN")} / {plan.leads.limit.toLocaleString("en-IN")}
        </span>
      </p>
      <ProgressBar value={plan.leads.used} max={plan.leads.limit} tone="lime" label="Lead quota used" className="mt-1.5" />
      <Link
        href="/billing"
        className="mt-3 inline-flex min-h-9 items-center text-xs font-semibold text-neon-lime hover:underline"
      >
        Plan &amp; usage →
      </Link>
    </div>
  );
}
