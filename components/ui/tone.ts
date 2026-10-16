/**
 * Shared accent vocabulary for the neon design system. Class names are written
 * out in full so Tailwind's scanner picks every one of them up.
 */
export type Tone = "cyan" | "violet" | "pink" | "lime" | "blue" | "amber" | "red" | "muted";

export interface ToneClasses {
  /** foreground text / icon colour */
  text: string;
  /** soft translucent fill */
  soft: string;
  /** 1px tinted border */
  border: string;
  /** solid fill for dots and bars */
  solid: string;
  /** restrained neon edge + bloom */
  glow: string;
  /** hex for SVG/chart props that cannot take classes */
  hex: string;
}

export const TONE: Record<Tone, ToneClasses> = {
  cyan: {
    text: "text-neon-cyan",
    soft: "bg-neon-cyan/10",
    border: "border-neon-cyan/30",
    solid: "bg-neon-cyan",
    glow: "shadow-glow-cyan",
    hex: "#43f5e2",
  },
  violet: {
    text: "text-neon-violet",
    soft: "bg-neon-violet/10",
    border: "border-neon-violet/30",
    solid: "bg-neon-violet",
    glow: "shadow-glow-violet",
    hex: "#a78bfa",
  },
  pink: {
    text: "text-neon-pink",
    soft: "bg-neon-pink/10",
    border: "border-neon-pink/30",
    solid: "bg-neon-pink",
    glow: "shadow-glow-pink",
    hex: "#ff5cc8",
  },
  lime: {
    text: "text-neon-lime",
    soft: "bg-neon-lime/10",
    border: "border-neon-lime/30",
    solid: "bg-neon-lime",
    glow: "shadow-glow-lime",
    hex: "#c5ff6b",
  },
  blue: {
    text: "text-neon-blue",
    soft: "bg-neon-blue/10",
    border: "border-neon-blue/30",
    solid: "bg-neon-blue",
    glow: "shadow-glow-cyan",
    hex: "#4f8cff",
  },
  amber: {
    text: "text-amber-300",
    soft: "bg-amber-300/10",
    border: "border-amber-300/30",
    solid: "bg-amber-300",
    glow: "shadow-panel",
    hex: "#fcd34d",
  },
  red: {
    text: "text-red-300",
    soft: "bg-red-400/10",
    border: "border-red-400/30",
    solid: "bg-red-400",
    glow: "shadow-panel",
    hex: "#f87171",
  },
  muted: {
    text: "text-ink-muted",
    soft: "bg-tint/10",
    border: "border-line",
    solid: "bg-ink-dim",
    glow: "shadow-panel",
    hex: "#8a98b3",
  },
};
