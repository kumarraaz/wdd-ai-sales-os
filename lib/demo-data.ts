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

/** Fictional per-lead detail for demo mode — invented data, never real. */
export interface DemoLeadDetail extends DemoLead {
  sourceDetail: string;
  sourceUrl: string | null;
  externalId: string | null;
  discoveredAt: string | null;
  rating: number | null;
  reviewCount: number | null;
  scores: { id: string; score: number; scoreBand: string; createdAt: string }[];
  provenance: { field: string; value: string; source: string; label: "DEMO_DATA" }[];
}

export function getDemoLeadDetail(id: string): DemoLeadDetail | null {
  const lead = DEMO_LEADS.find((l) => l.id === id);
  if (!lead) return null;
  return {
    ...lead,
    sourceDetail: "Demo fixture",
    sourceUrl: null,
    externalId: null,
    discoveredAt: lead.createdAt,
    rating: null,
    reviewCount: null,
    scores: [
      {
        id: `demo-score-${lead.id}`,
        score: lead.leadScore,
        scoreBand:
          lead.leadScore >= 85 ? "Very Strong Fit" : lead.leadScore >= 70 ? "Strong Fit" : "Moderate Fit",
        createdAt: lead.updatedAt,
      },
    ],
    provenance: [
      { field: "company", value: lead.company?.name ?? lead.fullName, source: "Demo fixture", label: "DEMO_DATA" },
      { field: "website", value: lead.website, source: "Demo fixture", label: "DEMO_DATA" },
    ],
  };
}

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

/** Fictional discovery results for demo mode — invented companies, never real. */
export interface DemoDiscoveredCompany {
  provider: "google-places";
  providerId: string;
  name: string;
  category?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  website?: string;
  sourceUrl?: string;
  rating?: number;
  reviewCount?: number;
  discoveredAt: string; // ISO
  provenance: "DEMO_DATA";
}

