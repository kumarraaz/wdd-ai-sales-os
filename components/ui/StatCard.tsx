import type { LucideIcon } from "lucide-react";
import AnimatedCounter from "./AnimatedCounter";

interface Props {
  icon: LucideIcon;
  value: number;
  format?: "inr" | "num" | "plain";
  label: string;
  sub?: string;
  dark?: boolean;
}

export default function StatCard({ icon: Icon, value, format, label, sub, dark = false }: Props) {
  return (
    <div
      className={
        dark
          ? "rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm"
          : "rounded-2xl border border-charcoal-100 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(11,35,24,0.12)]"
      }
    >
      <div
        className={
          dark
            ? "flex h-10 w-10 items-center justify-center rounded-xl bg-moss-400/15 text-moss-300"
            : "flex h-10 w-10 items-center justify-center rounded-xl bg-forest-50 text-forest-700"
        }
      >
        <Icon className="h-5 w-5" />
      </div>
      <p
        className={`tnum mt-4 font-display text-3xl font-bold tracking-tight ${
          dark ? "text-white" : "text-forest-950"
        }`}
      >
        <AnimatedCounter to={value} format={format} />
      </p>
      <p className={`mt-1 text-sm font-semibold ${dark ? "text-forest-100" : "text-charcoal-800"}`}>
        {label}
      </p>
      {sub && <p className={`mt-0.5 text-xs ${dark ? "text-forest-200/70" : "text-charcoal-500"}`}>{sub}</p>}
    </div>
  );
}
