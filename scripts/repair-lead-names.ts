/**
 * Repair existing leads whose name fell back to "Unnamed lead".
 *
 * Sets Lead.fullName = Company.name for leads where fullName IS NULL and a
 * linked Company with a name exists. Idempotent — safe to re-run.
 *
 * Does NOT touch leads that already have a name, does NOT delete anything,
 * and does NOT invent data (the company name is already in the database).
 *
 * Usage (in an environment with DATABASE_URL set, e.g. your Codespace):
 *   npx tsx scripts/repair-lead-names.ts
 *
 * Optional: pass an organization id to scope the repair:
 *   npx tsx scripts/repair-lead-names.ts --org <organizationId>
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const orgArg = process.argv.indexOf("--org");
  const organizationId = orgArg >= 0 ? process.argv[orgArg + 1] : undefined;

  const where = {
    fullName: null,
    company: { name: { not: "" } },
    ...(organizationId ? { organizationId } : {}),
  };

  const candidates = await db.lead.findMany({
    where,
    select: { id: true, company: { select: { name: true } } },
  });

  let repaired = 0;
  for (const lead of candidates) {
    const name = lead.company?.name?.trim();
    if (!name) continue;
    await db.lead.update({
      where: { id: lead.id },
      data: { fullName: name },
    });
    repaired++;
  }

  console.log(`repair-lead-names: ${candidates.length} candidate(s), ${repaired} repaired.`);
  if (organizationId) console.log(`Scoped to organization: ${organizationId}`);
}

main()
  .catch((e) => {
    console.error("repair-lead-names failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