const DEMO_DISCOVERY_SEED: Omit<DemoDiscoveredCompany, "discoveredAt" | "provenance">[] = [
  {
    provider: "google-places",
    providerId: "demo-place-001",
    name: "Acme Industrial Exports",
    category: "manufacturer",
    address: "Plot 42, GIDC Industrial Estate, Ahmedabad, Gujarat",
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    phone: "+91 79 4000 1122",
    website: "https://acmeindustrial.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-001",
    rating: 4.6,
    reviewCount: 128,
  },
  {
    provider: "google-places",
    providerId: "demo-place-002",
    name: "Surat Textile Traders",
    category: "exporter",
    address: "Shop 7, Textile Market, Surat, Gujarat",
    city: "Surat",
    state: "Gujarat",
    country: "India",
    phone: "+91 261 234 5678",
    website: "https://surattextile.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-002",
    rating: 4.2,
    reviewCount: 64,
  },
  {
    provider: "google-places",
    providerId: "demo-place-003",
    name: "Gulfline Software Solutions",
    category: "software company",
    address: "Level 14, Business Bay, Dubai",
    city: "Dubai",
    country: "United Arab Emirates",
    website: "https://gulflinesoftware.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-003",
    rating: 4.8,
    reviewCount: 210,
  },
  {
    provider: "google-places",
    providerId: "demo-place-004",
    name: "FitZone Gymnasium",
    category: "gym",
    address: "3rd Floor, Connaught Place, New Delhi",
    city: "Delhi",
    country: "India",
    phone: "+91 11 4155 8899",
    sourceUrl: "https://maps.google.com/?cid=demo-place-004",
    rating: 4.1,
    reviewCount: 342,
  },
  {
    provider: "google-places",
    providerId: "demo-place-005",
    name: "Precision Auto Components",
    category: "manufacturer",
    address: "MIDC Area, Pune, Maharashtra",
    city: "Pune",
    state: "Maharashtra",
    country: "India",
    phone: "+91 20 6789 0123",
    website: "https://precisionauto.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-005",
  },
  {
    provider: "google-places",
    providerId: "demo-place-006",
    name: "Harborview Logistics LLC",
    category: "logistics",
    address: "Jebel Ali Free Zone, Dubai",
    city: "Dubai",
    country: "United Arab Emirates",
    website: "https://harborviewlogistics.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-006",
    rating: 3.9,
    reviewCount: 41,
  },
  {
    provider: "google-places",
    providerId: "demo-place-007",
    name: "Shree Balaji Ceramics",
    category: "manufacturer",
    address: "Morbi Industrial Zone, Morbi, Gujarat",
    city: "Morbi",
    state: "Gujarat",
    country: "India",
    phone: "+91 2822 240 111",
    sourceUrl: "https://maps.google.com/?cid=demo-place-007",
    rating: 4.4,
    reviewCount: 89,
  },
  {
    provider: "google-places",
    providerId: "demo-place-008",
    name: "Northpeak Outdoor Gear",
    category: "retailer",
    address: "Bandra West, Mumbai, Maharashtra",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    website: "https://northpeak.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-008",
    rating: 4.7,
    reviewCount: 512,
  },
  // ── Fictional Gujarat manufacturers for the discovery demo ─────────────
  {
    provider: "google-places",
    providerId: "demo-place-009",
    name: "Vibrant Steel Fabricators",
    category: "manufacturer",
    address: "Plot 18, GIDC Vatva, Ahmedabad, Gujarat",
    city: "Ahmedabad",
    state: "Gujarat",
    country: "India",
    phone: "+91 79 4000 2211",
    website: "https://vibrantsteel.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-009",
    rating: 4.2,
    reviewCount: 64,
  },
  {
    provider: "google-places",
    providerId: "demo-place-010",
    name: "Surat Diamond Tools Works",
    category: "manufacturer",
    address: "Katargam Industrial Area, Surat, Gujarat",
    city: "Surat",
    state: "Gujarat",
    country: "India",
    phone: "+91 261 250 3344",
    website: "https://suratdiamondtools.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-010",
    rating: 4.5,
    reviewCount: 92,
  },
  {
    provider: "google-places",
    providerId: "demo-place-011",
    name: "Vadodara Chemical Industries",
    category: "manufacturer",
    address: "Nandesari Industrial Estate, Vadodara, Gujarat",
    city: "Vadodara",
    state: "Gujarat",
    country: "India",
    phone: "+91 265 284 5566",
    website: "https://vadodarachemical.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-011",
    rating: 3.8,
    reviewCount: 47,
  },
  {
    provider: "google-places",
    providerId: "demo-place-012",
    name: "Rajkot Engineering Works",
    category: "manufacturer",
    address: "Aji Industrial Estate, Rajkot, Gujarat",
    city: "Rajkot",
    state: "Gujarat",
    country: "India",
    phone: "+91 281 240 7788",
    sourceUrl: "https://maps.google.com/?cid=demo-place-012",
    rating: 4.1,
    reviewCount: 55,
  },
  {
    provider: "google-places",
    providerId: "demo-place-013",
    name: "Gandhinagar Pharma Labs",
    category: "manufacturer",
    address: "Infocity, Gandhinagar, Gujarat",
    city: "Gandhinagar",
    state: "Gujarat",
    country: "India",
    phone: "+91 79 2320 9900",
    website: "https://gandhinagarpharma.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-013",
    rating: 4.3,
    reviewCount: 71,
  },
  {
    provider: "google-places",
    providerId: "demo-place-014",
    name: "Ankleshwar Dye Intermediates",
    category: "manufacturer",
    address: "GIDC Ankleshwar, Bharuch, Gujarat",
    city: "Ankleshwar",
    state: "Gujarat",
    country: "India",
    website: "https://ankleshwarchyes.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-014",
    rating: 3.6,
    reviewCount: 28,
  },
  {
    provider: "google-places",
    providerId: "demo-place-015",
    name: "Bhavnagar Ship Components",
    category: "manufacturer",
    address: "Alang Road, Bhavnagar, Gujarat",
    city: "Bhavnagar",
    state: "Gujarat",
    country: "India",
    phone: "+91 278 250 1122",
    website: "https://bhavnagarship.example.com",
    sourceUrl: "https://maps.google.com/?cid=demo-place-015",
    rating: 4.0,
    reviewCount: 39,
  },
];

