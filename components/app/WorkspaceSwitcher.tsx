"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

export interface Org {
  id: string;
  name: string;
  role: string;
}

/** The active-workspace cookie the server resolves (and validates against memberships) on every request. */
function setOrgCookie(orgId: string) {
  document.cookie = `wdd.org_id=${orgId}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/** A lead belongs to one workspace, so after a switch land on the list rather than a "not found". */
function destinationAfterSwitch(): string {
  const { pathname, search } = window.location;
  return /^\/leads\/[^/]+\/?$/.test(pathname) ? "/leads" : pathname + search;
}

/**
 * Workspace selector. With one workspace it is a static label (a one-option
 * <select> is noise); with several it sets the cookie and reloads the page.
 *
 * A full reload (not `router.refresh()`) is deliberate: everything on screen is
 * workspace-scoped (server data, the notification bell, the usage card, command
 * palette results), and a reload resets all of it in one step instead of
 * depending on each client component noticing the change. Switching never grants
 * access: the server re-checks membership against the cookie on every request.
 */
export function WorkspaceSwitcher({
  orgs,
  activeOrgId,
  collapsed = false,
}: {
  orgs: Org[];
  activeOrgId: string;
  collapsed?: boolean;
}) {
  const selectId = useId();
  // Shown immediately so the control doesn't snap back while the page reloads.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];

  if (collapsed) {
    return (
      <div
        title={active ? `${active.name} (${active.role})` : "Workspace"}
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-control border border-line bg-surface text-xs font-semibold text-ink"
      >
        {(active?.name ?? "W").charAt(0).toUpperCase()}
      </div>
    );
  }

  const labelCls = "px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim";

  if (orgs.length <= 1) {
    return (
      <div>
        <p className={labelCls}>Workspace</p>
        <p className="mt-1.5 truncate rounded-control border border-line bg-surface px-3 py-2.5 text-[13px] text-ink">
          {active?.name}
        </p>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={selectId} className={labelCls}>
        Workspace
      </label>
      <div className="relative mt-1.5">
        <select
          id={selectId}
          value={switchingTo ?? activeOrgId}
          disabled={switchingTo !== null}
          onChange={(e) => {
            const next = e.target.value;
            if (next === activeOrgId) return;
            setSwitchingTo(next);
            setOrgCookie(next);
            window.location.assign(destinationAfterSwitch());
          }}
          className="min-h-11 w-full appearance-none rounded-control border border-line bg-surface px-3 py-2.5 pr-8 text-[13px] text-ink outline-none focus:border-neon-cyan disabled:opacity-70 lg:min-h-10"
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id} className="bg-surface">
              {o.name} ({o.role})
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-dim" />
      </div>
    </div>
  );
}
