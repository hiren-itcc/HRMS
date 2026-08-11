# 14 — Next.js Architecture

Next.js 16, App Router, TypeScript strict. The web app is a **pure API consumer** (ADR §1.2): no Prisma, no business rules — presentation, forms, and cache orchestration only.

## Rendering strategy

An HRMS is a private, per-user app — there is nothing to statically cache behind auth.

| Segment | Strategy |
|---|---|
| `(auth)` pages | Static shells (login form is client) |
| `(dashboard)` pages | **Server Components render layout shells; data is client-fetched via TanStack Query.** One data-fetching path, cleanly cacheable/invalidatable, and interactive views (tables, calendars, live check-in timer) are client-driven anyway |
| Server Actions | **Not used for domain mutations** — all mutations go through the NestJS API so RBAC/audit stay in one place |

This is deliberate simplicity: mixing RSC-fetch + Query-fetch for the same resources creates two cache layers that disagree. Revisit only if first-paint metrics demand it (then: RSC prefetch → `HydrationBoundary`, same Query keys).

## State model — three kinds, never mixed

| Kind | Owner | Examples |
|---|---|---|
| **Server state** | TanStack Query | employees, requests, balances — anything the API owns |
| **Session state** | `SessionProvider` (context) | current user, permissions, active org |
| **UI state** | Zustand (small stores) or URL | sidebar collapsed, dialog open, theme; **filters/pagination/tabs live in the URL** (deep-linking rule, doc 05) |

Rule: if data comes from the API it is *only* in Query's cache. Zustand never stores server data.

The URL row is the one people get wrong. Filters, sort and page belong there —
`useListParams` is the only way a list view should hold them — because a table
someone cannot link to is a table they will screenshot instead.

## TanStack Query conventions

- **Key factory per feature:** `employeeKeys.list(filters)`, `employeeKeys.detail(id)` — no ad-hoc string keys.
- Defaults: `staleTime` 30 s; the dashboard "today" card 10 s. (There is no notification poll — notifications were never built, doc 03.)
- **Mutations invalidate by key prefix** (`invalidateQueries(employeeKeys.all)`); optimistic updates only for instant-feel actions: check-in/out, mark-read, cancel-own-request.
- All hooks live in `features/<x>/hooks/`; components never call the api client directly.

## Forms

React Hook Form + Zod resolver, schemas imported from `packages/shared` — **the same schema the API validates with**, so client and server can't drift. Server 4xx `details` map back onto fields via `setError`. Multi-step forms (add employee) validate per-step and preserve state across steps/back-navigation.

## API client (`lib/api-client.ts`)

Single typed `fetch` wrapper: base URL from env, credentials included, attaches in-memory access token, transparent single-flight refresh on 401 (doc 07), narrows errors to a typed `ApiError`. Feature `api.ts` files are the only importers.

## Auth & guarding (three cheap layers, API is the real one)

1. `middleware.ts` — cookie presence → redirect unauthenticated to `/login?next=` (UX only).
2. `SessionProvider` — bootstraps refresh + `/auth/me`; exposes `useSession()` / `useCan(perm)`.
3. `<Can perm="...">` component + nav config with per-item `perm` — UI mirrors the matrix; 403 responses render `ForbiddenState`.

## Composition & performance

- Route files stay thin: `page.tsx` = `<PageHeader/> + <FeatureView/>`; feature logic lives in `features/` (doc 01 rules).
- `"use client"` pushed to leaves; heavy pieces (`ReportChart`, org chart, markdown editor) `dynamic()`-imported.
- Virtualized tables past 100 rows; `next/image` for avatars; `next/font` for Plus Jakarta Sans (self-hosted, no layout shift).
- Suspense boundaries per page section with skeletons from `packages/ui`; error boundaries per route segment (`error.tsx`).
- Budgets (CI-checked once Lighthouse job lands, Sprint 4): dashboard LCP < 2.5 s, CLS < 0.1, per-route JS < 250 KB gz.

## Frontend testing

| Layer | Tool | Status |
|---|---|---|
| Unit | Vitest | **Built.** `lib/api-client.ts` — bearer header, 401→refresh→replay, single-flight, retry-once. |
| Component | Vitest + Testing Library (jsdom) | **Built.** Page-level, mocking the feature `api.ts` module. |
| E2E | Playwright — 5 golden flows | **Not built.** Needs a seeded database and a running API; CI cannot provide either yet, and a suite that cannot run in CI is not a gate. |

`pnpm turbo run test` runs the API and web suites together, and CI gates on it.

Two deliberate absences:

- **No `@vitejs/plugin-react`.** It supplies Fast Refresh and the Babel
  pipeline, neither of which a test run uses, and its current major needs Vite 8
  while Vitest bundles Vite 7 — pinning either gives a type error or
  `ERR_PACKAGE_PATH_NOT_EXPORTED` at startup. esbuild compiles the JSX;
  `esbuild: { jsx: 'automatic' }` in `vitest.config.ts` is the whole
  configuration.
- **No MSW.** The api client is tested directly against a `fetch` double, which
  is more precise for refresh-and-replay, and component tests `vi.mock` the
  feature module. MSW's only contribution was a postinstall for a browser
  service worker that node tests never load.

The five golden flows are built, in `apps/e2e/specs`: login → dashboard,
check-in/out, apply → approve leave, **HR creates employee → invite → the new
person signs in**, and publish announcement → read.

That fourth one used to be written here as "add employee → invite", which is a
weaker flow than doc 11 asked for and the reason the wording is corrected: the
third actor is the whole point. It is also the only flow that leaves the
application entirely in the middle, through an email — which is why
`FileTransport` exists, so the invite link is *asserted* rather than scraped out
of a log.

Two constraints worth knowing before touching those specs. `storageState` is
deliberately unused: the access token lives in memory only, so a restored
session is two cookies on two origins that authenticate only after a refresh —
and refresh tokens rotate with reuse detection, so two contexts replaying one
saved cookie revoke each other. And `timezoneId` is pinned to `Asia/Kolkata`,
because attendance is keyed by date and a UTC runner crossing IST midnight puts
a check-in on yesterday.
