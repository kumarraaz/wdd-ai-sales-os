# UI system and page conventions — WDD AI SALES OS

The authenticated app (everything under `app/(app)`) uses one dark "neon command center" system
(source of truth: the Figma file *WDD AI Sales OS — Neon Dashboard*). This page is the short version of
how it is built so new pages stay consistent. The public marketing site is separate and unchanged.

## Tokens (`app/globals.css`, Tailwind v4 `@theme`)

| Token | Value | Use |
|---|---|---|
| `canvas` | `#070B14` | page background |
| `surface` / `surface-2` | `#0D1424` / `#101A2D` | cards, popovers / nested rows, active nav |
| `line` / `line-strong` | `#1D2A40` / `#2A3B57` | 1px borders |
| `ink` / `ink-muted` / `ink-dim` | `#F4F7FF` / `#8A98B3` / `#74839F` | text (all ≥ 4.5:1 on the surfaces above) |
| `neon-cyan` `-violet` `-pink` `-lime` `-blue` | `#43F5E2` `#A78BFA` `#FF5CC8` `#C5FF6B` `#4F8CFF` | accents; `tint` (`#7AA2FF`) for hover washes |

Radii: `rounded-tile` 14, `rounded-card` 15, `rounded-control` 9. Font: Inter (self-hosted, `font-ui`).
Use opacity modifiers on tokens (`bg-neon-cyan/10`, `border-line/60`), never raw hex or `white/NN`.

## Components (`components/ui`)

`Card` / `CardHeader`, `KpiTile`, `PageHeader` (owns the page's only `<h1>`), `Button` / `ButtonLink` / `buttonClass`,
`Badge` / `DemoBadge`, `DataTable` (+ `Th` `Tr` `Td`), `BarList`, `ProgressBar`, `EmptyState`, `InlineAlert`,
`Skeleton`, `SegmentedLinks` (a filter made of real links), `Dialog` (native `<dialog>`: focus trap, Esc, inert
background), `ConfirmDialog` + `useConfirm()` (never use `window.confirm/prompt`), `CountUp`.
Tones come from `tone.ts` (`cyan | violet | pink | lime | blue | amber | red | muted`).

## Writing a page

1. `const ctx = await getPageContext()` (`lib/page-context.ts`). It redirects when signed out, resolves the
   active workspace from the `wdd.org_id` cookie **only among the user's own memberships**, and returns
   `{ demo: true }` for demo sessions. Demo mode renders fixtures or `DemoUnavailable` — it never queries real data.
2. Gate by role with `roleAtLeast(ctx.role, "…")` and say *why* a section is hidden.
3. Read data with queries that all carry `organizationId: ctx.organizationId` (put reusable ones in `lib/*-data.ts`).
4. Render `PageHeader` first, then cards. Give every empty state a next action; never fill gaps with sample data.
5. Filters/pagination/ranges go in the URL (`searchParams`, validated — see `lib/lead-filters.ts`, `parseRange`).
6. Add the route to `components/app/nav.ts` and to the `matcher` in `middleware.ts` (`tests/nav.test.ts` fails if you forget).

## Honesty rules (enforced by tests where possible)

- A number on a page equals the length of the list it links to (`tests/dashboard-db.test.ts`).
- Trends need a baseline in both periods; otherwise the chip is hidden or says "New".
- Windows are whole UTC days (`periodWindows`), so chart sums equal KPI tiles.
- "Planned" features get a roadmap page, not a fake one (`/campaigns`). Billing has no checkout because none exists.
- Outbound communication always stops in the Approval queue; approving runs exactly the stored snapshot and
  only creates drafts/tasks/follow-ups. The queue shows the content being approved.
- Client `fetch()` URLs must be served by a real route (`tests/api-contract.test.ts`).

## Motion

CSS only (`.rise-in` stagger via `--i`, `.pop-in`, `.skeleton`, `.live-dot`) plus `CountUp` and chart draw-in.
Everything is disabled under `prefers-reduced-motion` (CSS media query, `usePrefersReducedMotion`, `CountUp`).
Nothing animates continuously except two tiny status dots.

## Checks

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (DB-backed tests run when `DATABASE_URL` points at a
disposable database and are skipped otherwise), `npx next build`.