/**
 * Demo discovery search — filters the fictional fixtures by keyword/city/
 * country like a real provider would. NEVER calls external APIs.
 */
export function getDemoDiscoveryResults(query: {
  keyword: string;
  city?: string;
  country?: string;
  maxResults: number;
}): DemoDiscoveredCompany[] {
  const kw = query.keyword.trim().toLowerCase();
  // Simple plural handling so "manufacturers" matches "manufacturer".
  const kwSingular = kw.endsWith("s") ? kw.slice(0, -1) : kw;
  const city = query.city?.trim().toLowerCase();
  const country = query.country?.trim().toLowerCase();
  const now = new Date().toISOString();
  return DEMO_DISCOVERY_SEED.filter((c) => {
    const haystack =
      `${c.name} ${c.category ?? ""} ${c.city ?? ""} ${c.country ?? ""}`.toLowerCase();
    if (kw && !haystack.includes(kw) && !haystack.includes(kwSingular)) return false;
    if (city && c.city?.toLowerCase() !== city) return false;
    if (country && c.country?.toLowerCase() !== country) return false;
    return true;
  })
    .slice(0, Math.min(Math.max(query.maxResults, 1), 20))
    .map((c) => ({ ...c, discoveredAt: now, provenance: "DEMO_DATA" as const }));
}

/** Fictional website inspection for demo mode — invented data, never real. */
export interface DemoWebsiteInspection {
  id: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  status: "COMPLETED";
  dataLabel: "DEMO_DATA";
  inspectedAt: string; // ISO
  findings: {
    requestedUrl: string;
    finalUrl: string;
    httpStatus: number;
    redirectChain: { url: string; status: number }[];
    https: boolean;
    responseTimeMs: number;
    htmlAvailable: boolean;
    title: string | null;
    metaDescription: string | null;
    canonicalUrl: string | null;
    robotsMeta: string | null;
    viewportMeta: string | null;
    h1: { count: number; texts: string[] };
    h2Count: number;
    imageCount: number;
    imagesMissingAlt: number;
    internalLinkCount: number;
    externalLinkCount: number;
    robotsTxt: { available: boolean; url: string };
    sitemap: { available: boolean; url: string };
    favicon: { available: boolean; href: string | null };
    openGraph: { title: string | null; description: string | null; image: string | null };
    twitterCard: { card: string | null; title: string | null; description: string | null; image: string | null };
    lang: string | null;
    structuredData: { jsonLdCount: number; microdata: boolean; present: boolean };
    mobile: { viewportPresent: boolean; responsiveSignal: boolean };
    techSignals: { signal: string; evidence: string; provenance: "AI_INFERENCE" }[];
    contact: { emails: string[]; phones: string[] };
    socialLinks: { platform: string; url: string }[];
    provenance: "DEMO_DATA";
    inspectedAt: string;
  };
}

/**
 * Demo website inspection — returns a fictional report for any URL.
 * NEVER makes real external HTTP requests.
 */
