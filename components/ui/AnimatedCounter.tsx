"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { inr, num } from "@/lib/format";

interface Props {
  to: number;
  duration?: number;
  /** Serializable format key (functions can't cross the RSC boundary) */
  format?: "inr" | "num" | "plain";
  suffix?: string;
  className?: string;
}

export default function AnimatedCounter({ to, duration = 1.6, format = "plain", suffix = "", className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);

  const base = format === "inr" ? inr(value) : format === "num" ? num(value) : Math.round(value).toLocaleString("en-IN");
  return (
    <span ref={ref} className={className}>
      {base}
      {suffix}
    </span>
  );
}
