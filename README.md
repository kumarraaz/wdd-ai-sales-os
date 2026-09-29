# WDD AI SALES OS

**Turn the Internet Into Your Sales Pipeline.**

WDD AI SALES OS is an AI-powered lead generation, lead intelligence, CRM,
outreach and sales automation platform. Discover qualified prospects,
understand their business, personalize outreach, and manage the entire sales
lifecycle from one dashboard.

> **Status: Phase 1 in progress** — foundation, auth, workspace, database,
> dashboard, leads and CRM kanban. See `ROADMAP.md` for the full plan.

---

## Features (current)

- **Authentication** — email/password with verification, password reset,
  optional Google OAuth, secure sessions (better-auth)
- **Multi-tenant workspaces** — Organization / Membership / Role
  (OWNER, ADMIN, SALES_MANAGER, SALES_EXECUTIVE, VIEWER); strict tenant
  isolation enforced server-side on every query
- **Dashboard** — real KPIs, lead-growth and pipeline charts, plan-usage panel
- **Lead management** — search / filter / sort / pagination, bulk actions,
  CSV import with column mapping, CSV/JSON export, duplicate detection
- **CRM kanban** — drag-and-drop pipeline (NEW → WON/LOST), optimistic UI
  with rollback, every move audit-logged
- **Security** — Zod validation, RBAC, rate limiting (Upstash with memory
  fallback), security headers + CSP, SSRF protection for user URLs,
  audit logs, no secrets in client code
- **Command palette** — ⌘K / Ctrl+K global search and navigation

## Tech stack

Next.js 15 · React 19 · TypeScript · Tailwind CSS v4 · Framer Motion ·
Prisma 7 · PostgreSQL (+ pgvector) · better-auth · Zod · TanStack Table ·
dnd-kit · cmdk · Recharts · Resend

## Getting started

### 1. Clone & install

```bash
git clone <your-repo-url> wdd-ai-sales-os
cd wdd-ai-sales-os
npm install
```

### 2. Environment

```bash
cp .env.example .env.local
# Edit .env.local — at minimum set DATABASE_URL and BETTER_AUTH_SECRET.
# Generate a secret: openssl rand -base64 32
```

See `.env.example` for every variable. **Never commit `.env.local`.**

### 3. Database (PostgreSQL)

