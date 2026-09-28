"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  Radar,
  BrainCircuit,
  Megaphone,
  Send,
  Workflow,
  CheckSquare,
  BarChart3,
  Plug,
  ShieldCheck,
  Settings,
  Search,
  LogOut,
  ChevronDown,
  Sparkles,
  Crown,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { CommandPalette } from "./CommandPalette";

interface Org {
  id: string;
  name: string;
  role: string;
}

const NAV_MAIN = [
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard, live: true },
  { href: "/app/leads", label: "Leads", icon: Users, live: true },
  { href: "/app/crm", label: "CRM", icon: KanbanSquare, live: true },
  { href: "/app/discover", label: "Discover", icon: Radar, live: false },
  { href: "/app/intelligence", label: "Intelligence", icon: BrainCircuit, live: false },
  { href: "/app/campaigns", label: "Campaigns", icon: Megaphone, live: false },
  { href: "/app/outreach", label: "Outreach", icon: Send, live: false },
  { href: "/app/automation", label: "Automation", icon: Workflow, live: false },
  { href: "/app/tasks", label: "Tasks", icon: CheckSquare, live: false },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3, live: false },
];

const NAV_WORKSPACE = [
  { href: "/app/integrations", label: "Integrations", icon: Plug, live: false },
  { href: "/app/billing", label: "Billing", icon: Crown, live: false },
  { href: "/app/security", label: "Security", icon: ShieldCheck, live: false },
  { href: "/app/settings", label: "Settings", icon: Settings, live: false },
];

function setOrgCookie(orgId: string) {
  document.cookie = `wdd.org_id=${orgId}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function AppShell({
  user,
  orgs,
  activeOrgId,
  children,
  demo = false,
}: {
  user: { name: string | null; email: string };
  orgs: Org[];
  activeOrgId: string;
  children: React.ReactNode;
  /** Demo mode: fixture data only, real sign-out replaced with Exit Demo. */
  demo?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiNote, setAiNote] = useState(false);
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];

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

  async function signOut() {
    await authClient.signOut();
    router.push("/");
  }

  async function exitDemo() {
    try {
      await fetch("/api/demo/exit", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  function switchOrg(id: string) {
    setOrgCookie(id);
    router.refresh();
  }

  const navItem = (item: { href: string; label: string; icon: typeof Users; live: boolean }) => {
    const active = pathname === item.href;
    const Icon = item.icon;
    const cls = `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
      active
        ? "bg-[#D4AF37]/15 text-[#D4AF37]"
        : item.live
          ? "text-white/70 hover:bg-white/5 hover:text-white"
          : "cursor-not-allowed text-white/30"
    }`;
    return item.live ? (
      <Link key={item.href} href={item.href} className={cls} aria-current={active ? "page" : undefined}>
        <Icon size={18} />
        <span className="flex-1">{item.label}</span>
      </Link>
    ) : (
      <span key={item.href} className={cls} title="Coming soon">
        <Icon size={18} />
        <span className="flex-1">{item.label}</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          Soon
        </span>
      </span>
    );
  };

  return (
    <div className="flex min-h-screen bg-[#0D1B2A] text-white">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-white/10 bg-black/30 backdrop-blur lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D4AF37] font-bold text-black">
            W
          </div>
          <div>
            <p className="text-sm font-bold leading-tight">WDD AI SALES OS</p>
            <p className="text-[11px] text-white/50">Sales Operating System</p>
          </div>
        </div>

        {/* Workspace switcher */}
        <div className="px-4">
          <label className="px-1 text-[11px] uppercase tracking-wider text-white/40">
            Workspace
          </label>
          <div className="relative mt-1">
            <select
              aria-label="Active workspace"
              value={activeOrgId}
              onChange={(e) => switchOrg(e.target.value)}
              className="w-full appearance-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 pr-8 text-sm outline-none focus:border-[#D4AF37]"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id} className="bg-[#0D1B2A]">
                  {o.name} ({o.role})
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/50" />
          </div>
        </div>

        <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3" aria-label="Primary">
          {NAV_MAIN.map(navItem)}
          <p className="px-3 pb-1 pt-4 text-[11px] uppercase tracking-wider text-white/40">
            Workspace
          </p>
          {NAV_WORKSPACE.map(navItem)}
        </nav>

        <div className="space-y-2 border-t border-white/10 p-4">
          <button
            onClick={() => setAiNote(true)}
            className="flex w-full items-center gap-3 rounded-lg border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3 py-2 text-sm text-[#D4AF37] transition hover:bg-[#D4AF37]/20"
          >
            <Sparkles size={18} />
            AI Sales Assistant
          </button>
          {aiNote && (
            <p className="rounded-lg bg-white/5 p-2 text-xs text-white/60">
              The AI Sales Assistant arrives in Phase 3.{" "}
              <button onClick={() => setAiNote(false)} className="text-[#D4AF37] underline">
                Dismiss
              </button>
            </p>
          )}
          <div className="flex items-center gap-3 rounded-lg px-1 py-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-bold">
              {(user.name || user.email).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name || "User"}</p>
              <p className="truncate text-xs text-white/50">{user.email}</p>
            </div>
            {demo ? (
              <button
                onClick={exitDemo}
                title="Exit Demo"
                className="rounded-lg border border-[#D4AF37]/50 bg-[#D4AF37]/10 px-2.5 py-1.5 text-xs font-semibold text-[#D4AF37] transition hover:bg-[#D4AF37]/20"
              >
                Exit Demo
              </button>
            ) : (
              <button
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
                className="rounded p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-[#0D1B2A]/90 px-4 py-3 backdrop-blur">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/50 transition hover:border-white/20 hover:text-white/70"
          >
            <Search size={16} />
            <span className="hidden sm:inline">Search leads, jump to pages…</span>
            <span className="ml-auto hidden rounded bg-white/10 px-1.5 py-0.5 text-xs sm:inline">
              ⌘K
            </span>
          </button>
          <span className="hidden rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-1 text-xs font-medium text-[#D4AF37] md:inline">
            {activeOrg?.name}
          </span>
        </header>

        <main className="flex-1 p-4 pb-24 sm:p-6 lg:pb-6">{children}</main>

        {/* Mobile bottom nav */}
        <nav
          className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-around border-t border-white/10 bg-[#0D1B2A]/95 px-2 py-2 backdrop-blur lg:hidden"
          aria-label="Mobile"
        >
          {[
            { href: "/app/dashboard", label: "Home", icon: LayoutDashboard },
            { href: "/app/leads", label: "Leads", icon: Users },
            { href: "/app/crm", label: "CRM", icon: KanbanSquare },
          ].map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 rounded-lg px-4 py-1.5 text-[11px] ${
                  active ? "text-[#D4AF37]" : "text-white/60"
                }`}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        orgId={activeOrgId}
        apiBase={demo ? "/api/demo" : "/api"}
      />
    </div>
  );
}
