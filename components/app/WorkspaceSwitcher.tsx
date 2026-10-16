"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId } from "react";

export interface Org {
  id: string;
  name: string;
  role: string;
}

/** The active-workspace cookie the server resolves (and validates against memberships) on every request. */
function setOrgCookie(orgId: string) {
  document.cookie = `wdd.org_id=${orgId}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/**
 * Workspace selector. With one workspace it is a static label (a one-option
 * <select> is noise); with several it switches the cookie and refreshes the
 * server components. Switching never grants access: the server re-checks membership.
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
  const router = useRouter();
  const selectId = useId();
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
          value={activeOrgId}
          onChange={(e) => {
            setOrgCookie(e.target.value);
            router.refresh();
          }}
          className="min-h-11 w-full appearance-none rounded-control border border-line bg-surface px-3 py-2.5 pr-8 text-[13px] text-ink outline-none focus:border-neon-cyan lg:min-h-10"
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
