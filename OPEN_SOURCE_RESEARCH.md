# Open-Source Research — WDD AI SALES OS

> Researched 2026-09-28 against GitHub repos + published docs. No code copied, no packages installed.
> Rule applied throughout: **MIT / Apache-2.0 / BSD / ISC = usable as dependency.**
> **GPL / AGPL = architecture reference only — no code copied into the proprietary app.**

## Selected dependencies

### Authentication

| Field | Value |
|---|---|
| Project | better-auth |
| GitHub URL | https://github.com/better-auth/better-auth |
| Purpose | Self-hosted auth: email/password (Argon2id), 30+ OAuth providers, organization plugin (multi-tenancy), admin/RBAC plugin, rate-limit plugin |
| License | MIT — commercial SaaS use permitted |
| Why selected | Runs inside the Next.js app (Prisma adapter); organization plugin maps 1:1 to Org/Workspace/Membership; RBAC plugin maps to OWNER…VIEWER roles; no vendor lock-in; Vercel-serverless-safe. Auth.js was absorbed by the Better Auth team (Sept 2025) and is now maintenance-only with v5 still in beta — better-auth is the maintained path |
| Security notes | App-owned revocable DB sessions; keep `BETTER_AUTH_SECRET` server-side; no supply-chain incidents found; ecosystem is young — pin versions |
| Integration method | npm dependency (`better-auth`, Prisma adapter) |
| Alternative considered | Auth.js v5 (maintenance mode, rejected) · Lucia (deprecated Mar 2025, rejected) · Clerk/Supabase Auth (vendor coupling, rejected) |

### Email sending

| Field | Value |
|---|---|
| Project | Resend (SDK: resend-node) + react-email |
| GitHub URL | https://github.com/resend/resend-node · https://github.com/resendlabs/react-email |
| Purpose | Transactional email API + React-based email templates |
| License | MIT (SDKs) — the sending platform is proprietary SaaS API, used as an integration |
| Why selected | Cleanest `EmailProvider` implementation; React templates match stack; `resend` already a repo dependency |
| Security notes | API key server-side only, never `NEXT_PUBLIC_`; verify webhook signatures; DKIM/SPF/DMARC per Resend docs |
| Integration method | npm (`resend`, `react-email`, `@react-email/components`) + SaaS API key |
| Alternative considered | nodemailer (SMTP fallback — **verify `license` field at install: current = "MIT No Attribution", but v3–v6.x were EUPL-1.1 copyleft**) · SendGrid/Microsoft Graph (later providers behind same interface) |

### Email verification (API, not self-built)

| Field | Value |
|---|---|
| Project | Kickbox / Emailable / Bouncer (commercial API) behind `EmailVerificationProvider` |
| GitHub URL | n/a (SaaS APIs) · OSS fallback: https://github.com/reacherhq/check-if-email-exists |
| Purpose | Real email verification → statuses VALID/INVALID/UNKNOWN/RISKY/DISPOSABLE/ROLE_BASED |
| License | Commercial API terms; Reacher is AGPL-3.0 → API-use only, no code copied |
| Why selected | Never build own SMTP verifier (abuse/anti-spam risk, poor accuracy); never label "verified" without a real provider result |
| Security notes | API key server-side; results cached per address |
| Integration method | SaaS API integration via provider interface |
| Alternative considered | Self-built SMTP checks (rejected — abuse risk) |

### Background jobs (Vercel serverless is the deciding constraint)

| Field | Value |
|---|---|
| Project | Inngest (primary) |
| GitHub URL | https://github.com/inngest/inngest-js |
| Purpose | Event-driven durable execution on serverless: background jobs, step functions, durable sleep (follow-up sequences), retries, concurrency, cron |
| License | SDK Apache-2.0 (open-core platform; managed cloud default, self-host option exists) |
| Why selected | Durable sleep solves "wait 3 days, if no reply, follow up" without state machines; zero infra to start; serve route lives in the Next.js app (`/api/inngest`); Prisma remains source of truth |
| Security notes | Sign serve handler with `INNGEST_SIGNING_KEY`; verify event signatures; vendor lock-in mitigated by abstracting job types |
| Integration method | npm (`inngest`) + serve route |
| Alternative considered | Trigger.dev (Apache-2.0, fully self-hostable — second pick, best if avoiding vendor lock-in; native human-in-the-loop waitpoints fit approvals) · pg-boss (MIT, needs separate worker host — deferred) · BullMQ (needs Redis + always-on worker — rejected for this deploy model) |

### AI provider layer

| Field | Value |
|---|---|
| Project | Vercel AI SDK |
| GitHub URL | https://github.com/vercel/ai |
| Purpose | Provider-agnostic AI: `generateText`/`streamText`, Zod structured outputs, tool calling, agent loops, React hooks |
| License | Apache-2.0 — commercial SaaS use permitted |
| Why selected | Implements the required `AIProvider` abstraction directly (`ai` + `@ai-sdk/google`/`@ai-sdk/openai`/`@ai-sdk/anthropic`); `AI_PROVIDER=gemini` env switching; structured output for scoring/research |
| Security notes | Keys server-side only; scraped webpage content treated as untrusted data in prompts (prompt-injection boundary); log tokens per call → `AIUsage` table |
| Integration method | npm (`ai`, `@ai-sdk/google`, others as configured) |
| Alternative considered | LangChain.js (heavier, faster churn — deferred) · direct provider SDKs (unnecessary indirection loss) |

