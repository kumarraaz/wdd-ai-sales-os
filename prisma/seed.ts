/**
 * Seed script — run with: npx tsx prisma/seed.ts
 * Requires DATABASE_URL. Creates:
 *  - Plans (FREE/PRO/BUSINESS/ENTERPRISE)
 *  - A demo organization with fictional demo leads (dataLabel = DEMO_DATA)
 *
 * The demo leads are FICTIONAL companies/persons created for evaluation.
 * They are always labeled DEMO_DATA and never mixed with real data.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const PLANS = [
  {
    name: "Free",
    tier: "FREE" as const,
    maxLeads: 500,
    maxUsers: 3,
    aiTokensPerDay: 100_000,
    messagesPerDay: 200,
    discoverySearchesPerDay: 20,
    discoveryRecordsPerDay: 200,
    websiteInspectionsPerDay: 25,
    features: ["500 leads", "Basic CRM", "Manual outreach"],
  },
  {
    name: "Pro",
    tier: "PRO" as const,
    maxLeads: 10_000,
    maxUsers: 10,
    aiTokensPerDay: 2_000_000,
    messagesPerDay: 2000,
    discoverySearchesPerDay: 200,
    discoveryRecordsPerDay: 5000,
    websiteInspectionsPerDay: 500,
    features: ["10k leads", "AI research", "Campaigns", "Automation"],
  },
  {
    name: "Business",
    tier: "BUSINESS" as const,
    maxLeads: 100_000,
    maxUsers: 50,
    aiTokensPerDay: 20_000_000,
    messagesPerDay: 20000,
    discoverySearchesPerDay: 1000,
    discoveryRecordsPerDay: 50000,
    websiteInspectionsPerDay: 5000,
    features: ["100k leads", "Advanced automation", "Team collaboration", "API access"],
  },
  {
    name: "Enterprise",
    tier: "ENTERPRISE" as const,
    maxLeads: 1_000_000,
    maxUsers: 500,
    aiTokensPerDay: 200_000_000,
    messagesPerDay: 200000,
    discoverySearchesPerDay: 10000,
    discoveryRecordsPerDay: 500000,
    websiteInspectionsPerDay: 50000,
    features: ["Unlimited scale", "SSO", "White label", "Dedicated support"],
  },
];

// Fictional demo data — invented companies, not real businesses.
const DEMO_LEADS = [
  {
    fullName: "Aarav Mehta", email: "aarav@acmeindustrial.example.com",
    phone: "+91 98765 43210", jobTitle: "Export Manager",
    company: "Acme Industrial Exports", industry: "Industrial Manufacturing",
    city: "Ahmedabad", country: "India", website: "https://acmeindustrial.example.com",
    status: "QUALIFIED" as const, leadScore: 82,
  },
  {
    fullName: "Priya Nair", email: "priya@shreepackaging.example.com",
    phone: "+91 98111 22334", jobTitle: "Founder",
    company: "Shree Packaging Solutions", industry: "Packaging",
    city: "Mumbai", country: "India", website: "https://shreepackaging.example.com",
    status: "CONTACTED" as const, leadScore: 74,
  },
  {
    fullName: "Rohan Desai", email: "rohan@novatechtools.example.com",
    phone: "+91 98980 11223", jobTitle: "Procurement Head",
    company: "NovaTech Tools Pvt Ltd", industry: "Industrial Equipment",
    city: "Pune", country: "India", website: "https://novatechtools.example.com",
    status: "NEW" as const, leadScore: 61,
  },
  {
    fullName: "Kavya Iyer", email: "kavya@brightagro.example.com",
    phone: "+91 97401 55667", jobTitle: "Director",
    company: "Bright Agro Foods", industry: "Food Processing",
    city: "Bengaluru", country: "India", website: "https://brightagro.example.com",
    status: "REPLIED" as const, leadScore: 88,
  },
  {
    fullName: "Vikram Singh", email: "vikram@fortislogistics.example.com",
    phone: "+91 98110 99887", jobTitle: "VP Operations",
    company: "Fortis Logistics India", industry: "Logistics",
    city: "Delhi", country: "India", website: "https://fortislogistics.example.com",
    status: "MEETING" as const, leadScore: 91,
  },
];

async function main() {
  for (const p of PLANS) {
    await db.plan.upsert({
      where: { tier: p.tier },
      update: p,
      create: p,
    });
  }
  console.log("✓ Plans seeded");

  const demoEmail = process.env.SEED_DEMO_USER_EMAIL;
  if (!demoEmail) {
    console.log("ℹ Set SEED_DEMO_USER_EMAIL to also seed a demo workspace with fictional leads.");
    return;
  }

  const user = await db.user.findUnique({ where: { email: demoEmail } });
  if (!user) {
    console.log(`ℹ No user found with email ${demoEmail} — sign up first, then re-run seed.`);
    return;
  }

  let membership = await db.membership.findFirst({
    where: { userId: user.id },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new Error("User has no organization — signup provisioning may have failed.");

  const orgId = membership.organizationId;
  const existing = await db.lead.count({ where: { organizationId: orgId, dataLabel: "DEMO_DATA" } });
  if (existing > 0) {
    console.log("ℹ Demo leads already seeded — skipping.");
    return;
  }

  for (const d of DEMO_LEADS) {
    let company = await db.company.findFirst({
      where: { organizationId: orgId, name: d.company },
    });
    if (!company) {
      company = await db.company.create({
        data: {
          organizationId: orgId,
          name: d.company,
          industry: d.industry,
          website: d.website,
          domain: new URL(d.website).hostname.replace(/^www\./, ""),
          dataLabel: "DEMO_DATA",
        },
      });
    }
    const lead = await db.lead.create({
      data: {
        organizationId: orgId,
        fullName: d.fullName,
        email: d.email,
        phone: d.phone,
        jobTitle: d.jobTitle,
        companyId: company.id,
        industry: d.industry,
        city: d.city,
        country: d.country,
        website: d.website,
        domain: new URL(d.website).hostname.replace(/^www\./, ""),
        status: d.status,
        leadScore: d.leadScore,
        sourceType: "DEMO",
        sourceDetail: "Seeded demo dataset",
        dataLabel: "DEMO_DATA",
      },
    });
    await db.leadActivity.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        type: "created",
        title: "Demo lead created (seed)",
      },
    });
  }
  console.log(`✓ Seeded ${DEMO_LEADS.length} fictional demo leads for ${membership.organization.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
