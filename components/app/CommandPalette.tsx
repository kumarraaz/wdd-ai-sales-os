"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search, Users } from "lucide-react";
import { NAV_ITEMS } from "./nav";
import { NAV_ICONS } from "./nav-icons";

interface LeadHit {
  id: string;
  fullName: string | null;
  email: string | null;
  company: { name: string } | null;
}

const GROUP_HEADING =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] " +
  "[&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-ink-dim";

const ITEM =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 text-sm text-ink-muted aria-selected:bg-tint/10 aria-selected:text-ink";

/**
 * ⌘K / Ctrl+K palette: jump to any page or search the workspace's leads.
 * Built on cmdk's Dialog (focus trap, Escape, aria-modal come from the library).
 */
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

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQ("");
      setHits([]);
    }
    onOpenChange(next);
  };

  const go = (href: string) => {
    router.push(href);
    handleOpenChange(false);
  };

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/leads?q=${encodeURIComponent(q.trim())}&pageSize=5`, {
          headers: { "x-org-id": orgId },
        });
        if (!res.ok) return;
        const data = await res.json();
        setHits(data.leads ?? []);
      } catch {
        /* offline — palette still works for navigation */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, orgId, apiBase]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]"
      contentClassName="pop-in fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border border-line-strong bg-surface text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search size={16} aria-hidden="true" className="shrink-0 text-ink-dim" />
        <Command.Input
          value={q}
          onValueChange={handleQueryChange}
          placeholder="Search leads or jump to a page…"
          className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-dim"
        />
        <kbd className="hidden shrink-0 rounded border border-line-strong px-1.5 py-0.5 text-[10px] text-ink-dim sm:inline">
          Esc
        </kbd>
      </div>
      <Command.List className="max-h-[min(60vh,22rem)] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-8 text-center text-sm text-ink-muted">
          No results. Try a page name, or a lead&apos;s name, email or company.
        </Command.Empty>

        <Command.Group heading="Pages" className={GROUP_HEADING}>
          {NAV_ITEMS.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            return (
              <Command.Item
                key={item.href}
                value={`Go to ${item.label}`}
                keywords={[item.title, item.href]}
                onSelect={() => go(item.href)}
                className={ITEM}
              >
                <Icon size={16} aria-hidden="true" className="shrink-0 text-neon-cyan" />
                <span className="flex-1">Go to {item.label}</span>
                {item.status === "planned" && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">Planned</span>
                )}
              </Command.Item>
            );
          })}
        </Command.Group>

        {hits.length > 0 && (
          // forceMount on the group too: cmdk hides a group whose items did not match the
          // typed text, and these results were matched by the server, not by cmdk.
          <Command.Group heading="Leads" forceMount className={GROUP_HEADING}>
            {hits.map((h) => {
              const primary = h.company?.name ?? h.fullName ?? h.email ?? "Lead";
              const secondary = h.company?.name ? (h.fullName ?? h.email) : h.email;
              return (
                // forceMount: these results were already matched server-side.
                <Command.Item
                  key={h.id}
                  forceMount
                  value={`lead ${h.id} ${primary} ${secondary ?? ""}`}
                  onSelect={() => go(`/leads/${h.id}`)}
                  className={ITEM}
                >
                  <Users size={16} aria-hidden="true" className="shrink-0 text-neon-cyan" />
                  <span className="font-medium text-ink">{primary}</span>
                  {secondary && <span className="truncate text-ink-dim">{secondary}</span>}
                </Command.Item>
              );
            })}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