export function getDemoWebsiteInspection(requestedUrl: string): DemoWebsiteInspection {
  const now = new Date().toISOString();
  let finalUrl = requestedUrl.trim();
  if (!/^https?:\/\//i.test(finalUrl)) finalUrl = `https://${finalUrl}`;
  const origin = finalUrl.split("/").slice(0, 3).join("/");
  return {
    id: "demo-inspection-001",
    requestedUrl,
    finalUrl,
    httpStatus: 200,
    status: "COMPLETED",
    dataLabel: "DEMO_DATA",
    inspectedAt: now,
    findings: {
      requestedUrl,
      finalUrl,
      httpStatus: 200,
      redirectChain: [],
      https: finalUrl.startsWith("https://"),
      responseTimeMs: 842,
      htmlAvailable: true,
      title: "Acme Industrial Exports — Precision Manufacturing Solutions",
      metaDescription:
        "Acme Industrial Exports manufactures precision components for global buyers. ISO 9001 certified.",
      canonicalUrl: finalUrl,
      robotsMeta: "index, follow",
      viewportMeta: "width=device-width, initial-scale=1",
      h1: { count: 1, texts: ["Precision Manufacturing, Delivered Worldwide"] },
      h2Count: 6,
      imageCount: 24,
      imagesMissingAlt: 3,
      internalLinkCount: 48,
      externalLinkCount: 7,
      robotsTxt: { available: true, url: `${origin}/robots.txt` },
      sitemap: { available: true, url: `${origin}/sitemap.xml` },
      favicon: { available: true, href: "/favicon.ico" },
      openGraph: {
        title: "Acme Industrial Exports",
        description: "Precision components for global buyers.",
        image: `${origin}/og-image.png`,
      },
      twitterCard: {
        card: "summary_large_image",
        title: "Acme Industrial Exports",
        description: "Precision components for global buyers.",
        image: `${origin}/og-image.png`,
      },
      lang: "en",
      structuredData: { jsonLdCount: 2, microdata: false, present: true },
      mobile: { viewportPresent: true, responsiveSignal: true },
      techSignals: [
        {
          signal: "WordPress",
          evidence: 'Pattern "wp-content/" found in page HTML',
          provenance: "AI_INFERENCE",
        },
      ],
      contact: {
        emails: ["sales@acmeindustrial.example.com"],
        phones: ["+91 79 4000 1122"],
      },
      socialLinks: [
        { platform: "linkedin", url: "https://linkedin.com/company/acme-industrial-demo" },
      ],
      provenance: "DEMO_DATA",
      inspectedAt: now,
    },
  };
}

/**
 * Fictional AI lead-intelligence fixture — deterministic, invented data.
 * NEVER calls Gemini or any external AI service.
 */
export interface DemoLeadIntelligence {
  id: string;
  leadId: string;
  status: "COMPLETED";
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  dataLabel: "DEMO_DATA";
  confidence: "MEDIUM";
  generatedAt: string; // ISO
  warnings: string[];
  intelligence: {
    summary: { text: string; evidence: { sourceType: string; field: string }[] };
    businessType: string;
    verifiedSignals: { type: "VERIFIED_DATA"; statement: string; evidence: { sourceType: string; field: string }[] }[];
    inferredOpportunities: { type: "AI_INFERENCE"; statement: string; evidence: { sourceType: string; field: string }[] }[];
    recommendedServices: { type: "AI_INFERENCE"; statement: string; evidence: { sourceType: string; field: string }[] }[];
    salesAngle: { text: string; evidence: { sourceType: string; field: string }[] };
    discoveryQuestions: string[];
    confidence: "MEDIUM";
    confidenceReason: string;
    evidence: { sourceType: string; field: string }[];
  };
}

export function getDemoLeadIntelligence(leadId: string): DemoLeadIntelligence {
  const now = new Date().toISOString();
  return {
    id: "demo-intelligence-001",
    leadId,
    status: "COMPLETED",
    provider: "gemini",
    model: "gemini-2.0-flash (demo)",
    promptVersion: "v1",
    schemaVersion: "v1",
    dataLabel: "DEMO_DATA",
    confidence: "MEDIUM",
    generatedAt: now,
    warnings: [],
    intelligence: {
      summary: {
        text: "Acme Industrial Exports is a manufacturing business discovered via Google Places. Its website is technically basic: no meta description, several images missing alt text, and no sitemap — suggesting the site has not been professionally optimized.",
        evidence: [
          { sourceType: "GOOGLE_PLACES", field: "name" },
          { sourceType: "WEBSITE_INSPECTION", field: "metaDescription" },
          { sourceType: "WEBSITE_INSPECTION", field: "imagesMissingAlt" },
        ],
      },
      businessType: "Manufacturing",
      verifiedSignals: [
        {
          type: "VERIFIED_DATA",
          statement: "The website has no meta description.",
          evidence: [{ sourceType: "WEBSITE_INSPECTION", field: "metaDescription" }],
        },
        {
          type: "VERIFIED_DATA",
          statement: "3 of 24 images are missing alt attributes.",
          evidence: [
            { sourceType: "WEBSITE_INSPECTION", field: "imageCount" },
            { sourceType: "WEBSITE_INSPECTION", field: "imagesMissingAlt" },
          ],
        },
        {
          type: "VERIFIED_DATA",
          statement: "No sitemap.xml was found.",
          evidence: [{ sourceType: "WEBSITE_INSPECTION", field: "sitemap" }],
        },
      ],
      inferredOpportunities: [
        {
          type: "AI_INFERENCE",
          statement: "SEO optimization may be a relevant opportunity, given the missing meta description and sitemap.",
          evidence: [
            { sourceType: "WEBSITE_INSPECTION", field: "metaDescription" },
            { sourceType: "WEBSITE_INSPECTION", field: "sitemap" },
          ],
        },
        {
          type: "AI_INFERENCE",
          statement: "The site shows WordPress patterns, so performance optimization could be relevant.",
          evidence: [{ sourceType: "WEBSITE_INSPECTION", field: "techSignals" }],
        },
      ],
      recommendedServices: [
        {
          type: "AI_INFERENCE",
          statement: "SEO — missing meta description, sitemap, and image alt gaps suggest on-page SEO work.",
          evidence: [
            { sourceType: "WEBSITE_INSPECTION", field: "metaDescription" },
            { sourceType: "WEBSITE_INSPECTION", field: "sitemap" },
            { sourceType: "WEBSITE_INSPECTION", field: "imagesMissingAlt" },
          ],
        },
        {
          type: "AI_INFERENCE",
          statement: "Website redesign — basic technical signals indicate the site may not reflect a premium brand.",
          evidence: [{ sourceType: "WEBSITE_INSPECTION", field: "openGraph" }],
        },
      ],
      salesAngle: {
        text: "Lead with the concrete, verifiable gaps: their site is missing the basics search engines expect. Offer a free technical snapshot before pitching services.",
        evidence: [
          { sourceType: "WEBSITE_INSPECTION", field: "metaDescription" },
          { sourceType: "WEBSITE_INSPECTION", field: "sitemap" },
        ],
      },
      discoveryQuestions: [
        "Who currently manages your website, and when was it last updated?",
        "How do most of your export inquiries reach you today?",
        "Have you ever invested in SEO or paid advertising?",
      ],
      confidence: "MEDIUM",
      confidenceReason:
        "Website inspection data is available, but there is no Google Places rating/review data in this demo.",
      evidence: [
        { sourceType: "WEBSITE_INSPECTION", field: "title" },
        { sourceType: "GOOGLE_PLACES", field: "name" },
      ],
    },
  };
}

/**
 * Deterministic fictional lead score — same input always yields the same
 * output. NEVER calls Gemini, NEVER touches the database.
 */
export interface DemoLeadScore {
  id: string;
  leadId: string;
  score: number;
  scoreBand: "Low Fit" | "Moderate Fit" | "Strong Fit" | "Very Strong Fit";
  scoringVersion: "v1";
  dataLabel: "DEMO_DATA";
  aiEnriched: false;
  aiAssessment: null;
  confidence: null;
  createdAt: string; // ISO
  warnings: string[];
  factors: {
    factor: string;
    points: number;
    maximumPoints: number;
    direction: string;
    explanation: string;
    provenance: "VERIFIED_DATA" | "AI_INFERENCE" | "USER_PROVIDED" | "DEMO_DATA";
    evidence: { source: string; field: string; reference: string }[];
  }[];
  evidence: { source: string; field: string; reference: string }[];
}

export function getDemoLeadScore(leadId: string): DemoLeadScore {
  // Deterministic: derived from the leadId hash, stable across calls.
  let hash = 0;
  for (const ch of leadId) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  const jitter = hash % 5; // 0–4, keeps the demo stable but not identical
  const factors = [
    {
      factor: "Business Fit",
      points: 18,
      maximumPoints: 25,
      direction: "positive_sales_opportunity",
      explanation: "Category/identity fit for WDD services: business category is known (+8); category matches WDD service relevance (+10).",
      provenance: "USER_PROVIDED" as const,
      evidence: [{ source: "Lead", field: "industry", reference: `Lead:${leadId}` }],
    },
    {
      factor: "Website Opportunity",
      points: 21 + jitter,
      maximumPoints: 30,
      direction: "positive_sales_opportunity",
      explanation: "Verified website gaps signal service opportunities: missing meta description — SEO opportunity (+5); 3 image(s) missing alt — accessibility/SEO opportunity (+4); no sitemap.xml — discoverability opportunity (+3).",
      provenance: "VERIFIED_DATA" as const,
      evidence: [
        { source: "WebsiteInspection", field: "metaDescription", reference: "WebsiteInspection:demo-inspection-001" },
        { source: "WebsiteInspection", field: "imagesMissingAlt", reference: "WebsiteInspection:demo-inspection-001" },
        { source: "WebsiteInspection", field: "sitemap", reference: "WebsiteInspection:demo-inspection-001" },
      ],
    },
    {
      factor: "Digital Presence",
      points: 12,
      maximumPoints: 20,
      direction: "positive_sales_opportunity",
      explanation: "Established digital footprint: Google Business presence verified (+6); 1 social profile link(s) found (+3); public contact paths found on website (+3).",
      provenance: "VERIFIED_DATA" as const,
      evidence: [{ source: "Lead", field: "rating", reference: `Lead:${leadId}` }],
    },
    {
      factor: "Data Completeness",
      points: 12,
      maximumPoints: 15,
      direction: "informational",
      explanation: "Available data scored; not available (not negative): phone.",
      provenance: "USER_PROVIDED" as const,
      evidence: [{ source: "Lead", field: "website", reference: `Lead:${leadId}` }],
    },
    {
      factor: "AI Intelligence",
      points: 7,
      maximumPoints: 10,
      direction: "positive_sales_opportunity",
      explanation: "AI-identified opportunities (inference, not fact): AI intelligence report available (+3); AI confidence MEDIUM (+2); 2 AI-recommended services (+3).",
      provenance: "AI_INFERENCE" as const,
      evidence: [{ source: "LeadIntelligence", field: "confidence", reference: "LeadIntelligence:demo-intelligence-001" }],
    },
  ];
  const score = Math.min(
    100,
    factors.reduce((sum, f) => sum + f.points, 0),
  );
  const scoreBand =
    score >= 85
      ? ("Very Strong Fit" as const)
      : score >= 70
        ? ("Strong Fit" as const)
        : score >= 40
          ? ("Moderate Fit" as const)
          : ("Low Fit" as const);
  return {
    id: "demo-score-001",
    leadId,
    score,
    scoreBand,
    scoringVersion: "v1",
    dataLabel: "DEMO_DATA",
    aiEnriched: false,
    aiAssessment: null,
    confidence: null,
    createdAt: new Date().toISOString(),
    warnings: [],
    factors,
    evidence: factors.flatMap((f) => f.evidence),
  };
}
