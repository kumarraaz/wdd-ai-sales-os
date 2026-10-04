/**
 * Mobile bottom-navigation items.
 *
 * Kept in a plain .ts module (no JSX) so the 6-item contract — exact hrefs,
 * Send icon for Outreach — is unit-testable with vitest.
 */
export const MOBILE_NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: "LayoutDashboard" },
  { href: "/leads", label: "Leads", icon: "Users" },
  { href: "/discover", label: "Discover", icon: "Radar" },
  { href: "/outreach/instagram", label: "Outreach", icon: "Send" },
  { href: "/crm", label: "CRM", icon: "KanbanSquare" },
  { href: "/intelligence", label: "Intel", icon: "BrainCircuit" },
] as const;

export type MobileNavIconName = (typeof MOBILE_NAV_ITEMS)[number]["icon"];
