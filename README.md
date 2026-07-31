# HRMS — Human Resource Management System

A modern, production-grade HRMS built as a Turborepo monorepo: **Next.js 16** web app, **NestJS 11** API, **PostgreSQL** via **Prisma 7**, with JWT auth (rotating refresh tokens), database-driven RBAC, and a premium indigo/gradient design system with Framer Motion animations.

## Features

| Module | Status | Highlights |
|---|---|---|
| Authentication | ✅ | Login, refresh-token rotation with reuse detection, forgot/reset/change password, profile, session revocation |
| Organization | ✅ | Company profile, departments (nested, cycle-safe), designations, employment types, locations/branches, shifts, holiday calendar |
| Employees | ✅ | Full CRUD, scope-aware lists (HR sees all, managers see reports), bank details, soft delete, auto employee codes, self-service profile |
| Attendance · Leave · Documents · Announcements · Reports | 🔜 | Per the roadmap in [`docs/11-roadmap.md`](docs/11-roadmap.md) |

Every list endpoint supports search, filters, whitelisted sorting, and pagination. All mutations are audit-logged and tenant-scoped.

## Tech stack

- **Web** — Next.js 16 (App Router), TypeScript strict, Tailwind CSS v4, shadcn/ui, TanStack Query, React Hook Form + Zod, Zustand, Framer Motion
- **API** — NestJS 11, Prisma 7 (driver adapters), Passport JWT, Zod validation end-to-end (`nestjs-zod`), Swagger, Pino
- **Shared packages** — `@hrms/ui` (component library), `@hrms/shared` (Zod schemas + RBAC catalog), `@hrms/types`, `@hrms/config`
- **Tooling** — Turborepo, pnpm, Biome, Husky + commitlint, GitHub Actions, Docker

## Repository layout

```
apps/
  web/          # Next.js frontend (pure API consumer — no direct DB access)
  api/          # NestJS backend + Prisma schema, migrations, seed
packages/
  ui/           # shadcn/ui-based design system components
  shared/       # Zod schemas & permission catalog shared web ↔ api
  types/        # Shared TypeScript types/enums
  config/       # tsconfig + Biome bases
docs/           # Architecture package (ADRs, DB schema, RBAC, roadmap…)
docker/         # compose.yaml (postgres + minio) and production Dockerfiles
```

## Getting started

**Prerequisites:** Node ≥ 22, pnpm ≥ 11, and PostgreSQL 16+ (via `docker compose -f docker/compose.yaml up -d` or any local instance on `localhost:5432`).

```bash
# 1. Install
pnpm install

# 2. Environment
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL + JWT_ACCESS_SECRET
cp apps/web/.env.example apps/web/.env.local

# 3. Database (role/db "hrms" must exist — compose creates it)
pnpm db:generate
pnpm db:migrate      # or: pnpm --filter @hrms/api db:deploy
pnpm db:seed         # roles, permission matrix, admin user, defaults

# 4. Run both apps
pnpm dev
```

Open **http://localhost:3000** and sign in with the seeded admin:

```
admin@hrms.local / ChangeMe-2026
```

Swagger API docs: **http://localhost:4000/api/docs**

## Common scripts

| Command | Does |
|---|---|
| `pnpm dev` | Run web (3000) + api (4000) in watch mode |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | Turborepo pipeline across all workspaces |
| `pnpm check` | Biome lint + format check |
| `pnpm db:migrate` / `db:seed` / `db:generate` | Prisma workflows (run against `apps/api/.env`) |

## Roles & access

Seeded system roles: **Admin** (everything), **HR** (all people operations), **Manager** (self + direct reports, approvals), **Employee** (self-service). Permissions are database rows (`resource.action`), enforced by a global guard — see [`docs/04-rbac.md`](docs/04-rbac.md).

## Architecture docs

The full design package lives in [`docs/`](docs/) — start with [`00-architecture-decisions.md`](docs/00-architecture-decisions.md). It covers the database schema & ER diagram, API conventions, auth architecture (token rotation, reuse detection), NestJS/Next.js structure, coding standards, git strategy, CI/CD, and the sprint roadmap.

## Branches

`master` is the trunk (CI on every push/PR). Feature work lands via short-lived `feat/*` branches; `stage` aggregates work ahead of a master merge.
