"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LampIllustration } from "./LampIllustration";

/**
 * Cinematic login scene: darkness -> lamp on -> light spreads -> card reveal ->
 * idle -> user-toggleable light.
 *
 * Timeline (ms after hydration):
 *   0     phase "dark"  nearly black room, unlit lamp silhouette
 *   600   phase "lit"   lamp switches on (beam, bloom, wall and floor fade in)
 *   1200  phase "card"  login card and its fields reveal, staggered
 *   ~2000 idle: slow glow pulse, swaying pull cord, dust motes
 *
 * The server renders phase "dark" with the card hidden, so there is never a flash
 * of the lit screen. All motion is CSS transition/animation on opacity and
 * transform (see globals.css); this component only owns state.
 *
 * The lamp is purely visual: it has no connection to authentication, sessions or
 * permissions. It never switches itself off.
 */

type Phase = "dark" | "lit" | "card";

const LIGHT_ON_AT = 600;
const CARD_AT = 1200;

// Fixed values (no Math.random) so server and client markup match.
const DUST: ReadonlyArray<readonly [left: number, top: number, delay: number, duration: number, size: number]> = [
  [34, 42, 0, 9, 2],
  [46, 55, 1.4, 11, 3],
  [58, 38, 2.2, 10, 2],
  [40, 68, 3.1, 12, 2],
  [52, 72, 0.7, 9.5, 3],
  [63, 60, 4.0, 11.5, 2],
  [28, 58, 5.2, 10.5, 2],
  [70, 48, 2.8, 12.5, 2],
  [47, 82, 6.1, 9, 3],
  [36, 78, 1.9, 13, 2],
  [60, 80, 4.6, 10, 2],
  [50, 48, 3.6, 11, 2],
];

export function LampLoginScene({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("dark");
  const [lampOn, setLampOn] = useState(false);
  const [pulled, setPulled] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const frame = useRef<number | null>(null);
  const touched = useRef(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // No cinematic sequence: go straight to the finished state. CSS already
      // shows that state before hydration, so there is no visible change.
      frame.current = requestAnimationFrame(() => {
        setLampOn(true);
        setPhase("card");
      });
    } else {
      timers.current.push(
        setTimeout(() => {
          if (touched.current) return;
          setLampOn(true);
          setPhase("lit");
        }, LIGHT_ON_AT),
        setTimeout(() => {
          if (touched.current) return;
          setPhase("card");
        }, CARD_AT),
      );
    }
    return clearTimers;
  }, [clearTimers]);

  const toggle = useCallback(() => {
    // A user action takes over from the intro: skip any pending steps.
    touched.current = true;
    clearTimers();
    setPhase("card");
    setLampOn((on) => !on);
    setPulled(true);
    timers.current.push(setTimeout(() => setPulled(false), 220));
  }, [clearTimers]);

  return (
    <main
      className="lamp-scene relative isolate min-h-dvh overflow-hidden bg-[#050507] text-white"
      data-phase={phase}
      data-lamp={lampOn ? "on" : "off"}
      data-pulled={pulled ? "true" : undefined}
      style={{ "--lamp-intensity": lampOn ? 1 : 0 } as React.CSSProperties}
    >
      {/* Without JS the page must still be usable: show the finished scene. */}
      <noscript>
        <style>{`.lamp-scene{--lamp-intensity:1 !important}.lamp-reveal,.lamp-item{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      {/* Room: wall and floor light up as the lamp comes on. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="lamp-wall absolute inset-0" />
        <div className="lamp-floor absolute inset-x-0 bottom-0 h-[30%]" />
      </div>

      <div className="relative mx-auto grid min-h-dvh w-full max-w-7xl items-center gap-4 px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8 lg:grid-cols-2 lg:gap-16 lg:px-12">
        <section className="relative flex items-center justify-center" aria-label="Ambient lamp">
          <div className="lamp-stage relative aspect-[300/520] h-44 sm:h-52 lg:h-[520px]">
            {/* Wide cone of light spreading across the room from the shade. */}
            <div aria-hidden="true" className="lamp-cone pointer-events-none absolute" />

            <button
              type="button"
              role="switch"
              aria-checked={lampOn}
              aria-label="Lamp light"
              title="Pull the cord to toggle the light"
              onClick={toggle}
              className="relative z-10 block h-full w-full cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-wdd-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050507]"
            >
              <LampIllustration />
            </button>

            {/* Floating dust in the beam: desktop only, to keep phones smooth. */}
            <div aria-hidden="true" className="lamp-dust-field pointer-events-none absolute inset-0 hidden lg:block">
              {DUST.map(([left, top, delay, duration, size], i) => (
                <span
                  key={i}
                  className="lamp-dust absolute rounded-full bg-[#FFE2B0]"
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: size,
                    height: size,
                    animationDelay: `${delay}s`,
                    animationDuration: `${duration}s`,
                  }}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-md">
          <div className="lamp-reveal relative">
            <div aria-hidden="true" className="lamp-card-glow pointer-events-none absolute -inset-px rounded-[20px]" />
            <div className="lamp-card-dim">{children}</div>
          </div>
          <p className="lamp-item mt-6 text-center text-xs text-white/40" style={{ transitionDelay: "800ms" }}>
            Secure access to your sales workspace.
          </p>
        </section>
      </div>
    </main>
  );
}
