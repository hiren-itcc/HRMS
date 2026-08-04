# HRMS — Human Resource Management System

A modern, production-grade HRMS built as a Turborepo monorepo: **Next.js 16** web app, **NestJS 11** API, **PostgreSQL** via **Prisma 7**, with JWT auth (rotating refresh tokens), database-driven RBAC, and a coss UI design system (Base UI) with Framer Motion animations.

## Features

| Module | Status | Highlights |
|---|---|---|
| Authentication | ✅ | Login, refresh-token rotation with reuse detection, forgot/reset/change password, profile, session revocation |
| Organization | ✅ | Company profile, departments (nested, cycle-safe), designations, employment types, locations/branches, shifts, holiday calendar |
| Employees | ✅ | Full CRUD, scope-aware lists (HR sees all, managers see reports), bank details, soft delete, auto employee codes, and a sign-in created with the employee — starting on a default password they must change |
| Attendance | ✅ | Clock in/out, month calendar, team day view, monthly summaries, late/half-day rules, correction requests with manager approval |
| Leave | ✅ | Leave types and balances, apply/cancel, manager + HR approval (balance booked in one transaction), holiday-aware day maths, calendar |
| Documents | ✅ | Folders and categories, drag-and-drop upload with progress, in-browser preview for PDF/images/DOCX, download, delete |
| Announcements | ✅ | Rich-text authoring, categories, priority, pinning, attachments, dashboard widget, search and filters |
| Reports | ✅ | Employee, attendance, leave and department analytics over any date range — charts, CSV/Excel/PDF export, dashboard trend |
| Payroll | ✅ | Salary structures, effective-dated salary revisions, the Draft→Published run workflow with locking, payslips, bulk payment recording, and six statutory reports |
| Settings | ✅ | Console linking to every organization screen, plus system preferences, per-org roles & permissions, email templates and the audit log |

The **working week**, **leave year** and **statutory payroll rules** (PF rate and wage ceiling, ESI threshold, professional-tax slabs) are organization settings, not constants: a six-day week, an Apr–Mar financial year or a budget-day rate change lands in one place and flows through attendance, leave day-counting, payroll and reports together.

Statuses that read "absent" are **derived on read** — holidays, week-offs, approved leave and the employment window are computed when a day is queried, never written by a nightly job. That keeps the attendance and leave modules from ever disagreeing, and payroll derives loss-of-pay from the same source rather than asking anyone to type it in.

A **processed payslip is a snapshot**, not a set of joins: the employee's name, department, designation, structure and masked bank details are copied onto it at calculation. A payslip issued in March still reads correctly in December after a promotion, a transfer and a structure edit.

Every list endpoint supports search, filters, whitelisted sorting, and pagination. All mutations are audit-logged and tenant-scoped.

## Tech stack

- **Web** — Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4, coss UI on Base UI, TanStack Query, React Hook Form + Zod, Zustand, Framer Motion
- **API** — NestJS 11, Prisma 7 (driver adapters), Passport JWT, Zod validation end-to-end (`nestjs-zod`), Swagger, Pino
- **Shared packages** — `@hrms/ui` (component library), `@hrms/shared` (Zod schemas + RBAC catalog), `@hrms/types`, `@hrms/config`
- **Tooling** — Turborepo, pnpm, Biome, Husky + commitlint, GitHub Actions, Docker

## Repository layout

```
apps/
  web/          # Next.js frontend (pure API consumer — no direct DB access)
  api/          # NestJS backend + Prisma schema, migrations, seed
packages/
  ui/           # coss UI (Base UI) design system components + contrast gate
  shared/       # Zod schemas & permission catalog shared web ↔ api
  types/        # Shared TypeScript types/enums
  config/       # tsconfig + Biome bases
docs/           # Architecture package (ADRs, DB schema, RBAC, roadmap…)
docker/         # compose.yaml (postgres + minio) and production Dockerfiles
```

## Getting started

**Prerequisites:** Node ≥ 22, pnpm ≥ 11, and a Postgres.

