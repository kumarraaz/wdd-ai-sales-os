"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cinematic left panel: a pure-SVG floor lamp (no external assets) whose pull
 * cord toggles the ambient glow. The cord is a real <button role="switch"> so it
 * works with keyboard and screen readers, and transitions respect
 * prefers-reduced-motion.
 */
export function LoginVisual() {
  const [lit, setLit] = useState(true);
  const [pulled, setPulled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function pull() {
    setLit((v) => !v);
    setPulled(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPulled(false), 160);
  }

  const fade = "transition-opacity duration-700 motion-reduce:transition-none";

  return (
    <section
      aria-label="WDD Sales OS"
      className="relative hidden min-h-[600px] items-center justify-center overflow-hidden rounded-3xl border border-wdd-line lg:flex"
    >
      {/* Ambient backdrop: warm when lit, near-black when off. */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#14100e] via-[#0d0b0a] to-wdd-bg" />
      <div
        className={`absolute inset-0 bg-gradient-to-br from-[#382416] via-[#17110F] to-wdd-bg ${fade}`}
        style={{ opacity: lit ? 1 : 0 }}
      />
      <div
        className={`absolute left-1/2 top-[34%] h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-wdd-amber/20 blur-3xl ${fade}`}
        style={{ opacity: lit ? 1 : 0 }}
      />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-between px-10 py-10">
        <div className="relative aspect-[400/560] w-full max-w-[300px]">
          <svg
            viewBox="0 0 400 560"
            className="h-full w-full"
            role="img"
            aria-label="A floor lamp casting warm light"
          >
            <defs>
              <radialGradient id="lv-bulb">
                <stop offset="0" stopColor="#FFE2A8" stopOpacity="1" />
                <stop offset="0.5" stopColor="#F59A35" stopOpacity="0.55" />
                <stop offset="1" stopColor="#F59A35" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="lv-cone" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#F59A35" stopOpacity="0.42" />
                <stop offset="1" stopColor="#F59A35" stopOpacity="0" />
              </linearGradient>
              <radialGradient id="lv-floor">
                <stop offset="0" stopColor="#F59A35" stopOpacity="0.45" />
                <stop offset="1" stopColor="#F59A35" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="lv-shade-lit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#F3C987" />
                <stop offset="1" stopColor="#C47A2B" />
              </linearGradient>
              <linearGradient id="lv-shade-off" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3A3430" />
                <stop offset="1" stopColor="#221E1B" />
              </linearGradient>
              <linearGradient id="lv-pole" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#1A1614" />
                <stop offset="0.5" stopColor="#4A403A" />
                <stop offset="1" stopColor="#1A1614" />
              </linearGradient>
              <filter id="lv-soft" x="-20%" y="-5%" width="140%" height="110%">
                <feGaussianBlur stdDeviation="7" />
              </filter>
            </defs>

            {/* Light on the floor and the cone of light */}
            <g className={fade} style={{ opacity: lit ? 1 : 0 }}>
              <ellipse cx="200" cy="512" rx="190" ry="34" fill="url(#lv-floor)" />
              <polygon points="150,196 250,196 392,512 8,512" fill="url(#lv-cone)" filter="url(#lv-soft)" />
            </g>

            {/* Base, pole, shade */}
            <ellipse cx="200" cy="514" rx="54" ry="8" fill="#000" opacity="0.6" />
            <ellipse cx="200" cy="506" rx="44" ry="7" fill="#1F1A17" />
            <ellipse cx="200" cy="503" rx="44" ry="6" fill="#2B2420" />
            <rect x="197" y="196" width="6" height="308" fill="url(#lv-pole)" />
            <rect x="190" y="104" width="20" height="8" rx="3" fill="#2B2420" />
            <path d="M156 112 L244 112 L270 196 L130 196 Z" fill="url(#lv-shade-off)" stroke="rgba(255,255,255,0.08)" />
            <path
              d="M156 112 L244 112 L270 196 L130 196 Z"
              fill="url(#lv-shade-lit)"
              className={fade}
              style={{ opacity: lit ? 1 : 0 }}
            />
            <ellipse cx="200" cy="196" rx="70" ry="8" fill="#14110F" />
            <g className={fade} style={{ opacity: lit ? 1 : 0 }}>
              <ellipse cx="200" cy="196" rx="70" ry="8" fill="#FFD79A" />
              <circle cx="200" cy="202" r="48" fill="url(#lv-bulb)" />
            </g>

            {/* Pull cord */}
            <line x1="236" y1="196" x2="236" y2="262" stroke="#8A6A3A" strokeWidth="1.5" />
            <circle
              cx="236"
              cy="268"
              r="5"
              fill="#D4AF37"
              style={{
                transform: `translateY(${pulled ? 10 : 0}px)`,
                transition: "transform 150ms ease-out",
              }}
              className="motion-reduce:transition-none"
            />
          </svg>

          {/* Hit target for the cord: 44px, keyboard focusable. */}
          <button
            type="button"
            role="switch"
            aria-checked={lit}
            aria-label="Ambient lamp light"
            onClick={pull}
            className="absolute left-[59%] top-[48%] h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-wdd-gold/70"
          />
        </div>

        <div className="max-w-sm text-center">
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-wdd-gold">WDD SALES OS</p>
          <h2 className="font-serif text-4xl leading-tight text-wdd-text">
            Every conversation.
            <br />
            A new opportunity.
          </h2>
          <p className="mt-4 text-sm leading-6 text-white/60">
            Your AI-powered workspace for smarter sales.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Compact branded header shown above the form on small screens (the lamp panel is desktop-only). */
export function LoginBrandHeader() {
  return (
    <div className="relative mb-6 flex items-center gap-4 overflow-hidden rounded-2xl border border-wdd-line px-5 py-4 lg:hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-[#382416] via-[#17110F] to-wdd-bg" />
      <svg viewBox="0 0 48 64" className="relative h-14 w-11 shrink-0" aria-hidden="true">
        <defs>
          <radialGradient id="lm-glow">
            <stop offset="0" stopColor="#FFE2A8" stopOpacity="0.9" />
            <stop offset="1" stopColor="#F59A35" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="24" cy="26" r="22" fill="url(#lm-glow)" />
        <path d="M14 8 L34 8 L40 26 L8 26 Z" fill="#E0A55A" />
        <rect x="22" y="26" width="4" height="32" fill="#4A403A" />
        <ellipse cx="24" cy="60" rx="11" ry="2.5" fill="#2B2420" />
      </svg>
      <div className="relative">
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-wdd-gold">WDD SALES OS</p>
        <p className="mt-1 font-serif text-lg leading-snug text-wdd-text">Every conversation. A new opportunity.</p>
      </div>
    </div>
  );
}
