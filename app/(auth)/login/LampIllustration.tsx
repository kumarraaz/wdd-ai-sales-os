import { useId } from "react";

/**
 * Pure-SVG floor lamp. Every light-dependent layer carries a `lamp-*` class and
 * is driven by `--lamp-intensity` (0 | 1) from the surrounding `.lamp-scene`, so
 * the beam, bloom, bulb and shade all respond to the same React state. Gradient
 * ids are namespaced with useId so the component is safe to render more than once.
 * Decorative: the interactive switch lives on the wrapping <button>.
 */
export function LampIllustration() {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}-${uid}`;
  const ref = (name: string) => `url(#${id(name)})`;

  return (
    <svg viewBox="0 0 300 520" aria-hidden="true" focusable="false" className="h-full w-full overflow-visible">
      <defs>
        <linearGradient id={id("shadeOn")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E6B66C" />
          <stop offset="48%" stopColor="#FFE6B5" />
          <stop offset="100%" stopColor="#C88A43" />
        </linearGradient>
        <linearGradient id={id("shadeOff")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1B1816" />
          <stop offset="50%" stopColor="#2C2723" />
          <stop offset="100%" stopColor="#171412" />
        </linearGradient>
        {/* Cylinder shading painted over both states so the shade reads as a volume. */}
        <linearGradient id={id("shadeShade")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000" stopOpacity="0.38" />
          <stop offset="30%" stopColor="#000" stopOpacity="0" />
          <stop offset="70%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={id("stand")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1E1B19" />
          <stop offset="45%" stopColor="#7A736B" />
          <stop offset="100%" stopColor="#1E1B19" />
        </linearGradient>
        <linearGradient id={id("beam")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD79A" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#F59A35" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#F59A35" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id("glow")}>
          <stop offset="0%" stopColor="#FFD99A" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#F59A35" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("bulb")}>
          <stop offset="0%" stopColor="#FFF4D6" stopOpacity="1" />
          <stop offset="45%" stopColor="#FFC66F" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#F59A35" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ambient bloom around the shade (outer wrapper = state, inner = idle pulse). */}
      <g className="lamp-ambient">
        <ellipse className="lamp-pulse" cx="150" cy="160" rx="150" ry="150" fill={ref("glow")} />
      </g>

      {/* Light beam: expands down and outwards when the lamp switches on. */}
      <path className="lamp-beam" d="M104 158 L6 474 L294 474 L196 158 Z" fill={ref("beam")} />

      {/* Stand and base */}
      <ellipse cx="150" cy="452" rx="62" ry="10" fill="#000" opacity="0.55" />
      <rect x="147" y="172" width="6" height="268" rx="3" fill={ref("stand")} />
      <ellipse cx="150" cy="447" rx="53" ry="13" fill="#232225" />
      <ellipse cx="150" cy="443" rx="39" ry="7" fill="#4A443E" />

      {/* Shade: dark body always present, warm layer fades in over it. */}
      <rect x="143" y="72" width="14" height="12" rx="3" fill="#2A2623" />
      <path
        d="M100 125 Q106 90 120 82 L180 82 Q194 90 200 125 L218 155 Q150 174 82 155 Z"
        fill={ref("shadeOff")}
        stroke="rgba(255,255,255,0.08)"
      />
      <path
        className="lamp-shade-lit"
        d="M100 125 Q106 90 120 82 L180 82 Q194 90 200 125 L218 155 Q150 174 82 155 Z"
        fill={ref("shadeOn")}
      />
      <path
        d="M100 125 Q106 90 120 82 L180 82 Q194 90 200 125 L218 155 Q150 174 82 155 Z"
        fill={ref("shadeShade")}
      />

      {/* Underside of the shade: dark when off, lit when on. */}
      <ellipse cx="150" cy="158" rx="66" ry="9" fill="#120F0D" />
      <ellipse className="lamp-shade-lit" cx="150" cy="158" rx="66" ry="9" fill="#FFD79A" />

      {/* Bulb: ember when off, glowing when on. */}
      <circle cx="150" cy="164" r="9" fill="#3A3029" />
      <g className="lamp-bulb">
        <circle cx="150" cy="164" r="38" fill={ref("bulb")} />
        <circle cx="150" cy="164" r="9" fill="#FFF0CC" />
      </g>

      {/* Pull cord: outer group sways like a pendulum, inner group handles the tug. */}
      <g className="lamp-cord-sway">
        <g className="lamp-cord-pull">
          <path
            d="M198 160 Q203 195 200 226 L201 250"
            fill="none"
            stroke="#C9BBA4"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="201" cy="255" r="5" fill="#C9BBA4" />
          <circle cx="199.8" cy="253.6" r="1.6" fill="#fff" opacity="0.5" />
        </g>
      </g>
    </svg>
  );
}
