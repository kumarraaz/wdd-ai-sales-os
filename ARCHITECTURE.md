# WDD AI SALES OS — Architecture

> Status: planning / Phase 0. This document is the technical source of truth.
> Updated: 2026-09-28.

## 1. Product summary

**WDD AI SALES OS** is a multi-tenant public SaaS: an AI-powered sales operating
system covering the full pipeline — **Discover → Enrich → Qualify → Research →
Personalize → Approve → Outreach → Follow up → Convert → Analyze**.

It is NOT a scraper with a dashboard. Every data point carries provenance
(source, URL, retrievedAt, confidence) and every AI statement is labeled
`VERIFIED` / `AI_INFERENCE` / `USER_PROVIDED` / `DEMO`.

## 2. Tech stack (locked for Phase 1)

| Layer        | Choice                                                              |
|--------------|---------------------------------------------------------------------|
| Framework    | Next.js 15 (App Router), React 19, TypeScript (strict)              |
| Styling      | Tailwind CSS v4, Framer Motion (motion), Lucide icons               |
| 3D (selective, lazy) | three, @react-three/fiber, @react-three/drei — hero + viz only |
| Charts       | Recharts (already in repo)                                          |
| Tables       | TanStack Table (virtualized where needed)                           |
| Kanban       | dnd-kit (MIT)                                                       |
| Cmd palette  | cmdk                                                                |
| DB           | PostgreSQL (external: Neon / Vercel Postgres / Supabase / self-host)|
| ORM          | Prisma (migrations = only way to change schema)                     |
| Validation   | Zod (every API route, every form)                                   |
| Auth         | better-auth (MIT) — email/password (Argon2id) + Google OAuth, organization + RBAC plugins |
| Email send   | Resend (already a repo dependency) + SMTP fallback (nodemailer — verify license field at install) |
| Jobs         | Inngest (serverless-native durable execution; Trigger.dev as self-hostable alternative) |
| Rate limit   | @upstash/ratelimit (+ @upstash/redis) with in-memory fallback for dev |
| AI           | Vercel AI SDK behind our own `AIProvider` interface (Gemini default, OpenAI/Anthropic switchable) |
| CSV          | papaparse                                                           |
| Tests        | Vitest (unit/API) + Playwright (critical flows)                     |
| Deploy       | Vercel (web) + external Postgres + jobs provider                    |

Decisions marked TBD are resolved in `OPEN_SOURCE_RESEARCH.md`.

## 3. Repository layout

```
prisma/
  schema.prisma          # single source of truth for the DB
  migrations/            # generated, never hand-edited
  seed.ts                # demo data (clearly labeled DEMO)
src/
  app/
    (marketing)/         # public landing, pricing, faq — SEO, noindex for /app
    (auth)/              # sign-in, sign-up, verify, reset
    (app)/               # protected: dashboard, leads, discover, crm, campaigns…
    api/                 # route handlers — thin, delegate to services
  components/
    ui/                  # design system primitives (button, card, table…)
    marketing/           # landing sections (reuses BioFuelRates primitives)
    app/                 # dashboard shell, sidebar, command palette
    leads/ campaigns/ …  # feature components
  features/              # feature modules: leads, discovery, campaigns, automation…
  services/              # business logic (leadService, campaignService…)
  providers/             # integration abstractions (email, whatsapp, telegram…)
    email/ whatsapp/ telegram/ discovery/ verification/
  ai/
    provider.ts          # AIProvider interface + registry
    prompts/             # versioned system prompts (never include secrets)
    guardrails.ts        # prompt-injection defenses, output labeling
  automation/
    engine.ts            # trigger → condition → action → delay executor
    triggers.ts conditions.ts actions.ts
  security/
    tenant.ts            # withWorkspace() guard — EVERY protected route uses it
    rateLimit.ts quotas.ts ssrf.ts urls.ts files.ts audit.ts
  jobs/
    definitions.ts       # job names + payloads + queues
  db/                    # prisma client singleton
  lib/                   # formatting, dates, csv, utils
  types/                 # shared TS types
  workers/               # job handlers (or jobs-provider functions)
middleware.ts            # auth gate for (app) routes
```

**Rule:** UI components never touch Prisma directly. API routes validate (Zod) →
`security/tenant.ts` guard → service → Prisma.

## 4. Multi-tenancy (hard rule)

```
User 1—* Membership *—1 Organization ( = Workspace )
```

