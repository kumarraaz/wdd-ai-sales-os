"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsLeft, ChevronsRight, Menu, Search } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { AccountMenu } from "./AccountMenu";
import { Brand } from "./Brand";
import { CommandPalette } from "./CommandPalette";
import { MobileDrawer } from "./MobileDrawer";
import { NavList } from "./NavList";
import { NotificationBell } from "./NotificationBell";
import { RunCompletionBanner } from "./RunCompletionBanner";
import { SidebarPlanCard } from "./SidebarPlanCard";
import { WorkspaceSwitcher, type Org } from "./WorkspaceSwitcher";
import { MOBILE_NAV_ITEMS } from "./mobile-nav";
import { breadcrumbsFor, findNavItem, isNavActive } from "./nav";
import { NAV_ICONS } from "./nav-icons";

const COLLAPSE_KEY = "wdd.sidebar.collapsed";

/**
 * Authenticated application shell (Figma: sidebar + top bar + content canvas).
 * Auth, workspace and demo behaviour are unchanged: the server layout resolves
 * the session/membership and passes plain props; this component only renders
 * and navigates.
 */
export function AppShell({
  user,
  orgs,
  activeOrgId,
  children,
  demo = false,
  automationPaused = false,
}: {
  user: { name: string | null; email: string };
  orgs: Org[];
  activeOrgId: string;
  children: React.ReactNode;
  /** Demo mode: fixture data only, real sign-out replaced with Exit Demo. */
  demo?: boolean;
  /** True when the operator kill switch has paused automation (server-resolved). */
  automationPaused?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl K");
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const crumbs = breadcrumbsFor(pathname);
  const current = findNavItem(pathname);

  // Dark scrollbars (the global ones are light, for marketing) while the shell is mounted.
  useEffect(() => {
    document.documentElement.classList.add("app-dark");
    return () => document.documentElement.classList.remove("app-dark");
  }, []);

  // Restore the sidebar preference and pick the right shortcut hint. State is set
  // in a rAF callback, and storage access is guarded (private mode / blocked storage).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
      } catch {
        /* storage unavailable: default (expanded) */
      }
      if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setShortcut("⌘K");
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* preference just won't persist */
    }
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
  }

  async function exitDemo() {
    try {
      await fetch("/api/demo/exit", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  const statusPill = demo ? (
    <Badge tone="amber" dot>
      Demo data
    </Badge>
  ) : automationPaused ? (
    <span title="The operator kill switch has paused automation. Manual actions still work.">
      <Badge tone="amber" dot>
        Automation paused
      </Badge>
    </span>
  ) : (
    <span title="App online. Automation is enabled.">
      <Badge tone="cyan" dot live>
        System live
      </Badge>
    </span>
  );

  return (
    <ConfirmProvider>
      <div className="app-canvas min-h-dvh font-ui">
        <a
          href="#main-content"
          className="sr-only z-50 rounded-control bg-neon-cyan px-4 py-2 text-sm font-semibold text-[#021614] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to main content
        </a>

        {/* Sidebar (desktop) */}
        <aside
          aria-label="Sidebar"
          className={cn(
            "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-canvas/85 backdrop-blur-xl transition-[width] duration-200 motion-reduce:transition-none lg:flex",
            collapsed ? "w-[76px]" : "w-60",
          )}
        >
          <div className={cn("flex h-[68px] items-center border-b border-line", collapsed ? "justify-center" : "px-5")}>
            <Link href="/dashboard" aria-label="WDD AI Sales OS — Overview" className="rounded-md">
              <Brand compact={collapsed} />
            </Link>
          </div>

          <div className={cn("pt-4", collapsed ? "px-3" : "px-4")}>
            <WorkspaceSwitcher orgs={orgs} activeOrgId={activeOrgId} collapsed={collapsed} />
          </div>

          <nav aria-label="Primary" className={cn("mt-5 flex-1 overflow-y-auto pb-4", collapsed ? "px-3" : "px-3")}>
            <NavList pathname={pathname} collapsed={collapsed} />
          </nav>

          <div className={cn("space-y-3 border-t border-line p-3", collapsed && "flex flex-col items-center")}>
            {!demo && !collapsed && <SidebarPlanCard />}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "flex min-h-10 items-center gap-2 rounded-control px-3 text-xs font-medium text-ink-muted transition hover:bg-tint/10 hover:text-ink",
                collapsed ? "w-10 justify-center px-0" : "w-full",
              )}
            >
              {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
              {!collapsed && "Collapse"}
            </button>
          </div>
        </aside>

        {/* Main column */}
        <div
          className={cn(
            "flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200 motion-reduce:transition-none",
            collapsed ? "lg:pl-[76px]" : "lg:pl-60",
          )}
        >
          <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-xl">
            <div className="flex h-[68px] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation menu"
                aria-haspopup="dialog"
                aria-controls="mobile-drawer"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-tint/10 hover:text-ink lg:hidden"
              >
                <Menu size={20} />
              </button>

              <div className="min-w-0 flex-1">
                <nav aria-label="Breadcrumb">
                  <ol className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                    {crumbs.map((c, i) => (
                      <li key={`${c}-${i}`} className="flex items-center gap-1.5">
                        {i > 0 && (
                          <span aria-hidden="true" className="text-ink-dim">
                            /
                          </span>
                        )}
                        <span
                          aria-current={i === crumbs.length - 1 ? "page" : undefined}
                          className={cn(i === crumbs.length - 1 && "text-ink")}
                        >
                          {c}
                        </span>
                      </li>
                    ))}
                  </ol>
                </nav>
                <p className="truncate text-lg font-semibold leading-tight tracking-tight text-ink sm:text-[22px]">
                  {current?.title ?? "WDD AI Sales OS"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Search leads and pages"
                aria-haspopup="dialog"
                className="flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-control border border-line bg-surface text-[13px] text-ink-muted transition hover:border-line-strong hover:text-ink md:h-10 md:w-[245px] md:justify-start md:px-3"
              >
                <Search size={16} aria-hidden="true" className="shrink-0" />
                <span className="hidden flex-1 truncate text-left md:inline">Search leads, pages…</span>
                <kbd className="hidden rounded border border-line-strong px-1.5 py-0.5 text-[10px] text-ink-dim md:inline">
                  {shortcut}
                </kbd>
              </button>

              <div className="hidden lg:block">{statusPill}</div>

              {!demo && <NotificationBell apiBase="/api" />}

              <AccountMenu
                name={user.name}
                email={user.email}
                role={activeOrg?.role}
                orgName={activeOrg?.name}
                demo={demo}
                onSignOut={signOut}
                onExitDemo={exitDemo}
              />
            </div>
          </header>

          {!demo && <RunCompletionBanner apiBase="/api" />}

          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-28 pt-6 outline-none sm:px-6 lg:px-8 lg:pb-10"
          >
            {children}
          </main>

          {/* Mobile bottom nav: six key modules, safe-area aware. The drawer holds everything else. */}
          <nav
            className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 backdrop-blur-xl lg:hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            aria-label="Mobile"
          >
            <div className="grid grid-cols-6 px-1 pt-1.5">
              {MOBILE_NAV_ITEMS.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                const active = isNavActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 text-[10px] font-medium transition",
                      active ? "text-neon-cyan" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    <Icon size={20} aria-hidden="true" className="shrink-0" />
                    <span className="max-w-full truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>

        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <WorkspaceSwitcher orgs={orgs} activeOrgId={activeOrgId} />
          <nav aria-label="All pages">
            <NavList pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </nav>
          <div className="lg:hidden">{statusPill}</div>
        </MobileDrawer>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          orgId={activeOrgId}
          apiBase={demo ? "/api/demo" : "/api"}
        />
      </div>
    </ConfirmProvider>
  );
}
