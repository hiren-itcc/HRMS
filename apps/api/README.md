# @hrms/api

NestJS 11 API for the HRMS. PostgreSQL via Prisma 7 (driver adapter), JWT auth
with rotating refresh tokens, database-driven RBAC, Zod validation end to end.

Run it from the repo root (`pnpm dev` starts this and the web app together) —
these notes cover working on the API specifically.

## Layout

```
src/
  main.ts              Bootstrap: pino, helmet, CORS, Swagger, global pipes
  app.module.ts        Module registry
  common/              Guards, decorators, interceptors, filters, utils
  config/              Typed config (env validated with Zod)
  database/            PrismaService
  generated/prisma/    Generated client — never edited by hand
  modules/             One folder per domain module
prisma/
  schema.prisma        Source of truth for the schema
  migrations/          Hand-reviewed SQL, applied with `migrate deploy`
  seed.ts              Destructive demo workspace
```

Every module follows the same shape: `*.controller.ts` declares routes and
permissions, `*.service.ts` holds the work, `dto/` wraps shared Zod schemas
with `createZodDto`, and anything that is genuinely a business rule lives in a
**pure** file beside them (`leave.util.ts`, `payroll.calc.ts`,
`payroll.statutory.ts`, `payroll.workflow.ts`) so it can be tested without a
database.

## Database workflow

```bash
pnpm db:generate      # regenerate the Prisma client after a schema edit
pnpm db:migrate       # create + apply a migration (dev)
pnpm db:deploy        # apply pending migrations (CI/production)
pnpm db:seed          # reset the demo organization
```

**Migrations are written, not generated blindly.** `prisma migrate diff` is a
good first draft, but anything that touches existing rows — backfills, new
system roles, permission grants — is added by hand and read before it runs. Two
rules that have already earned their keep:

1. A migration that adds capabilities must grant them to **every existing
   organization**, or a tenant that upgrades ends up with less than a fresh
   install. See `20260802090000_payroll_module`.
2. Prove a data migration on a scratch schema first. `20260801050000_role_per_organization`
   and the payroll migration were both replayed against a two-tenant fixture
   before touching a real database; the role migration had a unique-constraint
   bug that only showed up that way.

## Testing

```bash
pnpm test             # jest
pnpm test:watch
pnpm test:cov
```

The suite is deliberately weighted toward pure functions — leave day maths,
payroll arithmetic, statutory thresholds, state machines — because those are
where a mistake is expensive and a test is cheap. Services are tested with a
mocked Prisma where the logic warrants it; controllers are covered through the
permission guard rather than individually.

## Conventions worth knowing before editing

- **Every list endpoint** goes through `buildListArgs` / `searchWhere` /
  `toPaginated` (`common/utils/list-query.ts`). Sort keys are whitelisted per
  module — a client-supplied sort never reaches Prisma unchecked.
- **Scope is never taken from request params.** `.own` routes derive the
  employee from the JWT; `.team` routes filter on `managerId`.
- **Every mutation writes an audit row** via `auditMutation`, with `before` /
  `after` where the values matter.
- **Prisma `Decimal` serialises as a string.** Convert at the edge (see
  `payroll.mapper.ts`, `leave.mapper.ts`) — never let one reach the browser.
- **Dates in transport are ISO-8601 UTC**, date-only fields `YYYY-MM-DD`, month
  keys `YYYY-MM`. `common/utils/calendar.ts` has the helpers; nothing should be
  doing its own date arithmetic.
- **Permission plus state.** A guard answers *who*; some modules also need
  *when*. Payroll's `payroll.workflow.ts` owns which transitions are legal from
  which status, and which permission each demands, so that decision is written
  once.

## API docs

Swagger UI at **http://localhost:4000/api/docs** — DTOs are annotated and every
route is tagged by module, so the page is the contract a future mobile client
would build against.
