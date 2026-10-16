/**
 * Navigation model for the authenticated app. Plain TypeScript (no JSX) so it is
 * unit-testable and shared by the sidebar, mobile drawer, command palette and
 * breadcrumbs. EVERY href here must be a real route under app/(app) — route
 * groups add no URL segment, so there is no "/app/…" prefix.
 */

export type NavIconName =
  | "LayoutDashboard"
  | "Users"
  | "KanbanSquare"
  | "Radar"
  | "BrainCircuit"
  | "Send"
  | "ShieldCheck"
  | "CalendarDays"
  | "Megaphone"
  | "Workflow"
  | "CheckSquare"
  | "BarChart3"
  | "Plug"
  | "CreditCard"
  | "LockKeyhole"
  | "Settings";

/** live: fully working · readonly: real data, no editing yet · planned: roadmap page only */
export type NavStatus = "live" | "readonly" | "planned";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  /** Short descriptor shown beside the breadcrumb in the top bar. */
  title: string;
  status: NavStatus;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", icon: "LayoutDashboard", title: "Sales command center", status: "live" },
      { href: "/leads", label: "Leads", icon: "Users", title: "Lead database", status: "live" },
      { href: "/crm", label: "CRM pipeline", icon: "KanbanSquare", title: "Pipeline board", status: "live" },
      { href: "/discover", label: "Lead discovery", icon: "Radar", title: "Discovery workspace", status: "live" },
      { href: "/intelligence", label: "Lead intelligence", icon: "BrainCircuit", title: "Website intelligence", status: "live" },
      { href: "/outreach/instagram", label: "Outreach studio", icon: "Send", title: "Instagram outreach", status: "live" },
      { href: "/approvals", label: "Approval queue", icon: "ShieldCheck", title: "Human approval gate", status: "live" },
      { href: "/prospecting", label: "Prospecting", icon: "CalendarDays", title: "Daily prospecting", status: "live" },
      { href: "/campaigns", label: "Campaigns", icon: "Megaphone", title: "Campaigns", status: "planned" },
      { href: "/automation", label: "Automations", icon: "Workflow", title: "Job queue", status: "readonly" },
      { href: "/tasks", label: "Tasks", icon: "CheckSquare", title: "Follow-up tasks", status: "readonly" },
      { href: "/analytics", label: "Analytics", icon: "BarChart3", title: "Pipeline analytics", status: "readonly" },
    ],
  },
  {
    id: "tools",
    label: "Workspace tools",
    items: [
      { href: "/integrations", label: "Integrations", icon: "Plug", title: "Data sources", status: "live" },
      { href: "/billing", label: "Billing", icon: "CreditCard", title: "Plan & usage", status: "readonly" },
      { href: "/security", label: "Security", icon: "LockKeyhole", title: "Audit trail", status: "readonly" },
      { href: "/settings", label: "Settings", icon: "Settings", title: "Workspace settings", status: "readonly" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Active when the path is the item or any nested route beneath it. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The most specific nav item for a path (longest matching href wins). */
export function findNavItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    if (isNavActive(pathname, item.href) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

/** Labels for known nested routes, so breadcrumbs read "Workspace / Leads / Lead detail". */
function subpageLabel(pathname: string, item: NavItem): string | null {
  const rest = pathname.slice(item.href.length).replace(/^\//, "");
  if (!rest) return null;
  if (item.href === "/leads") return "Lead detail";
  if (item.href === "/discover" && rest === "history") return "History";
  return null;
}

export function breadcrumbsFor(pathname: string): string[] {
  const item = findNavItem(pathname);
  if (!item) return ["Workspace"];
  const sub = subpageLabel(pathname, item);
  return sub ? ["Workspace", item.label, sub] : ["Workspace", item.label];
}
