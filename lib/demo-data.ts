/**
 * DEMO_DATA fixtures for demo mode.
 *
 * Fictional data only — the same invented people as prisma/seed.ts, extended.
 * Every record carries dataLabel: "DEMO_DATA" and these fixtures are NEVER
 * written to the database or mixed with real customer/lead data.
 */

export interface DemoLead {
  id: string;
  /** Always "DEMO_DATA" — the label that keeps demo records identifiable. */
  dataLabel: "DEMO_DATA";
  fullName: string;
  email: string;
  phone: string;
  jobTitle: string;
  company: { name: string } | null;
  industry: string;
  city: string;
  country: string;
  website: string;
  status: string;
  leadScore: number;
  sourceType: string;
  updatedAt: string; // ISO
  createdAt: string; // ISO
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

type SeedLead = Omit<DemoLead, "id" | "dataLabel" | "sourceType" | "updatedAt" | "createdAt"> & {
  ageDays: number;
};

const SEED: SeedLead[] = [
  {
    fullName: "Aarav Mehta", email: "aarav@acmeindustrial.example.com",
    phone: "+91 98765 43210", jobTitle: "Export Manager",
    company: { name: "Acme Industrial Exports" }, industry: "Industrial Manufacturing",
    city: "Ahmedabad", country: "India", website: "https://acmeindustrial.example.com",
    status: "QUALIFIED", leadScore: 82, ageDays: 2,
  },
  {
    fullName: "Priya Nair", email: "priya@shreepackaging.example.com",
    phone: "+91 98111 22334", jobTitle: "Founder",
    company: { name: "Shree Packaging Solutions" }, industry: "Packaging",
    city: "Mumbai", country: "India", website: "https://shreepackaging.example.com",
    status: "CONTACTED", leadScore: 74, ageDays: 5,
  },
  {
    fullName: "Rohan Desai", email: "rohan@novatechtools.example.com",
    phone: "+91 98980 11223", jobTitle: "Procurement Head",
    company: { name: "NovaTech Tools Pvt Ltd" }, industry: "Industrial Equipment",
    city: "Pune", country: "India", website: "https://novatechtools.example.com",
    status: "NEW", leadScore: 61, ageDays: 1,
  },
  {
    fullName: "Kavya Iyer", email: "kavya@brightagro.example.com",
    phone: "+91 97401 55667", jobTitle: "Director",
    company: { name: "Bright Agro Foods" }, industry: "Food Processing",
    city: "Bengaluru", country: "India", website: "https://brightagro.example.com",
    status: "REPLIED", leadScore: 88, ageDays: 9,
  },
  {
    fullName: "Vikram Singh", email: "vikram@fortislogistics.example.com",
    phone: "+91 98110 99887", jobTitle: "VP Operations",
    company: { name: "Fortis Logistics India" }, industry: "Logistics",
    city: "Delhi", country: "India", website: "https://fortislogistics.example.com",
    status: "MEETING", leadScore: 91, ageDays: 14,
  },
  {
    fullName: "Ananya Rao", email: "ananya@texweave.example.com",
    phone: "+91 97654 32109", jobTitle: "Sourcing Manager",
    company: { name: "TexWeave Mills" }, industry: "Textiles",
    city: "Surat", country: "India", website: "https://texweave.example.com",
    status: "NEW", leadScore: 55, ageDays: 0,
  },
  {
    fullName: "Arjun Patel", email: "arjun@precisionauto.example.com",
    phone: "+91 98220 44556", jobTitle: "Plant Head",
    company: { name: "Precision Auto Components" }, industry: "Automotive",
    city: "Chennai", country: "India", website: "https://precisionauto.example.com",
    status: "RESEARCHING", leadScore: 68, ageDays: 4,
  },
  {
    fullName: "Divya Menon", email: "divya@spiceroute.example.com",
    phone: "+91 98470 12345", jobTitle: "Export Director",
    company: { name: "SpiceRoute Exports" }, industry: "Spices & Commodities",
    city: "Kochi", country: "India", website: "https://spiceroute.example.com",
    status: "PROPOSAL", leadScore: 85, ageDays: 18,
  },
  {
    fullName: "Karan Joshi", email: "karan@medisynth.example.com",
    phone: "+91 98123 76543", jobTitle: "Purchase Officer",
    company: { name: "MediSynth Labs" }, industry: "Pharmaceuticals",
    city: "Hyderabad", country: "India", website: "https://medisynth.example.com",
    status: "QUALIFIED", leadScore: 77, ageDays: 7,
  },
  {
    fullName: "Sneha Kulkarni", email: "sneha@urbannest.example.com",
    phone: "+91 98901 23456", jobTitle: "Co-founder",
    company: { name: "UrbanNest Interiors" }, industry: "Home & Furniture",
    city: "Pune", country: "India", website: "https://urbannest.example.com",
    status: "WON", leadScore: 95, ageDays: 26,
  },
  {
    fullName: "Rahul Verma", email: "rahul@steelkraft.example.com",
    phone: "+91 98300 11223", jobTitle: "GM Sales",
    company: { name: "SteelKraft Industries" }, industry: "Steel & Metals",
    city: "Jamshedpur", country: "India", website: "https://steelkraft.example.com",
    status: "LOST", leadScore: 42, ageDays: 29,
  },
  {
    fullName: "Meera Krishnan", email: "meera@ayurherbals.example.com",
    phone: "+91 97450 66778", jobTitle: "Marketing Head",
    company: { name: "Ayur Herbals Ltd" }, industry: "Ayurveda & Wellness",
    city: "Coimbatore", country: "India", website: "https://ayurherbals.example.com",
    status: "CONTACTED", leadScore: 70, ageDays: 11,
  },
];

export const DEMO_LEADS: DemoLead[] = SEED.map((s, i) => ({
  ...s,
  id: `demo-lead-${String(i + 1).padStart(2, "0")}`,
  dataLabel: "DEMO_DATA",
  sourceType: "DEMO",
  createdAt: daysAgoIso(s.ageDays),
  // updatedAt is slightly newer than createdAt so "recently updated" sorts look alive.
  updatedAt: daysAgoIso(Math.max(0, s.ageDays - 1)),
}));

/** Fixture campaign count shown on the demo dashboard. */
export const DEMO_ACTIVE_CAMPAIGNS = 2;

const QUALIFIED_STATUSES = new Set([
  "QUALIFIED", "CONTACTED", "REPLIED", "MEETING", "PROPOSAL", "NEGOTIATION",
]);

export interface DemoDashboard {
  totalLeads: number;
  newLeads: number;
  qualifiedLeads: number;
  activeCampaigns: number;
  avgScore: number;
  pipeline: { status: string; count: number }[];
  growth: { day: string; leads: number }[];
  usage: {
    leads: { used: number; limit: number };
    aiTokens: { used: number; limit: number };
    messages: { used: number; limit: number };
  };
}

/** Compute dashboard aggregates from the DEMO_DATA fixtures (same shape as the real page). */
export function getDemoDashboard(): DemoDashboard {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;

  const byStatus = new Map<string, number>();
  for (const l of DEMO_LEADS) byStatus.set(l.status, (byStatus.get(l.status) ?? 0) + 1);

  const growthMap = new Map<string, number>();
  for (const l of DEMO_LEADS) {
    const day = l.createdAt.slice(0, 10);
    growthMap.set(day, (growthMap.get(day) ?? 0) + 1);
  }
  const growth: { day: string; leads: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    growth.push({ day: d.slice(5), leads: growthMap.get(d) ?? 0 });
  }

  const totalScore = DEMO_LEADS.reduce((sum, l) => sum + l.leadScore, 0);

  return {
    totalLeads: DEMO_LEADS.length,
    newLeads: DEMO_LEADS.filter((l) => new Date(l.createdAt).getTime() >= sevenDaysAgo).length,
    qualifiedLeads: DEMO_LEADS.filter((l) => QUALIFIED_STATUSES.has(l.status)).length,
    activeCampaigns: DEMO_ACTIVE_CAMPAIGNS,
    avgScore: Math.round(totalScore / Math.max(1, DEMO_LEADS.length)),
    pipeline: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    growth,
    usage: {
      leads: { used: DEMO_LEADS.length, limit: 100 },
      aiTokens: { used: 0, limit: 10000 },
      messages: { used: 0, limit: 500 },
    },
  };
}
