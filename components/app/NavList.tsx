"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { NAV_SECTIONS, isNavActive } from "./nav";
import { NAV_ICONS } from "./nav-icons";

/**
 * Sidebar / drawer navigation. Every entry is a real link (no inert "coming soon"
 * spans): planned areas open an honest roadmap page instead of a dead end.
 */
export function NavList({
  pathname,
  collapsed = false,
  onNavigate,
}: {
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-5">
      {NAV_SECTIONS.map((section) => (
        <div key={section.id}>
          <p
            className={cn(
              "px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim",
              collapsed && "sr-only",
            )}
          >
            {section.label}
          </p>
          <ul className="space-y-1">
            {section.items.map((item) => {
              const active = isNavActive(pathname, item.href);
              const Icon = NAV_ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group flex min-h-11 items-center gap-3 rounded-control border px-3 text-[13px] transition duration-150 motion-reduce:transition-none lg:min-h-10",
                      collapsed && "justify-center px-0",
                      active
                        ? "border-neon-cyan bg-surface-2 font-medium text-ink"
                        : "border-transparent text-ink-muted hover:bg-tint/5 hover:text-ink",
                    )}
                  >
                    <Icon
                      size={18}
                      aria-hidden="true"
                      className={cn("shrink-0", active ? "text-neon-cyan" : "text-ink-dim group-hover:text-ink-muted")}
                    />
                    <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>{item.label}</span>
                    {item.status === "planned" && !collapsed && (
                      <span className="rounded-full border border-line-strong px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-ink-dim">
                        Planned
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
