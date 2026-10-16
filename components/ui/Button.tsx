import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "lime" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition duration-150 " +
  "active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-neon-cyan font-semibold text-[#021614] hover:shadow-glow-cyan hover:brightness-110",
  lime: "bg-neon-lime font-semibold text-[#0e1a02] hover:shadow-glow-lime hover:brightness-105",
  secondary: "border border-line-strong bg-surface-2 text-ink hover:border-neon-cyan/50 hover:bg-tint/10",
  ghost: "text-ink-muted hover:bg-tint/10 hover:text-ink",
  danger: "border border-red-400/40 bg-red-400/10 text-red-200 hover:bg-red-400/20",
};

// 44px minimum tap target on touch-sized screens, denser on desktop.
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 text-xs sm:min-h-9",
  md: "min-h-11 px-4 text-sm sm:min-h-10",
  lg: "min-h-12 px-5 text-sm",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  block = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}): string {
  return cn(BASE, VARIANT[variant], SIZE[size], block && "w-full", className);
}

type CommonProps = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; children: ReactNode };

export function Button({
  variant,
  size,
  block,
  loading = false,
  disabled,
  className,
  type = "button",
  children,
  ...rest
}: CommonProps & { loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, block, className })}
      {...rest}
    >
      {loading && <Loader2 aria-hidden="true" size={16} className="animate-spin motion-reduce:animate-none" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant,
  size,
  block,
  className,
  children,
  ...rest
}: CommonProps & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={buttonClass({ variant, size, block, className })} {...rest}>
      {children}
    </Link>
  );
}