### Vector search / RAG

| Field | Value |
|---|---|
| Project | pgvector |
| GitHub URL | https://github.com/pgvector/pgvector |
| Purpose | PostgreSQL extension for embeddings + HNSW similarity search (lead similarity/dedupe, RAG over research) |
| License | PostgreSQL License (permissive) — permitted |
| Why selected | No separate vector DB to operate; works with Prisma via `Unsupported("vector(n)")` + raw SQL; ships in Neon/Supabase/RDS |
| Security notes | Extension must be allow-listed by managed Postgres; always include `organizationId` in similarity queries (tenant isolation) |
| Integration method | DB extension (`CREATE EXTENSION vector`) + Prisma raw SQL; no npm package |
| Alternative considered | Pinecone/Weaviate (extra vendor + cost — rejected for now) |

### Rate limiting

| Field | Value |
|---|---|
| Project | @upstash/ratelimit (+ @upstash/redis) |
| GitHub URL | https://github.com/upstash/ratelimit |
| Purpose | Serverless-safe rate limiting (fixed/sliding window, token bucket) for auth, discovery, AI, sending, webhooks, API |
| License | MIT — permitted |
| Why selected | Works on Vercel serverless/edge over HTTP (no TCP sockets); per-endpoint limiters; free tier to start |
| Security notes | Credentials server-side; 429 + `Retry-After`; key by user/org id when authed, IP otherwise |
| Integration method | npm + free Upstash Redis DB |
| Alternative considered | universal-rate-limit (MIT, acceptable fallback) |

### Validation

| Field | Value |
|---|---|
| Project | Zod |
| GitHub URL | https://github.com/colinhacks/zod |
| Purpose | TS-first schema validation: API inputs, env, AI structured outputs |
| License | MIT — permitted |
| Why selected | Standard; `.strict()`/`.strip()` on API inputs; AI SDK v7 accepts zod v4 |
| Security notes | Validation = attack-surface reduction; never trust client payloads |
| Integration method | npm (`zod`) |
| Alternative considered | Valibot (lighter; Zod familiarity wins) |

### Data tables

| Field | Value |
|---|---|
| Project | TanStack Table (+ TanStack Virtual for 10k+ rows) |
| GitHub URL | https://github.com/TanStack/table |
| Purpose | Headless table: sort/filter/faceted filters/server pagination/column pinning/row selection/bulk select |
| License | MIT — permitted |
| Why selected | Lead DB needs full table power with our Tailwind styling; virtualization for scale |
| Security notes | UI-only — server must enforce pagination limits and tenant scoping regardless of client params |
| Integration method | npm (`@tanstack/react-table`, `@tanstack/react-virtual`) |
| Alternative considered | AG Grid (enterprise license for full features — rejected) |

### Kanban drag-and-drop