Recommended: a free [Neon](https://neon.tech) project (PostgreSQL + pgvector).

```bash
npm run db:generate   # generate Prisma client
npm run db:migrate     # run migrations (creates tables)
npm run db:seed        # seed plans (+ fictional demo leads if SEED_DEMO_USER_EMAIL is set)
```

> Never edit production tables by hand — always use migrations.

### 4. Run

```bash
npm run dev     # http://localhost:3000
npm run build   # production build
npm run test    # unit tests (DB-backed isolation tests need DATABASE_URL)
```

### 5. Deploy to Vercel

1. Push the repo to GitHub.
2. Import into Vercel (framework preset: Next.js). In the Vercel project,
   set **Settings → Git → Production Branch to `master`** — this repo's
   production branch is `master` (the default `main` branch only holds the
   initial README). Pushes to any other branch produce Preview deployments.
   Every commit pushed must use a GitHub-linked author email (e.g. your
   GitHub noreply address) — Vercel rejects deployments whose commit author
   email is not associated with a GitHub account.
3. Add environment variables from `.env.example`
   (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, …).
4. Run migrations against the production DB (`npm run db:migrate` with the
   production `DATABASE_URL`, or `prisma migrate deploy` in CI).
5. Set OAuth callback URL: `https://<your-domain>/api/auth/callback/google`.
6. Webhooks (Phase 5): `https://<your-domain>/api/webhooks/<provider>`.

**Vercel limitations:** serverless functions have execution time limits —
long-running work (discovery, enrichment, campaign execution) runs on the
job system (Inngest, Phase 4), never inside a request handler.

## Project structure

```
app/                # Next.js App Router
  (auth)/           # login, signup, verify, forgot, reset
  (app)/            # authenticated app: dashboard, leads, crm
  api/              # REST API — every route tenant-guarded
components/
  app/              # dashboard/CRM/lead UI
  marketing/        # landing page sections
  ui/               # reusable primitives
lib/                # db, auth, tenant guard, validators, security, services
prisma/             # schema.prisma (37 models), seed.ts
tests/              # vitest — unit + tenant-isolation tests
```

## API overview

| Route | Purpose |
|---|---|
| `/api/auth/[...all]` | better-auth (sign in/out/up, verify, reset, OAuth) |
| `GET/POST /api/leads` | list (search/filter/paginate) · create |
| `GET/PATCH/DELETE /api/leads/[id]` | read · update · delete (role-gated) |
| `POST /api/leads/bulk` | bulk status/tags/assignment (cross-tenant ids rejected) |
| `GET /api/leads/export` | CSV / JSON export |
| `POST /api/leads/import` | CSV import with column mapping |
| `GET /api/usage` | plan usage for the workspace |

Business logic lives in `lib/` services — never in components.

## Security

- Authentication required on all `/app/*` pages and `/api/*` routes
- `withWorkspace()` resolves org membership server-side; client-supplied
  org ids/roles are never trusted (IDOR-safe)
- Tenant isolation covered by `tests/tenant-isolation.test.ts`
- Rate limits on auth, API, import; security headers + CSP; SSRF guard on
  user-submitted URLs; Zod on every input; audit log on mutations
- Secrets only in server env vars — nothing sensitive in `NEXT_PUBLIC_*`

See `ARCHITECTURE.md` §13–14 and `OPEN_SOURCE_RESEARCH.md` for the full
security model and dependency/license review.

## Demo mode (development only)

For inspecting the app shell without signup/email verification:

```bash
DEMO_MODE=true npm run dev
```

Then open `/login` and click **View Demo**. This opens the dashboard, leads,
and CRM with clearly labeled `DEMO_DATA` fixtures — no real account, no
database access. Safety properties (all covered by `tests/demo-mode.test.ts`):

- Only activates when `DEMO_MODE=true` **and** `NODE_ENV != "production"`
  (hard gate — can never run in production, even if the var is set).
- Production auth is untouched: demo tokens are random in-memory capabilities
  that can never satisfy `withWorkspace()` — every real API still 401s them.
- All demo API mutations return `403 Demo Mode — Action Disabled`; the demo
  fixture API is read-only and returns 404 when demo mode is off.
- A persistent **DEMO MODE** banner is shown; **Exit Demo** destroys the
  session and returns to `/login`. No secrets ever reach the client.

## Lead discovery (Phase 2)

The **Discover** page finds real companies via compliant providers and
imports them into the existing lead database (no second lead store).

- **Provider abstraction** (`lib/discovery/`): `LeadDiscoveryProvider`
  interface with a registry. `GooglePlacesProvider` uses only the official
  Places API (New) Text Search — no scraping, no CAPTCHAs bypassed, no
  proxies. `CsvImportProvider` adapts CSV rows into the same normalized
  shape. New providers implement the interface and register in
  `lib/discovery/registry.ts`.
- **API**: `GET /api/discovery/providers` (connection state, never keys),
  `POST /api/discovery/search` (quota-checked, rate-limited, recorded as a
  `DiscoveryRun`), `POST /api/discovery/import` (deduplicates with reasons,
  preserves source URL + provenance, audit-logged). All tenant-guarded via
  `withWorkspace()`; writes need `SALES_EXECUTIVE`.
- **Provenance**: imported leads are labeled `VERIFIED` with `sourceUrl`,
  `externalId` (place_id), `rating`, `reviewCount`, `discoveredAt`, plus
  per-field `LeadFieldProvenance` rows. Missing provider fields are shown
  as "not provided" — never invented.
- **Quotas**: `Plan.discoverySearchesPerDay` / `discoveryRecordsPerDay`,
  tracked daily in `UsageCounter` (`discoveries`, `discoveryRecords`,
  `discoveryImports`); searches are rejected before calling the provider
  when the quota is exhausted.
- **Setup**: set `GOOGLE_PLACES_API_KEY` (server-side only, never
  `NEXT_PUBLIC_*`). Without it, the UI shows "Google Places not connected"
  with configuration steps. Demo mode serves fictional `DEMO_DATA`
  fixtures and disables import.
- Tests: `tests/discovery.test.ts` (33 unit tests, mocked Google API),
  `tests/discovery-db.test.ts` (DB-gated: import, tenant isolation,
  dedup, quotas, provenance, audit).

## Website intelligence (Phase 2 Step 2)

The **Intelligence** page performs a safe technical inspection of a
lead/company website: HTTP status, redirects, HTTPS, response time, title,
meta, headings, images/alt, link counts, robots.txt, sitemap.xml, favicon,
Open Graph/Twitter cards, lang, structured data, viewport/mobile signal,
CMS signals, and public contact/social links.

- **SSRF-hardened fetcher** (`lib/intelligence/safe-fetch.ts`): every URL
  and every redirect hop passes the SSRF guard (DNS resolved, all addresses
  validated); the TCP connection uses a custom DNS lookup returning only
  validated addresses; manual redirects (max 5); per-hop timeout; 2 MiB
  body cap; HTML content-types only. Plain GET — no JS execution, forms,
  auth, or proxy rotation.
- **Parser** (`lib/intelligence/inspect.ts`, cheerio): directly observed
  facts are `VERIFIED_DATA`; heuristic CMS detection is marked
  `AI_INFERENCE` with evidence. Missing fields stay null — never invented.
- **Storage**: `WebsiteInspection` model (org/lead/company links, requested
  + final URL, findings JSON, error, `VERIFIED` label), indexed.
- **API**: `POST /api/intelligence/website-inspect` (`SALES_EXECUTIVE`,
  Zod, rate-limited, quota-checked *before* fetching, audit-logged),
  `GET /api/intelligence/website-inspections`.
- **Quotas**: `Plan.websiteInspectionsPerDay`, daily `UsageCounter`.
- Leads table has an **Inspect Website** action linking to
  `/intelligence?leadId=`. Demo mode serves fictional `DEMO_DATA`
  reports with no real HTTP requests.
- Tests: `tests/website-inspection.test.ts` (SSRF blocks, fetcher,
  parser, provenance, demo), `tests/website-inspection-db.test.ts`
  (DB-gated: persistence, tenant isolation, quota, audit).

## AI lead intelligence (Phase 2 Step 3)

Gemini acts as an ANALYSIS layer over existing verified data — it never
invents facts. Every inference cites supplied evidence; the server drops
inferences citing fields that were never provided.

- **Provider** (`lib/intelligence/ai-provider.ts`): server-side Gemini REST
  client. Key via `x-goog-api-key` header, never in URL/body/logs.
  Unconfigured → "AI Intelligence is not configured.", app keeps working.
- **Schema** (`lib/intelligence/intelligence-schema.ts`): Zod-validated
  structured output (summary, businessType, verifiedSignals,
  inferredOpportunities, recommendedServices, salesAngle,
  discoveryQuestions, confidence HIGH/MEDIUM/LOW, evidence).
- **Prompt** (`lib/intelligence/prompt.ts`): whitelisted fields only,
  truncated, size-capped; website content wrapped as UNTRUSTED DATA with
  injection defense.
- **Storage**: `LeadIntelligence` model (provider/model/prompt+schema
  versions, validated JSON, confidence, warnings, tokens); new row per
  generation — history preserved.
- **API**: `POST /api/intelligence/lead` (`SALES_EXECUTIVE`, quota before
  Gemini, audit-logged), `GET /api/intelligence/lead?leadId=`.
- **Quotas**: `Plan.aiIntelligencePerDay` + daily counter; token usage in
  existing `AIUsage`.
- Demo mode serves deterministic fictional `DEMO_DATA` with zero AI calls.
- Tests: `tests/ai-intelligence.test.ts` (mocked Gemini),
  `tests/ai-intelligence-db.test.ts` (DB-gated).

## Lead scoring (Phase 2 Step 4)

The **WDD Sales Opportunity Score** (0–100) answers: "How strong is the
currently available evidence that this lead has a relevant WDD sales
opportunity?" It is NOT a judgment of the business — a weak website
scores HIGHER because it signals a service opportunity.

- **Deterministic engine** (`lib/intelligence/scoring.ts`, `SCORING_VERSION = "v1"`):
  pure function of verified data, no LLM, no network. Five factors,
  each with points, max points, explanation, provenance, and evidence refs:
  - Business Fit (25): category known + relevant, business identity.
  - Website Opportunity (30): verified inspection gaps (missing meta,
    title, alt text, sitemap, OG tags, structured data, mobile, robots).
  - Digital Presence (20): Places rating/reviews, social links, contact paths.
  - Data Completeness (15): website, phone, email, location, source URL.
  - AI Intelligence (10): Step 3 report confidence + recommended services.
- **No double counting**: every verified field contributes to exactly one
  factor (enforced by construction and tests).
- **Missing data** scores 0 and is reported as "not available" /
  "insufficient evidence" — never as a negative business fact.
- **Bands**: 0–39 Low Fit, 40–69 Moderate Fit, 70–84 Strong Fit,
  85–100 Very Strong Fit.
- **Optional AI enrichment** (`lib/intelligence/scoring-ai.ts`): reuses the
  Step 3 Gemini provider to interpret the factor breakdown. It NEVER
  changes the score, is always labeled `AI_INFERENCE`, and is skipped
  gracefully when no key is configured. Malformed output is rejected;
  the deterministic score is always saved.
- **Storage**: extends the existing `LeadScore` model (score, band,
  version, factors/evidence JSON, confidence, provider, AI assessment,
  warnings); every run creates a new row — history preserved.
- **API**: `POST /api/intelligence/lead-score` (`SALES_EXECUTIVE`,
  rate-limited, quota-checked before any AI call, audit-logged),
  `GET /api/intelligence/lead-score?leadId=`.
- **Quotas**: `Plan.leadScoringPerDay` + daily counter; AI enrichment
  additionally consumes the AI intelligence quota + token usage.
- **UI**: "AI Lead Score" section on the Intelligence page — score, band,
  per-factor cards with points/provenance/evidence, AI interpretation.
- **Demo**: deterministic `DEMO_DATA` fixture, no Gemini, no DB writes.
- Tests: `tests/lead-scoring.test.ts` (19 unit), `tests/lead-scoring-db.test.ts`
  (DB-gated: history, tenant isolation, quota, audit).

## Discovery → CRM pipeline (Phase 2 Step 5 — final)

The complete Phase 2 architecture:

**Discovery → Lead → Website Intelligence → AI Lead Intelligence →
WDD Sales Opportunity Score → CRM**

The pipeline is **user-controlled end to end**. Discovery results are never
silently converted into CRM opportunities — the user selects leads, reviews
a preview, and explicitly confirms the import.

- **Manual confirmation required**: `/discover` → select (Select All /
  Clear) → **Import Selected** opens a preview dialog → user confirms.
  No auto-conversion, no bulk import without review.
- **Import preview** (`POST /api/discovery/import-preview`, `SALES_EXECUTIVE`,
  rate-limited, read-only — nothing is created): per selected lead shows
  business name, category, location, website, phone, source, provenance,
  duplicate status, existing CRM stage, and linked intelligence status
  (website report, AI intelligence, score).
- **Duplicate detection** (`lib/discovery/matching.ts`, deterministic):
  1. External provider ID + provider → `already_exists`
  2. Canonical website URL (protocol/www/case/trailing-slash normalized)
  3. Normalized phone (digits)
  4. Business name + location → **"Possible duplicate — review required"**
     (imported but flagged, never silently merged).
  Name-only matches are never treated as definitive. Original source values
  are never modified.
- **Idempotency**: re-submitting the same discovery result returns
  `already_exists` — never a second CRM lead.
- **Per-lead outcomes**: `imported` / `already_exists` / `possible_duplicate`
  / `skipped` / `failed` — partial failures are visible, never rolled back
  into successes, and never hidden.
- **Initial CRM state**: imported leads enter at the **NEW** stage (predictable
  and documented). AI scores never move a lead to Qualified/Contacted/
  Meeting/Proposal/Won. AI outputs are **recommendations only** — they cannot
  mark leads contacted, create deals, send outreach, create meetings, mark
  wins, or change ownership.
- **Intelligence links preserved**: `Lead → WebsiteInspection →
  LeadIntelligence → LeadScore` relational links are reused; the lead detail
  page (`/leads/[id]`) shows source, provenance, discovery/inspection/AI/
  scoring timestamps, and links to the Intelligence page.
- **Provenance**: `VERIFIED_DATA` (Places, website inspection), `AI_INFERENCE`
  (Step 3/4), `USER_PROVIDED`, `DEMO_DATA`. AI-generated values never become
  verified.
- **Audit**: every import logs actor, org, action, lead IDs, provider, and
  outcome counts. No API keys, cookies, or secrets are logged.
- **Demo mode**: demo import is a deterministic simulation
  (`POST /api/demo/discovery/import`) — no DB writes, no external APIs,
  no Gemini, no real CRM mutation; everything labeled `DEMO_DATA`.
- **Security**: existing tenant isolation, RBAC, Zod validation, rate limits,
  quotas, SSRF protection, and security headers all apply unchanged.
- Tests: `tests/discovery-matching.test.ts` (14 unit), `tests/discovery-import-db.test.ts`
  (9 DB-gated: import, idempotency, hierarchy, possible duplicates,
  tenant isolation, intelligence links, partial outcomes).

## Roadmap

`ROADMAP.md` tracks all 8 phases. Phase 1 (this repo state): foundation,
auth, workspace, database, dashboard, CRM.

## License

Proprietary — © Web Digital Development. Third-party open-source
dependencies and their licenses are documented in `OPEN_SOURCE_RESEARCH.md`.
