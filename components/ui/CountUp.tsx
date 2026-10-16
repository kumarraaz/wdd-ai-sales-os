"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated number. Server markup is the final value (no-JS and SEO safe); on
 * mount it counts up from zero, and on later prop changes it eases from what is
 * currently shown. Honours prefers-reduced-motion by jumping straight to the value.
 */
export function CountUp({
  value,
  decimals = 0,
  suffix = "",
  duration = 900,
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const shown = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    if (reduce || duration <= 0) {
      raf = requestAnimationFrame(() => {
        shown.current = value;
        setDisplay(value);
      });
      return () => cancelAnimationFrame(raf);
    }
    const from = shown.current;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (value - from) * eased;
      shown.current = next;
      setDisplay(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={className}>
      {display.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