| Field | Value |
|---|---|
| Project | dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable`) |
| GitHub URL | https://github.com/clauderic/dnd-kit |
| Purpose | Accessible, performant drag-and-drop; multi-column kanban pattern |
| License | MIT — permitted |
| Why selected | react-beautiful-dnd is dead + incompatible with React 19; dnd-kit supports React 19, small bundle, good a11y |
| Security notes | UI-only — persist moves via authenticated API; validate column transitions server-side |
| Integration method | npm |
| Alternative considered | @hello-pangea/dnd (MIT fork of rbdnd — fine fallback) |

### Command palette / global search

| Field | Value |
|---|---|
| Project | cmdk (+ fuse.js for fuzzy ranking) |
| GitHub URL | https://github.com/pacocoursey/cmdk |
| Purpose | ⌘K / `/` global search across leads, companies, contacts, campaigns, tasks |
| License | MIT (cmdk); Apache-2.0 (fuse.js) — permitted |
| Why selected | Fast, accessible, tiny; server-side search at scale |
| Security notes | Search API tenant-scoped; never leak other orgs' results |
| Integration method | npm |
| Alternative considered | Custom (unnecessary) |

### 3D (selective, lazy-loaded only)

| Field | Value |
|---|---|
| Project | three.js + @react-three/fiber + @react-three/drei |
| GitHub URL | https://github.com/mrdoob/three.js · https://github.com/pmndrs/react-three-fiber · https://github.com/pmndrs/drei |
| Purpose | Hero 3D AI network + dashboard visualizations |
| License | MIT (all three) — permitted |
| Why selected | Standard React 3D stack; R3F v9 requires React 19 (repo is React 19 ✓) |
| Security notes | Renders own geometry only (no user-content parsing); canvas decorative → aria-hidden + text alternative; `prefers-reduced-motion` respected |
| Integration method | npm, **`next/dynamic` with `ssr:false`, never on critical path** |
| Alternative considered | Plain CSS/SVG motion (fallback for reduced-motion + low-end devices) |

### Charts

| Field | Value |
|---|---|
| Project | Recharts (already in repo) |
| GitHub URL | https://github.com/recharts/recharts |
| Purpose | Lead growth, pipeline, funnel, source/channel/campaign charts |
| License | MIT — permitted |
| Why selected | Already a dependency; keep |
| Security notes | None specific |
| Integration method | Existing npm dependency |
| Alternative considered | n/a |

### CSV import/export

| Field | Value |
|---|---|
| Project | papaparse (+ dev `@types/papaparse`) |
| GitHub URL | https://github.com/mholt/PapaParse |
| Purpose | RFC-4180 CSV parsing: streaming, workers, header mapping, delimiter detect; JSON→CSV export |
| License | MIT — permitted |
| Why selected | Dominant, battle-tested; handles quoted fields/CRLF/ragged rows |
| Security notes | Parse client-side/worker, validate every row server-side with Zod; size limits + allowlist (`.csv`/`.tsv`); formula-injection: strip leading `=+-@` on export |
| Integration method | npm |
| Alternative considered | Hand-rolled split (rejected — breaks on real-world CSVs) |

### Testing

| Field | Value |
|---|---|
| Project | Vitest (unit/API) + Playwright (E2E) |
| GitHub URL | https://github.com/vitest-dev/vitest · https://github.com/microsoft/playwright |
| Purpose | Unit (scoring, dedupe, quotas, SSRF validator), API route tests, tenant-isolation tests; real-browser E2E (signup→discover→score→campaign→approve) |
| License | MIT (Vitest); Apache-2.0 (Playwright) — permitted |
| Why selected | Standard modern pairing; tenant-isolation tests are mandatory |
| Security notes | E2E against ephemeral test DBs only, never production |
| Integration method | npm dev dependencies |
| Alternative considered | Jest (slower ESM story — rejected) |

## Architecture references (AGPL/GPL — study, DO NOT copy code)

| Project | GitHub URL | Purpose | License | What to study | Disposition |
|---|---|---|---|---|---|
| Twenty CRM | https://github.com/twentyhq/twenty | Modern OSS CRM: custom objects, kanban/table, workflow engine, REST+GraphQL, webhooks, AI SDK+MCP | AGPL-3.0 | Metadata-driven object model, schema-per-workspace tenancy, trigger→action workflow engine | Reference only |
| Chatwoot | https://github.com/chatwoot/chatwoot | Omnichannel inbox (WhatsApp, IG, FB, Telegram, email, SMS) + AI copilot | MIT core; `enterprise/` is commercial source-available | Channel-adapter pattern, webhook event model, assignment automation | Reference (never copy `enterprise/`) |
| Cal.com | https://github.com/calcom/cal.com | OSS scheduling | AGPLv3 | Meeting booking for MEETING stage, Prisma multi-tenant scheduling models, webhook patterns | Reference only |
| Mautic | https://github.com/mautic/mautic | Email marketing automation | GPLv3 | Evaluated — PHP stack mismatch, not a fit | Reference only |
| Reacher | https://github.com/reacherhq/check-if-email-exists | Self-host email verification | AGPL-3.0 | Integrate via its API if used | API-use only |

## Rejected / do-not-use

| Project | Reason |
|---|---|
| Lucia | Deprecated Mar 2025 |
| next-auth v5 (Auth.js) | Maintenance mode since Sept 2025 absorption; v5 still beta |
| react-beautiful-dnd | Unmaintained; incompatible with React 19 |
| BullMQ (for this deploy) | Requires Redis + always-on worker; incompatible with Vercel-only deploy |
| Self-built SMTP email verifier | Abuse/anti-spam risk, poor accuracy |

## Supply-chain notes

- No published supply-chain incidents (malware, hijacked packages) found for any recommended package in this pass. Standard practice still applies: pin versions, run `npm audit` before adding, prefer packages with provenance, avoid transitive install scripts.
- **nodemailer license caveat:** current = "MIT No Attribution"; v3–v6.x were EUPL-1.1 (copyleft). Pin current line and verify the `license` field at install time.
- Ecosystem event (not an incident): Auth.js → Better Auth team merger (Sept 2025) reinforces the better-auth choice.

## Final dependency shortlist (Phase 1 install)

`better-auth` · `prisma` + `@prisma/client` · `pg` · `resend` · `react-email` · `@react-email/components` · `inngest` · `ai` + `@ai-sdk/google` · `@upstash/ratelimit` + `@upstash/redis` · `zod` · `@tanstack/react-table` · `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` · `cmdk` · `papaparse` (+ `@types/papaparse`) · dev: `vitest`, `@playwright/test`, `tsx`
3D (Phase 1 landing only, lazy): `three` + `@react-three/fiber` + `@react-three/drei` (+ `@types/three` dev)
