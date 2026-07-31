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

## TanStack Query conventions

- **Key factory per feature:** `employeeKeys.list(filters)`, `employeeKeys.detail(id)` — no ad-hoc string keys.
- Defaults: `staleTime` 30 s; the dashboard "today" card 10 s; notifications polled at 30 s (SSE is a future upgrade, doc 11).
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

| Layer | Tool | Scope |
|---|---|---|
| Component | Vitest + Testing Library | `packages/ui` composites: states, a11y roles, keyboard nav |
| Hooks | Vitest + MSW | Query hooks against mocked API incl. 401→refresh path |
| E2E | Playwright | 5 golden flows: login→dashboard, check-in/out, apply→approve leave, add employee→invite, publish announcement→read |
