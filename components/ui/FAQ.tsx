"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/format";

export interface Faq {
  q: string;
  a: string;
}

export default function FAQ({ items }: { items: Faq[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-charcoal-100 rounded-2xl border border-charcoal-100 bg-white">
      {items.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={i}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
              aria-expanded={isOpen}
            >
              <span className="font-display text-[15px] font-semibold text-forest-950">{f.q}</span>
              <ChevronDown
                className={cn("h-5 w-5 shrink-0 text-forest-700 transition-transform", isOpen && "rotate-180")}
              />
            </button>
            <div
              className={cn(
                "grid transition-all duration-300",
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              )}
            >
              <div className="overflow-hidden">
                <p className="px-6 pb-6 text-sm leading-relaxed text-charcoal-600">{f.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