This checkout is wired to the **Supabase** project `zvcgaeoiaywupmzcdkwt`
(`ap-northeast-2`) rather than a local database — see
[docs/14-production-setup.md §2.1](docs/14-production-setup.md) for the
connection string and its two mandatory SSL parameters. To go back to a
throwaway local Postgres instead, swap in the commented-out `DATABASE_URL` in
`apps/api/.env` and run `docker compose -f docker/compose.yaml up -d`.

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
pnpm db:seed         # demo workspace — WIPES THE ORGANIZATION FIRST. Local throwaway DB only.

# 5. Run both apps
pnpm dev
```

Open **http://localhost:5173** — it redirects to sign-in.

The Supabase database above was set up with `db:bootstrap`, so it holds one
organization, the role/permission matrix and a single administrator — no demo
people. The accounts below exist only after `db:seed`, on a local throwaway
database. Running that seed against Supabase would delete the organization.

The seed creates a full demo workspace (Acme Industries) with seven accounts,
all sharing the password `Passw0rd!2026`:

| Account | Role | Person | Use it to see |
|---|---|---|---|
| `admin@hrms.local` | Admin | Aarav Shah | Everything, including settings, roles and audit |
| `hr@hrms.local` | HR | Priya Nair | Org-wide people operations |
| `finance@hrms.local` | Finance | Vikram Rao | Approving and paying payroll — and being unable to change a salary |
| `manager@hrms.local` | Manager | Meera Iyer | Two direct reports and an approvals inbox |
| `asha@hrms.local` | Employee | Asha Verma | Self service (left unmarked today so you can clock in) |
| `rohan@hrms.local` | Employee | Rohan Desai | Self service on the Pune early shift |
| `zara@hrms.local` | Employee | Zara Khan | Self service on a contract |

It also seeds three salary structures, nine salary revisions (including a
promotion and an increment), a **published** payroll for last month with real
calculated payslips, and an open draft for the current one — so the payroll
workflow has somewhere to start and the salary timeline has something to show.
The payslips are produced by the same engine the API uses, so the demo data
cannot drift away from the code.

`pnpm db:seed` is destructive — it resets the demo organization so repeated
runs give an identical workspace. It refuses to run against
`NODE_ENV=production` unless `SEED_ALLOW_RESET=true`.

Swagger API docs: **http://localhost:4000/api/docs**

## Common scripts

| Command | Does |
|---|---|
| `pnpm dev` | Run web (5173) + api (4000) in watch mode |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | Turborepo pipeline across all workspaces |
| `pnpm check` | Biome lint + format check |
| `pnpm db:migrate` / `db:seed` / `db:generate` | Prisma workflows (run against `apps/api/.env`) |

## Roles & access

Seeded system roles: **Admin** (everything), **HR** (all people operations, and payroll processing), **Finance** (approves and pays payroll, and cannot alter salaries), **Manager** (self + direct reports, approvals), **Employee** (self-service). Permissions are database rows (`resource.action`), enforced by a global guard — see [`docs/04-rbac.md`](docs/04-rbac.md).

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
| [`15-feature-audit.md`](docs/15-feature-audit.md) | What is missing, what is built but unreachable, where these docs disagree with the code, and how it compares to Keka/greytHR/Zoho. |

The full design package lives in [`docs/`](docs/) — start with [`00-architecture-decisions.md`](docs/00-architecture-decisions.md). It covers the database schema & ER diagram, API conventions, auth architecture (token rotation, reuse detection), NestJS/Next.js structure, coding standards, git strategy, CI/CD, and the sprint roadmap.

> **Deploying?** Migrations create tables but no data — a migrated database has
> no roles and nobody who can sign in. Run `pnpm db:bootstrap`, not `db:seed`
> (which loads demo data and wipes the organization). See
> [`14-production-setup.md`](docs/14-production-setup.md).

## Branches

`master` is the trunk (CI on every push/PR). Feature work lands via short-lived `feat/*` branches; `stage` aggregates work ahead of a master merge.
