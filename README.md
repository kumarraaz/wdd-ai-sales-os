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
2. Import into Vercel (framework preset: Next.js).
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

## Roadmap

`ROADMAP.md` tracks all 8 phases. Phase 1 (this repo state): foundation,
auth, workspace, database, dashboard, CRM.

## License

Proprietary — © Web Digital Development. Third-party open-source
dependencies and their licenses are documented in `OPEN_SOURCE_RESEARCH.md`.
