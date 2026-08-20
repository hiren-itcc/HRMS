# HRMS — Human Resource Management System

[![CI](https://github.com/hiren-itcc/HRMS/actions/workflows/ci.yml/badge.svg)](https://github.com/hiren-itcc/HRMS/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522-3c873a)
![pnpm](https://img.shields.io/badge/pnpm-11-f69220)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

A production-grade HRMS for Indian payroll and people operations, built as a
Turborepo monorepo: a **Next.js 16** web app, a **NestJS 11** API, **PostgreSQL**
through **Prisma 7**, JWT auth with rotating refresh tokens and reuse detection,
RBAC held as database rows rather than code, and a coss UI design system on Base
UI.

Twenty modules ship — hire to exit, including payroll with statutory returns.

<!-- Screenshots go here. Suggested: the dashboard, a payslip, the payroll run
     screen, and the attendance calendar. None are committed yet. -->

## What it does

**People**

| Module | Highlights |
|---|---|
| Employees | Full CRUD, scope-aware lists (HR sees all, managers see reports), bank details, soft delete, auto employee codes, and a sign-in created with the employee — starting on a default password they must change |
| Directory | A searchable people directory on its own permission, so "look up a colleague's extension" is not the same grant as "read personnel records" |
| Organization | Company profile, departments (nested, cycle-safe), designations, employment types, locations/branches, shifts, holiday calendar |
| Onboarding | Invite a new hire who has no work mailbox yet, with a task checklist that runs before day one — distinct from adding somebody who already works here |
| Exits | Resignation workflow, notice periods, clearance checklists computed from the asset register, and full-and-final settlement |
| Lifecycle | Probation confirmation and notice-period close, applied as employment transitions rather than by anyone remembering |

**Time**

| Module | Highlights |
|---|---|
| Attendance | Clock in/out with breaks, geofenced office/remote detection, month calendar, team day view, late/half-day rules, correction requests with manager approval |
| Leave | Leave types and balances, apply/cancel, manager + HR approval with the balance booked in one transaction, holiday-aware day maths, calendar |
| Remote work | Remote-day requests with a weekly allowance, approved alongside the attendance record they affect |

**Money**

| Module | Highlights |
|---|---|
| Payroll | Salary structures, effective-dated revisions, the Draft → Published run workflow with locking, adjustments, payslips, bulk payment recording, and six payroll reports |
| Income tax | Per-employee regime per financial year, investment declarations with HR approval, editable slab tables, and monthly TDS projected as remaining tax ÷ remaining months |
| Expenses | Categories, multi-line claims, receipts, approval, and an approved claim becoming a payslip line |
| Settlements | Full-and-final on exit — encashment, notice recovery, gratuity |

**Talent**

| Module | Highlights |
|---|---|
| Recruitment | Openings, candidates, applications, interviews and offers, with a hire converting through the existing onboarding invite rather than a second way in |
| Careers page | `/careers` and `/careers/:slug` — the product's only unauthenticated write surface, so most of the work is refusals: 404 for closed and unpublished alike, the same answer to a repeat applicant, a rate limit per IP, and a CV checked on both content type and extension |
| Performance | Review cycles that enrol, weighted goals, self-then-manager assessment, shared and acknowledged |

**Workplace**

| Module | Highlights |
|---|---|
| Documents | Folders and categories, drag-and-drop upload with progress, in-browser preview for PDF/images/DOCX, download, delete |
| Helpdesk | Tickets against per-desk categories, a thread carrying public replies and internal notes only the desk can see, a queue worked oldest-first, and status changes written onto the thread rather than into a table nobody reads |
| Assets | A per-item register with issue/return history, feeding the exit clearance checklist |
| Announcements | Rich-text authoring, categories, priority, pinning, attachments, dashboard widget, search and filters |
| Letters | Offer, appointment, relieving, experience and salary-certificate letters from editable templates. The body is never client-supplied — the server renders from the resolved template, which is what makes the escaping guarantee hold for a document then frozen forever. Withdrawing one is a void with a reason, because a letter cannot be unmade |
| Notifications | In-app with a polling bell, plus email — leave decisions and a general fan-out, with a per-user preference and three mail transports |
| Reports | Employee, attendance, leave and department analytics over any date range — charts, CSV/Excel/PDF export, dashboard trend |
| Import / export | Employees out as CSV or Excel, and back in through a three-step import whose commit is refused unless its preview is clean |
| Settings | A console linking every organization screen, plus system preferences, per-org roles and permissions, email templates, statutory codes and the audit log |

## Why it is built this way

The **working week**, **leave year** and **statutory payroll rules** (PF rate and
wage ceiling, ESI threshold, professional-tax slabs) are organization settings,
not constants: a six-day week, an Apr–Mar financial year or a budget-day rate
change lands in one place and flows through attendance, leave day-counting,
payroll and reports together.

Statuses that read "absent" are **derived on read** — holidays, week-offs,
approved leave and the employment window are computed when a day is queried,
never written by a nightly job. That keeps the attendance and leave modules from
ever disagreeing, and payroll derives loss-of-pay from the same source rather
than asking anyone to type it in.

A **processed payslip is a snapshot**, not a set of joins: the employee's name,
department, designation, structure and masked bank details are copied onto it at
calculation. A payslip issued in March still reads correctly in December after a
promotion, a transfer and a structure edit.

Every list endpoint supports search, filters, whitelisted sorting, and
pagination. All mutations are audit-logged and tenant-scoped.

## Tech stack

- **Web** — Next.js 16.2 (App Router), React 19.2, TypeScript strict, Tailwind
  CSS v4, coss UI on Base UI 1.6, TanStack Query 5, React Hook Form + Zod 4,
  Zustand 5, Framer Motion 12, Recharts 3
- **API** — NestJS 11, Prisma 7.9 (driver adapters), Passport JWT, Argon2
  hashing, Zod validation end-to-end (`nestjs-zod`), rate limiting
  (`@nestjs/throttler`), Swagger, Pino
- **Storage & mail** — Supabase storage (private bucket; bytes only ever leave
  through an authenticated route) and Resend, behind transports that fall back
  to a log or a file outbox
- **Shared packages** — `@hrms/ui` (component library), `@hrms/shared` (Zod
  schemas + RBAC catalog), `@hrms/types`, `@hrms/config`
- **Testing** — Jest (API), Vitest + Testing Library (web), Playwright (browser)
- **Tooling** — Turborepo, pnpm 11, Biome, Husky + commitlint, GitHub Actions,
  Docker, Render

## Repository layout

```
apps/
  web/          # Next.js frontend (pure API consumer — no direct DB access)
  api/          # NestJS backend + Prisma schema, migrations, seed
  e2e/          # Playwright — the golden flows, against a real API and Postgres
packages/
  ui/           # coss UI (Base UI) design system components + contrast gate
  shared/       # Zod schemas & permission catalog shared web ↔ api
  types/        # Shared TypeScript types/enums
  config/       # tsconfig + Biome bases
docs/           # Architecture package — 16 documents, indexed below
docker/         # compose.yaml (postgres + minio) and production Dockerfiles
render/         # Build scripts for the hosted deployment
```

## Getting started

**Prerequisites:** Node ≥ 22, pnpm ≥ 11, and a Postgres.

```bash
# 1. Install
pnpm install

# 2. Environment
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL + JWT_ACCESS_SECRET
cp apps/web/.env.example apps/web/.env.local

# 3. Database
pnpm db:generate
pnpm db:deploy       # apply migrations (use db:migrate only to author new ones)

# 4. Data — pick ONE, they are not interchangeable
pnpm db:bootstrap    # one org, roles, one admin. Additive. Safe on a real database.
pnpm db:seed         # demo workspace — WIPES THE ORGANIZATION FIRST.

# 5. Run both apps
pnpm dev
```

Open **http://localhost:5173** — it redirects to sign-in. Swagger is at
`/api/docs` on the API (port 4000 by default, but it follows `PORT`).

For a throwaway local database, `docker compose -f docker/compose.yaml up -d`
brings up Postgres and MinIO. For a hosted one, see
[`docs/14-production-setup.md`](docs/14-production-setup.md) — note the two
mandatory SSL parameters, and `TRUST_PROXY`, which is not optional behind a
proxy and is a count you must take from a real request header rather than guess.

### The demo workspace

`pnpm db:seed` builds Acme Industries — an organization with somebody in every
state, across fifteen seed files: people and the org tree, attendance, leave,
payroll, expenses, assets, performance cycles, a recruitment pipeline, remote
work, exits and comms. The payslips are produced by the same engine the API
uses, so the demo data cannot drift away from the code.

Seven accounts, all sharing the password `Passw0rd!2026` unless you set
`SEED_PASSWORD`:

| Account | Role | Person | Use it to see |
|---|---|---|---|
| `admin@hrms.local` | Admin | Aarav Shah | Everything, including settings, roles and audit |
| `hr@hrms.local` | HR | Priya Nair | Org-wide people operations |
| `finance@hrms.local` | Finance | Vikram Rao | Approving and paying payroll — and being unable to change a salary |
| `manager@hrms.local` | Manager | Meera Iyer | Two direct reports and an approvals inbox |
| `asha@hrms.local` | Employee | Asha Verma | Self service (left unmarked today so you can clock in) |
| `rohan@hrms.local` | Employee | Rohan Desai | Self service on the Pune early shift |
| `zara@hrms.local` | Employee | Zara Khan | Self service on a contract |

> **`db:seed` is destructive.** It resets the demo organization so repeated runs
> give an identical workspace. Against a non-local database it refuses unless
> `SEED_ALLOW_RESET=true` — and then still refuses if the organization there is
> not the expected demo tenant, or if the database holds income-tax rules a
> human confirmed rather than the seeder writing them. Those last two are not
> overridden by `SEED_ALLOW_RESET`; they take `SEED_EXPECT_ORG_NAME` and
> `SEED_ALLOW_REAL_TAX_RULES=true`, which nobody sets by accident.
>
> On anything you care about, run `db:bootstrap` instead — migrations create
> tables but no data, so a migrated database has no roles and nobody who can
> sign in.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Run web (5173) + api (4000) in watch mode |
| `pnpm build` / `pnpm typecheck` | Turborepo pipeline across all workspaces |
| `pnpm test` | Unit and integration tests — Jest for the API, Vitest for the web |
| `pnpm test:e2e` | The Playwright golden flows (builds first; needs a seeded database) |
| `pnpm lint` / `pnpm check` / `pnpm format` | Biome — per-workspace lint, repo-wide check, and write-mode format |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:bootstrap` / `db:generate` | Prisma workflows (run against `apps/api/.env`) |

## Testing

Three layers, and they are deliberately different in kind:

- **Unit** — Jest for the API, Vitest + Testing Library for the web. The
  business rules of each module live in a pure `*.rules.ts` with no Prisma and
  no clock, which is what makes them cheap to test exhaustively.
- **Integration** — `pnpm --filter @hrms/api test:integration`, Supertest
  against a real Nest application and a real Postgres. This is where RBAC is
  proven on the rows rather than on the status code: a `where` clause that
  silently became `{}` would pass a status check and leak the company.
- **Browser** — `pnpm test:e2e`, Playwright over the five golden flows against a
  built web app, a real API and a seeded database.

The browser layer earns its keep by catching what the other two cannot see by
construction — cross-boundary failures. Everything it has found so far was a
client default meeting a server schema, a rate limit meeting the client's own
call pattern, or a proxy meeting a request; the list is kept in
[`docs/15-feature-audit.md`](docs/15-feature-audit.md).

CI runs four jobs on every push and pull request: `check`, `integration`,
`migration-drift` (the schema and the migrations must agree) and `e2e`.

## Roles & access

Seeded system roles: **Admin** (everything), **HR** (all people operations, and
payroll processing), **Finance** (approves and pays payroll, and cannot alter
salaries), **Manager** (self + direct reports, approvals), **Employee**
(self-service). Permissions are database rows (`resource.action`) enforced by a
global guard — see [`docs/04-rbac.md`](docs/04-rbac.md). Custom roles need no
code at all.

Payroll is where this earns its keep: nobody holds both `payroll.process` and
`payroll.approve` by default, so the person who runs payroll is not the person
who releases it.

## Documentation

Start here depending on what you need:

| Document | For |
|---|---|
| [`12-how-it-works.md`](docs/12-how-it-works.md) | What the system does, in plain language. No technical knowledge assumed. |
| [`13-data-map.md`](docs/13-data-map.md) | How the modules connect, with diagrams. What happens on delete. |
| [`14-production-setup.md`](docs/14-production-setup.md) | **Deploying to a server.** Env vars, migrations, creating the first admin. |
| [`15-feature-audit.md`](docs/15-feature-audit.md) | What is built, what is deliberately not, where these docs have disagreed with the code, and how it compares to Keka/greytHR/Zoho. |

The full design package:

| | |
|---|---|
| [`00-architecture-decisions.md`](docs/00-architecture-decisions.md) | ADRs — including the ones settled the other way |
| [`01-folder-structure.md`](docs/01-folder-structure.md) | Where things go, and why |
| [`02-database.md`](docs/02-database.md) | Schema and ER diagram |
| [`03-api-structure.md`](docs/03-api-structure.md) | API conventions, module by module |
| [`04-rbac.md`](docs/04-rbac.md) | Permissions as data, and how to add a module |
| [`05-navigation-and-screens.md`](docs/05-navigation-and-screens.md) | Every screen in the product |
| [`06-design-system.md`](docs/06-design-system.md) | coss UI, themes, the contrast gate |
| [`07-auth-architecture.md`](docs/07-auth-architecture.md) | Token rotation, reuse detection, throttling |
| [`08-nestjs-architecture.md`](docs/08-nestjs-architecture.md) | API layering and testing strategy |
| [`09-nextjs-architecture.md`](docs/09-nextjs-architecture.md) | App Router structure, data fetching |
| [`10-engineering-standards.md`](docs/10-engineering-standards.md) | Coding standards, git strategy, CI/CD |
| [`11-roadmap.md`](docs/11-roadmap.md) | What shipped, what is next, and the rule every new module follows |

## Branches

`master` is the trunk (CI on every push/PR). Feature work lands via short-lived
`feat/*` branches; `stage` aggregates work ahead of a master merge.
