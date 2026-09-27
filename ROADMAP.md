# WDD AI SALES OS — Roadmap

> Phases are sequential. A phase is DONE only when: `npm run lint` ✅,
> `npm run build` ✅, tests ✅, security checklist ✅, docs updated, committed.
> Never start the next phase with known build-breaking errors.

## Phase 0 — Planning & architecture ✅ (this phase)
- [x] Inspect existing repo (BioFuelRates: Next.js 15 / React 19 / Tailwind v4 / Framer Motion / Recharts / Resend)
- [x] Open-source research → `OPEN_SOURCE_RESEARCH.md`
- [x] `ARCHITECTURE.md` (stack, tenancy, security, jobs)
- [x] `ROADMAP.md` (this file)
- [x] Database architecture → `prisma/schema.prisma`
- [x] Implementation plan + repo decision (NEW separate project `wdd-ai-sales-os`; BioFuelRates untouched)
- [x] Raj confirmed: proceed to Phase 1 ("start new project", 2026-09-28)

## Phase 1 — Foundation (weeks 1–2) — IN PROGRESS
**Goal:** real users, real auth, real DB, real dashboard.
- [x] Prisma schema (better-auth-compatible auth models) + seed script (demo data)
- [x] better-auth: email/password, Google OAuth (optional), verify/reset, sessions
- [x] Org/Workspace/Membership + roles (OWNER…VIEWER); tenant guard `withWorkspace()`
- [x] App shell: sidebar (30-module nav), topbar, command palette (Cmd+K), AI assistant placeholder
- [x] Dashboard: KPI cards + charts from REAL DB queries (empty states when no data)
- [x] Lead CRUD + lead table (search/filter/sort/pagination/bulk/export/import CSV)
- [x] CRM kanban (NEW→…→WON/LOST) with drag-and-drop
- [x] Audit log on mutations; rate limiting; security headers + CSP
- [x] Landing page v1 (hero + how-it-works + features + pricing + FAQ + footer) — built by subagent, compiled in build
- [x] `.env.example`, README (setup)
- [x] Tests: unit (validators, SSRF, RBAC, rate-limit) + tenant isolation (needs DATABASE_URL)
- [ ] Postgres (Neon) wired — BLOCKED: needs DATABASE_URL from Raj
- [ ] PWA manifest
- **Acceptance:** signup → workspace → create lead → move card → logout; Vercel deploy green

## Phase 2 — Discovery & intelligence (weeks 3–4)
- Discovery engine: provider interface + Demo/Google-Business-stub/CSV/Manual/API providers
- Discover page: source cards → params → live progress (SSE) → results
- Enrichment + dedup (email/domain/phone/company) + "possible duplicate" merge UI
- AI research (company overview, pain points, sales angle, sources) — labeled inference
- AI lead scoring (0–100 + breakdown + "why high")
- Lead profile page (overview/company/contact/AI/score/activity/messages/timeline/sources)
- Data provenance on every field (source, URL, retrievedAt)
- Quotas: discovery limits per workspace; usage meters
- **Acceptance:** discover 20 demo leads → enrich → score → no duplicates → research with sources

## Phase 3 — AI assistant & outreach (weeks 5–6)
- AI Sales Assistant (chat dock): research lead, summarize, sales angle, drafts
  (email/WhatsApp/Telegram/LinkedIn/follow-up/call script/proposal outline),
  reply classification, next-action suggestions
- AI Command Center: natural-language → safe app actions (confirmation for external/destructive)
- Outreach center: per-channel Draft → Preview → Approve → Send/Schedule → History
- Manual mode: bulk select → Generate → Copy/Edit/Approve; "Open WhatsApp/Telegram/Email" deep links
- Conversations inbox (unified threads)
- **Acceptance:** select 20 leads → generate → approve → send via demo provider; history recorded

## Phase 4 — Campaigns, follow-ups, automation (weeks 7–8)
- Campaign builder + dashboard (metrics only from provider data)
- Follow-up engine (Day 0/3/7/14; auto-stop on reply/meeting/close)
- Visual automation builder (Trigger→Condition→Action→Delay)
- Approval system (AUTO/MANUAL/APPROVAL_REQUIRED, default approval)
- Kill switches: per-campaign STOP ALL; workspace PAUSE ALL AUTOMATIONS
- Job system live (discovery/enrichment/scoring/campaign/follow-up jobs with status UI)
- **Acceptance:** campaign with approval gate sends only after approval; kill switch halts pending sends

## Phase 5 — Real integrations (weeks 9–10)
- Email: Resend + SMTP + Gmail API + Microsoft Graph (provider abstraction)
- WhatsApp Business Platform provider (send/receive/templates/webhook); "Connect" UX when unconfigured
- Telegram Bot API provider (send/receive/webhook)
- Instagram/LinkedIn: compliant architecture — Generate+Copy+Open Profile where APIs forbid automation; "Coming Soon" where unsupported
- Integration center: cards with Connected/Not Connected/Configure/Test (secrets masked)
- Encrypted credential storage; webhook signature verification
- **Acceptance:** connect Resend → send real email; WhatsApp sandbox message round-trip

## Phase 6 — Analytics, security, admin (weeks 11–12)
- Analytics dashboards (tenant-scoped): funnel, pipeline, source/channel/campaign performance
- AI Daily Sales Manager briefing (generated from real DB data)
- Admin panel (platform): users, orgs, usage, jobs, failures, abuse signals, audit
- Notifications (in-app + email): lead events, replies, follow-ups due, security events
- Security hardening pass + full checklist (sec. 67): IDOR, XSS, SSRF, CSRF, rate-limit, webhook spoofing, secret exposure
- Billing architecture: plans FREE/PRO/BUSINESS/ENTERPRISE, "Premium — Coming Soon" locked UI, usage meters
- **Acceptance:** briefing numbers match DB; admin sees cross-tenant health but not lead contents without grant

## Phase 7 — Polish & launch readiness (week 13)
- Performance: lazy 3D, code-split, virtualized tables, indexes verified, caching
- Accessibility: keyboard, ARIA, focus, reduced-motion, contrast audit
- SEO: metadata/OG/Twitter/sitemap/robots/JSON-LD (public pages only; /app noindex)
- PWA installable; "Download App" → honest Coming Soon
- Playwright E2E: full smoke (signup → discover → score → campaign → approve → send)
- `npm audit` reviewed; dependency licenses documented
- README complete (install/env/DB/dev/test/deploy/security/licenses/API/roadmap)
- **Acceptance:** FINAL ACCEPTANCE TEST (spec sec. 91) all checked

## Phase 8 — Post-launch (future)
- Real billing (Stripe) when credentials provided
- Advanced agents (research/qualification/personalization/outreach/follow-up/CRM/analytics) with permissions
- Enterprise SSO, white-labeling, public API + webhooks, custom AI models
- React Native/Expo mobile app on the same `/api/*`