- Every business record carries `organizationId`. No exceptions.
- `withWorkspace(req)` resolves the session → membership → organization, and
  returns a **scoped Prisma client** (a thin wrapper that injects
  `organizationId` into every query's `where`). Services receive the scoped
  client, never the raw one.
- Cross-tenant access = IDOR. Tested explicitly (see TESTING below).
- Roles: `OWNER > ADMIN > SALES_MANAGER > SALES_EXECUTIVE > VIEWER`.
  Server-side role checks on every mutation; client role display is cosmetic.

## 5. Authentication

- **better-auth** (MIT): Credentials (Argon2id-hashed passwords) + Google OAuth
  (when `GOOGLE_CLIENT_ID/SECRET` are set; otherwise the button is hidden, not faked).
  Organization plugin → Org/Workspace/Membership; RBAC plugin → roles.
- Email verification required before workspace access; forgot/reset via
  single-use hashed tokens with expiry.
- Sessions: database sessions, secure httpOnly cookies, CSRF via better-auth
  defaults + `Origin` checks on mutations.
- On signup: create `User` + personal `Organization` + `Membership(OWNER)`.

## 6. Provider abstractions (the anti-fake layer)

Every external capability is an interface with ≥2 implementations:
a real one (requires credentials) and an explicit `Demo*` one.

```ts
interface LeadSourceProvider {
  id: string;                       // 'google-business' | 'csv' | 'manual' | 'api' | 'demo'
  label: string;
  requiresCredentials: boolean;
  discover(params: DiscoveryParams, ctx: JobContext): AsyncGenerator<DiscoveryEvent>;
}
// EmailProvider, WhatsAppProvider, TelegramProvider, EmailVerificationProvider,
// AIProvider — same pattern.
```

UI rule: if `requiresCredentials && !connected` → show **Connect / Use Demo**,
never a fake success. Demo data is seeded fiction, labeled `DEMO_DATA`.

## 7. Lead discovery engine

- Discovery runs as a **background job** (`jobs.definitions: leadDiscovery`),
  streaming progress events (searching → found → enriching → scoring →
  deduplicating) via SSE/polling to the Discover page.
- Params: country/state/city/area, industry, category, keywords,
  website-availability, company size, rating, lead limit.
- **Safety:** providers use only official APIs, permitted directories,
  user uploads, or demo mode. No CAPTCHA/anti-bot bypass, no credential
  theft, no fake accounts — ever. (See section 13.)

## 8. Enrichment / research / scoring

- Enrichment job fetches **public** company data (website, public contact
  info), stores `source`, `sourceUrl`, `retrievedAt` per field.
- AI research runs on verified data only; external page content is wrapped
  as `UNTRUSTED` input; outputs are labeled `AI_INFERENCE`.
- Lead score 0–100 = weighted factors (industry fit, location fit, website
  signal, contactability, buying signal, ICP match). Score breakdown and
  "why this scored high" are stored on `LeadScore`.
- Never fabricate employees/revenue/contacts/owners.

## 9. Outreach & automation

- Outreach center: Email / WhatsApp / Telegram / LinkedIn(draft-only) / SMS /
  Manual copy. Every channel: **Draft → Preview → Approve → Send/Schedule → History**.
- `approvalMode`: `AUTO | MANUAL | APPROVAL_REQUIRED` (default `APPROVAL_REQUIRED`).
- Automation engine: visual builder (Trigger → Condition → Action → Delay…).
  Executors run as jobs; every external action passes through the approval
  gate + quota check + audit log.
- **Kill switches:** per-campaign `STOP`, workspace-level `PAUSE ALL
  AUTOMATIONS` — sets a flag checked by every job before any external action.

## 10. Campaigns & follow-ups

- Campaign: name, audience/ICP, channels, sequence steps, schedule,
  daily limits, approval mode, timezone, dates. Statuses:
  `DRAFT|ACTIVE|PAUSED|COMPLETED|ARCHIVED`.
- Metrics shown **only if the provider reports them** (delivered/opened/
  clicked) — no invented stats.
- Follow-up engine: Day 0/3/7/14 default sequence; auto-stops on reply,
  meeting, closed, or manual stop.

## 11. Background jobs

Long work never blocks HTTP: discovery, enrichment, research, scoring,
message generation, campaign execution, follow-ups, analytics aggregation.

**Provider: Inngest** (serve route at `/api/inngest`; durable sleep powers the
follow-up engine). Job types are abstracted so Trigger.dev (self-hostable,
Apache-2.0) can replace it later without rewriting business logic.

Job lifecycle: `QUEUED → RUNNING → COMPLETED | FAILED | RETRYING`,
visible in Admin + workspace job views. Prisma remains the source of truth.

## 12. Security architecture

- Zod validation on all inputs; Prisma only (no raw SQL from user input).
- Tenant isolation wrapper (section 4) + tenant-isolation tests.
- Rate limits: login/signup/reset, discovery, AI, sending, webhooks, API.
- SSRF protection: URL validator blocks localhost, 127.0.0.1, private
  ranges (10/8, 172.16/12, 192.168/16), link-local 169.254/16 (cloud
  metadata), with DNS-rebinding awareness.
- File uploads: type allowlist, size limits, stored private (signed URLs).
- Webhook signature verification per provider; secrets server-side only,
  never `NEXT_PUBLIC_`, never returned to client (masked `••••1234`).
- Security headers + CSP (practical subset), XSS escaping by default (React),
  audit log for every sensitive action.
- Quotas per user/workspace: leads, AI tokens, messages, campaigns —
  surfaced in UI (`342 / 500`).

## 13. Abuse & safety rails (non-negotiable)

- No CAPTCHA/anti-bot bypass, no proxy-rotation-for-evasion, no credential
  stuffing, no fake account creation, no browser-fingerprint evasion.
- Sources behind login → "Connect Account / Use Official API / Import / Demo".
- Outreach quotas + approval default prevent spam; malware/phishing content
  blocked at draft validation.
- Prompt injection: external content is data, never instructions; system
  prompts and keys never leave the server.

## 14. AI cost control

- `AIUsage` row per call: provider, model, tokens, est. cost, operation,
  user, workspace, timestamp.
- Cache research/scoring results; never re-run AI for unchanged inputs.
- Workspace AI token quotas with UI meter; hard stop at limit.

## 15. Analytics, notifications, audit

- Product analytics: signups, active users, leads discovered/qualified,
  campaigns, messages, replies, meetings, conversions — always tenant-scoped.
- Notifications: in-app + email (when configured): new lead, qualified,
  reply, follow-up due, campaign done, integration failure, security event.
- AuditLog: who did what, when, where, resource, result
  (e.g. "Raj approved email for lead #123 at 10:42 AM").

## 16. Demo mode

- Works with zero external keys. Seeded fictional companies
  (e.g. "Acme Industrial Exports, Delhi") labeled `DEMO_DATA`.
- Discovery simulation, AI research simulation, scoring, message generation,
  campaigns, CRM, analytics — all functional against demo data.

## 17. API surface

`/api/auth/*` (Auth.js), `/api/leads`, `/api/leads/discover`,
`/api/leads/enrich|score|research`, `/api/companies`, `/api/contacts`,
`/api/campaigns[/:id]`, `/api/outreach`, `/api/email`, `/api/whatsapp`,
`/api/telegram`, `/api/integrations`, `/api/automation`, `/api/tasks`,
`/api/analytics`, `/api/ai/*` (assistant, command center), `/api/webhooks/*`,
`/api/billing`, `/api/admin/*` (platform admin only).

All JSON, Zod-validated, tenant-guarded, rate-limited, audited.

## 18. Deployment

- **Vercel:** web app (requires `DATABASE_URL`, `AUTH_SECRET`, … — see `.env.example`).
- **Postgres:** Neon / Vercel Postgres / Supabase / self-hosted.
- **Jobs:** provider-dependent (Inngest Cloud / pg-boss in Postgres / Redis for BullMQ).
- **Cron:** Vercel Cron for follow-up sweeps + analytics aggregation
  (or jobs-provider schedules).
- **Webhooks:** public HTTPS URLs configured per provider (WhatsApp/Telegram/email).
- **PWA:** manifest + icons + service worker (offline shell for app pages),
  installable; "Download App" → "Mobile App Coming Soon" (no fake APK).
- Mobile apps later reuse the same `/api/*` (React Native/Expo).

## 19. Testing strategy

- Vitest: unit (scoring, quotas, SSRF validator, dedup) + API route tests.
- **Tenant isolation tests are mandatory:** User A cannot read/write User B's
  leads, campaigns, messages, keys, analytics — asserted per resource.
- Auth tests: bypass attempts, role escalation, expired tokens.
- Playwright: signup → workspace → discover (demo) → score → campaign →
  approve → send (demo provider) smoke test.
- Security checklist (sec. 67 of spec) re-run before every phase sign-off.

## 20. Relationship to the BioFuelRates codebase

This project was scaffolded from the BioFuelRates foundation (Next.js 15 +
React 19 + TS + Tailwind v4 + Framer Motion + Lucide + Recharts + Resend) and
keeps its reusable primitives (`components/ui`: Reveal, SectionHeader,
StatCard, AnimatedCounter, FAQ), its SEO pattern, and its form-validation
patterns. The BioFuelRates site itself is untouched in its own repository
(`kumarraaz/Biofuel-Rates`); this repo is a clean, independent project.
