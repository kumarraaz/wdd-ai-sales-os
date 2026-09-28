"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { LayoutDashboard, Users, KanbanSquare, Search } from "lucide-react";

const PAGES = [
  { href: "/app/dashboard", label: "Go to Dashboard", icon: LayoutDashboard },
  { href: "/app/leads", label: "Go to Leads", icon: Users },
  { href: "/app/crm", label: "Go to CRM", icon: KanbanSquare },
];

interface LeadHit {
  id: string;
  fullName: string | null;
  email: string | null;
  company: { name: string } | null;
}

export function CommandPalette({
  open,
  onOpenChange,
  orgId,
  apiBase = "/api",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  /** Demo mode passes "/api/demo" so lead search works against fixtures. */
  apiBase?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);

  // Stale results are cleared in the query-change handler, not synchronously
  // inside the effect (react-hooks/set-state-in-effect).
  const handleQueryChange = (v: string) => {
    setQ(v);
    if (v.trim().length < 2) setHits([]);
  };

  const handleClose = () => {
    setHits([]);
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `${apiBase}/leads?q=${encodeURIComponent(q)}&pageSize=5`,
          { headers: { "x-org-id": orgId } },
        );
        if (!res.ok) return;
        const data = await res.json();
        setHits(data.leads ?? []);
      } catch {
        /* offline — palette still works for navigation */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, orgId, apiBase]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={handleClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
        <Command
          label="Command palette"
          className="overflow-hidden rounded-xl border border-white/15 bg-[#101f33] shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-white/10 px-4">
            <Search size={16} className="text-white/40" />
            <Command.Input
              value={q}
              onValueChange={handleQueryChange}
              placeholder="Search leads or jump to a page…"
              className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-white/40"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-white/40">
              No results. Try a lead name, email, or company.
            </Command.Empty>
            <Command.Group heading="Pages" className="px-2 py-1 text-[11px] uppercase tracking-wider text-white/40">
              {PAGES.map((p) => (
                <Command.Item
                  key={p.href}
                  value={p.label}
                  onSelect={() => {
                    router.push(p.href);
                    handleClose();
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/80 aria-selected:bg-white/10"
                >
                  <p.icon size={16} className="text-[#D4AF37]" />
                  {p.label}
                </Command.Item>
              ))}
            </Command.Group>
            {hits.length > 0 && (
              <Command.Group heading="Leads" className="px-2 py-1 text-[11px] uppercase tracking-wider text-white/40">
                {hits.map((h) => (
                  <Command.Item
                    key={h.id}
                    value={`${h.fullName} ${h.email} ${h.company?.name}`}
                    onSelect={() => {
                      router.push(`/app/leads?lead=${h.id}`);
                      handleClose();
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/80 aria-selected:bg-white/10"
                  >
                    <Users size={16} className="text-[#D4AF37]" />
                    <span className="font-medium">{h.fullName || "Unnamed lead"}</span>
                    <span className="truncate text-white/50">
                      {h.company?.name ?? h.email ?? ""}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
