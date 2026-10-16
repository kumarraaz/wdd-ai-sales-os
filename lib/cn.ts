/** Join class names, skipping falsy values. (The repo has no clsx/tailwind-merge.) */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** CSS custom property for staggered entrance (see `.rise-in` in globals.css). */
export function stagger(index: number): React.CSSProperties {
  return { "--i": index } as React.CSSProperties;
}
