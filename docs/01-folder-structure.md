# 1 — Folder Structure

Turborepo + pnpm workspaces. Apps consume packages; packages never import from apps.

```
hrms/
├── apps/
│   ├── web/                          # Next.js 16 (App Router) — pure API consumer
│   │   ├── src/
│   │   │   ├── app/                  # Routes only — thin files that compose features
│   │   │   │   ├── (auth)/           # Unauthenticated segment: login, forgot/reset password
│   │   │   │   ├── (dashboard)/      # Authenticated shell: sidebar + topbar layout
│   │   │   │   │   ├── dashboard/
│   │   │   │   │   ├── employees/
│   │   │   │   │   ├── attendance/
│   │   │   │   │   ├── leave/
│   │   │   │   │   ├── documents/
│   │   │   │   │   ├── announcements/
│   │   │   │   │   ├── organization/
│   │   │   │   │   ├── reports/
│   │   │   │   │   └── settings/
│   │   │   │   ├── layout.tsx
│   │   │   │   └── globals.css       # Tailwind v4 @theme tokens (from design system)
│   │   │   ├── features/             # Feature modules: components + hooks + api per domain
│   │   │   │   └── <feature>/
│   │   │   │       ├── components/
│   │   │   │       ├── hooks/        # TanStack Query hooks (useEmployees, useCheckIn…)
│   │   │   │       ├── api.ts        # Typed fetchers for this feature only
│   │   │   │       └── schemas.ts    # Zod form schemas (reuse packages/shared where shared)
│   │   │   ├── components/           # App-level composition: shell, nav, guards, providers
│   │   │   ├── lib/                  # api-client, auth helpers, utils
│   │   │   ├── stores/               # Zustand: UI state only (sidebar, dialogs, filters)
│   │   │   └── middleware.ts         # Route protection (cookie presence check)
│   │   └── package.json
│   │
│   └── api/                          # NestJS
│       ├── src/
│       │   ├── main.ts               # Bootstrap: pino, helmet, CORS, Swagger, validation
│       │   ├── app.module.ts
│       │   ├── common/               # Guards, decorators, interceptors, filters, pipes
│       │   ├── config/               # Typed config module (env validated with Zod)
│       │   ├── database/             # PrismaService + prisma/ (schema, migrations, seed)
│       │   └── modules/
│       │       ├── auth/
│       │       ├── users/
│       │       ├── rbac/             # Roles, permissions, PermissionsGuard
│       │       ├── organization/     # Org, departments, designations, locations, holidays
│       │       ├── employees/
│       │       ├── attendance/
│       │       ├── leave/
│       │       ├── documents/        # + storage/ port (S3 | local adapter)
│       │       ├── announcements/
│       │       ├── notifications/
│       │       ├── reports/
│       │       ├── payroll/          # + payroll.calc/statutory/workflow (pure, tested)
│       │       ├── settings/
│       │       └── audit/            # AuditLog writer (interceptor-driven)
│       └── package.json
│
├── packages/
│   ├── ui/                           # coss UI (Base UI) component library (doc 06)
│   │   └── src/{components,hooks,lib,styles}/
│   ├── shared/                       # Zod schemas + constants shared web↔api (single source of truth)
│   │   └── src/{schemas,constants,utils}/
│   ├── types/                        # TS types: API contracts, enums, entity DTOs
│   └── config/                       # Shared biome.json, tsconfig bases, tailwind preset
│       ├── typescript/               #   base.json, nextjs.json, nestjs.json
│       └── biome/
│
├── docs/                             # This architecture package + future ADRs
├── docker/
│   ├── web.Dockerfile
│   ├── api.Dockerfile
│   └── compose.yaml                  # postgres, minio (dev S3), api, web
├── .github/
│   └── workflows/                    # ci.yml, deploy.yml (doc 10)
├── .husky/                           # pre-commit: biome; commit-msg: commitlint
├── turbo.json
├── pnpm-workspace.yaml
├── biome.json                        # extends packages/config/biome
└── package.json
```

## Rules that keep this structure honest

1. **Dependency direction:** `apps/* → packages/*` only. `packages/ui → packages/{types,config}`. No package imports an app; apps never import each other.
2. **Feature-first frontend:** a route file in `app/` may only compose from `features/<x>` and `components/`. If a component is used by one feature, it lives in that feature — promotion to `packages/ui` requires a second consumer.
3. **Module-first backend:** every NestJS module owns its controllers/services/DTOs. Cross-module access goes through the exported service, never another module's repository/Prisma calls.
4. **Adding a future module** (Recruitment, Performance…) = one folder under `apps/api/src/modules/`, one under `apps/web/src/features/`, one route segment, plus seed rows for its permissions. No existing file should need more than an import line.

   Payroll is the worked example: it added seven tables, a system role and nine
   screens without editing another module's internals. The one exception is
   worth naming — `auditMutation` gained an optional `meta` argument, because
   "salary revised" without the figures it moved between is not an audit trail.
   That is an additive change to a shared utility, which the rule allows; a
   change to another module's *behaviour* would have needed an ADR first.

5. **Business rules that can be pure, are.** Payroll's arithmetic and state
   machine live in `payroll.calc.ts`, `payroll.statutory.ts` and
   `payroll.workflow.ts` — no Prisma, no clock, no settings lookup, everything
   passed in. That is what makes 72 tests possible without a database, and it
   is the pattern any future module with real rules should follow (`leave.util.ts`
   was the first).
