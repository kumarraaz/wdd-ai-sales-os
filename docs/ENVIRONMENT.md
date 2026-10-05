# Environment Variables — WDD AI SALES OS

All secrets are server-side only. **Never** put API keys in `NEXT_PUBLIC_*`
variables, client code, logs, or chat. The app never exposes secret values —
`/api/system/health` reports only `CONFIGURED` / `NOT_CONFIGURED`.

## Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon/Supabase/self-hosted). Never paste in chat. |
| `BETTER_AUTH_SECRET` | Session signing secret for better-auth. Generate with `openssl rand -base64 32`. |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL, e.g. `https://wddaisalesos.com`. Used for auth callbacks, email links, trusted origins. |
| `CRON_SECRET` | Shared secret for the Vercel cron → `/api/automation/tick`. Set as a Vercel env var; the cron job sends it as a bearer token. |

## AI provider (at least one for AI features)

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `gemini` \| `groq` \| `openai` \| `anthropic`. Selects the provider. |
| `GEMINI_API_KEY` | Google Gemini key (when `AI_PROVIDER=gemini`). |
| `GROQ_API_KEY` | Groq key (when `AI_PROVIDER=groq`). |
| `GROQ_MODEL` | Optional Groq model override. |
| `AI_MODEL` | Optional model override for the selected provider. |

Without an AI provider the app still works: message drafts fall back to
humanized deterministic templates, and industry classification falls back to
the deterministic keyword matcher (labeled honestly in the UI).

## Prospecting / discovery

| Variable | Purpose |
|---|---|
| `TAVILY_API_KEY` | Public web search (Tavily). Powers Instagram discovery (`site:instagram.com`), public web research, and the web-search candidate source. Without it the agent reports "Public web search provider is not configured" and discovers nothing — it never fabricates results. |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New). Business discovery source: name, address, phone, website, Maps URL, category, place_id. Optional but recommended. |

## Automation

| Variable | Purpose |
|---|---|
| `WDD_AUTOMATION_KILL_SWITCH` | Set to `true` to pause all automation immediately (including the daily prospecting run). Unset/empty = automation live. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional Redis for rate limiting / job coordination. |

## Email

| Variable | Purpose |
|---|---|
| `BREVO_API_KEY` | Brevo API key for transactional email (password reset, verification). |
| `EMAIL_FROM` | Sender address, e.g. `WDD AI Sales OS <noreply@wddaisalesos.com>`. |

## Auth / OAuth (optional)

| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth. When unset, the Google button is hidden (never faked). |
| `NEXT_PUBLIC_GOOGLE_OAUTH` | Set to `"true"` to show the Google sign-in button (requires the above). |

## Sessions

"Remember me" (checked, default) → 30-day persistent session.
Unchecked → 1-day session. Cookies are HttpOnly, `Secure` in production,
`SameSite=Lax`, and server-managed — no tokens in `localStorage`.

## Cron (Vercel Hobby)

`vercel.json` defines one daily cron — `30 3 * * *` (03:30 UTC = 09:00 IST)
→ `/api/automation/tick`. Do **not** change this to a higher frequency:
Vercel Hobby allows one cron per day. The scheduler inside the app decides
whether today's plan day should run (one run per org per day, idempotent).

## First production deploy checklist

1. Set all **Required** vars in Vercel → Environment Variables.
2. Set `TAVILY_API_KEY` (and `GOOGLE_PLACES_API_KEY` if you want Google-sourced leads).
3. Set one AI provider (`AI_PROVIDER` + key).
4. `git pull origin master` in your deploy checkout, then `npx prisma migrate deploy`
   with the **production** `DATABASE_URL` (never `prisma db push`).
5. Open `/prospecting` → check **System status** — all green means the agent
   can actually discover.
6. Save the weekly plan. The first run fires at 09:00 IST (or press Run Now).
