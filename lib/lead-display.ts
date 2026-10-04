/**
 * Display name for a lead: the real business/company name first, then the
 * contact name. Never returns "Unnamed lead" — returns "—" only when no
 * name of any kind exists.
 *
 * Client-safe: no server-only imports (no Prisma, no pg).
 */
export function leadDisplayName(lead: {
  fullName?: string | null;
  company?: { name?: string | null } | null;
}): string {
  return lead.company?.name?.trim() || lead.fullName?.trim() || "—";
}
