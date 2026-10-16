import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Full-page canvas for the account pages (sign-up, password reset, verification). */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="app-canvas flex min-h-dvh items-center justify-center px-4 py-10 font-ui">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

/** The card itself: eyebrow, the page's single h1, optional description, then the form. */
export function AuthCard({
  eyebrow = "WDD AI Sales OS",
  title,
  description,
  children,
  align = "left",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  align?: "left" | "center";
}) {
  return (
    <section
      className={cn(
        "rounded-card border border-line bg-surface p-6 shadow-panel sm:p-8",
        align === "center" && "text-center",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neon-cyan">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {description && <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p>}
      {children}
    </section>
  );
}

export const authInputClass =
  "mt-1.5 min-h-11 w-full rounded-control border border-line bg-black/30 px-3 text-sm text-ink outline-none transition placeholder:text-ink-dim focus:border-neon-cyan";

/** Label + input with an explicit id association. */
export function AuthField({
  id,
  label,
  hint,
  ...input
}: { id: string; label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-ink-muted">
        {label} {hint && <span className="font-normal text-ink-dim">{hint}</span>}
      </label>
      <input id={id} className={authInputClass} {...input} />
    </div>
  );
}
