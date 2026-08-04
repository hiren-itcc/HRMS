# 13 — NestJS Architecture

Modular monolith. One deployable, strict module boundaries — the "microservices later if ever" shape. No CQRS, no event bus, no repositories-over-Prisma abstraction in Phase 1 (Karpathy rule: nothing speculative); seams are noted where each would land.

## Module map

```
AppModule
├── ConfigModule        (global) Zod-validated env, typed accessor
├── DatabaseModule      (global) PrismaService (+ tx helper)
├── LoggerModule        (global) nestjs-pino — request-scoped, redacts auth headers/cookies
├── StorageModule       (global) StorageAdapter port (SupabaseStorage | LocalDiskStorage)
├── AuthModule          strategies/jwt, guards, token + invite services
├── RbacModule          PermissionsGuard, @RequirePermissions, role/permission reads
├── OrganizationModule  org, departments, designations, employment types, locations, shifts, holidays
├── EmployeesModule     employee CRUD, directory, "me" profile
├── OnboardingModule    invite a hire, self-serve intake, HR review queue
├── AttendanceModule    check-in/out, sessions, records, correction requests
├── LeaveModule         types, balances, requests
├── DocumentsModule     per-employee upload/download, folders
├── LettersModule       templates, issue, void
├── AnnouncementsModule feed, audience resolution, read receipts, attachments
├── PayrollModule       structures, salaries, runs, payslips, six reports
├── ReportsModule       read-only aggregate queries + CSV/Excel serializer
├── SettingsModule      typed settings registry over key-value rows, email templates
├── AuditModule         audit query + facets (writes go through auditMutation)
├── MailModule          MailService over a MailTransport port (Resend | logging)
└── HealthController    liveness + readiness (no module of its own)
```

Two entries this map used to carry are **not built**: `UsersModule` — user
lifecycle lives inside Auth and Employees — and `NotificationsModule`, which is
covered below. `EmployeesModule` also used to claim offboarding and an org-chart
query; neither exists (`docs/15-feature-audit.md` §2).

## Internal module layout (uniform)

```
modules/leave/
├── leave.module.ts
├── controllers/           # HTTP only: parse, delegate, shape response, Swagger decorators
├── services/              # business rules, transactions, tenant scoping
├── dto/                   # request/response DTOs — created from packages/shared Zod schemas (nestjs-zod)
└── events.ts              # typed in-process events this module emits
```

**Boundary rules**
1. Controllers never touch Prisma. Services own queries; cross-module reads call the other module's exported service.
2. **Validation is Zod end-to-end** — the same schema in `packages/shared` powers RHF on web and DTO validation in Nest (`nestjs-zod`). One definition, no drift with the frontend, still Swagger-documented.
3. Every tenant-scoped service method takes an `AuthContext` (`{userId, orgId, employeeId, perms}`) as its first argument — scoping is explicit in signatures, not ambient.

## Cross-cutting pipeline (request lifecycle)

```
helmet/CORS → pino http log → ThrottlerGuard → JwtAuthGuard → PermissionsGuard
  → ZodValidationPipe → Controller → Service (tx, scope) 
  → interceptors: Audit (mutations) · ClassSerializer (strips passwordHash etc.)
  → HttpExceptionFilter (RFC-7807 shape, maps Prisma known errors → 404/409)
```

## Domain events — designed, not built

> **Not implemented.** `@nestjs/event-emitter` is not a dependency and no
> `events.ts` exists in any module. Services call each other directly.

The original design put `EventEmitter2` with typed contracts in each module —
`leave.requested` → notify approver, `announcement.published` → notifications
fan-out, and so on — as the seam where BullMQ + Redis would later take over.

It was never needed, because the two things it existed to carry both went
elsewhere. Notifications were not built at all (below), and mail is sent by a
direct call after the transaction commits, where a failed send can be *returned
to the caller* rather than swallowed by a listener. For an invite, that is the
better shape: HR finds out immediately and can resend.

The seam is still the right one if durable background work ever arrives. It is
recorded here as a design note, not as something the code does.

## Scheduled jobs — one is a real gap, three are not

> **Not implemented.** `@nestjs/schedule` is not a dependency and there are zero
> `@Cron` decorators. **Nothing in this system runs on a timer.**

That is mostly deliberate. The system derives state when it is read rather than
writing it overnight — see *Nothing is calculated overnight* in
[12-how-it-works.md](./12-how-it-works.md). A nightly job that has not run yet
is a source of wrong answers at 00:05; a derivation cannot be stale.

| Originally specified | What actually happens |
|---|---|
| `attendance.day-close` — nightly, marks ABSENT/HOLIDAY/WEEK_OFF | **Superseded.** Day status is derived on read, in a defined precedence order. No job needed. |
| `announcement.expire` — hourly, hides expired posts | **Superseded.** `publishAt`/`expiresAt` are enforced in the query `where`, so an expired post is invisible the moment it expires rather than up to an hour later. |
| `leave.year-end` — writes next-year balances | **Superseded.** Balances are provisioned lazily the first time a leave year is touched, which also handles an employee joining mid-year. |
| `auth.session-prune` — deletes expired sessions | **Still a real gap.** Nothing deletes rows from `RefreshSession`; the table grows without bound. Expired sessions are refused at use, so this is storage growth rather than a security hole — but it is the one item here that was not replaced by anything. |

The first three are not missing work. Retaining them as a to-do list would keep
pointing maintainers at jobs that would duplicate logic already in the read
path, or reintroduce staleness the current design does not have.

## Data access

- **PrismaService** with `$transaction` helper; multi-write invariants (e.g. leave approve = update request + increment balance.used) are always transactional.
- **Tenant scoping:** every query includes `organizationId` from `AuthContext`. Enforced by convention + a unit-test suite that asserts each service method filters by org (the cheap Phase 1 substitute for RLS; Postgres RLS is the noted upgrade path).
- Migrations via `prisma migrate`; **seed** creates: org, roles+permission matrix (doc 04), admin user, default leave types, default shift, document categories.

## Testing strategy

| Layer | Tool | Status |
|---|---|---|
| Unit | Jest (Nest default) | **Built.** 34 suites, 468 tests — balance math, rotation/reuse, scope filters, payroll calculation, geofencing. |
| Integration | Jest + Testcontainers (Postgres) | **Not built.** No Testcontainers dependency; nothing runs against a real database. |
| E2E (API) | Supertest | **Not built.** `supertest` is installed and imported by no spec. |

Coverage gate: **not enforced.** `ci.yml` runs `turbo run test` with no coverage
threshold, so "services ≥ 80%" is an intention rather than a gate.

The unit layer is genuinely strong where the risk is — the pure business rules
in `payroll.calc.ts`, `attendance.util.ts` and the leave math all have dense
suites. The weak spot is the opposite corner: the services that touch Prisma.
`organization` (7 controllers, 7 services), `audit`, and all five payroll
services have **no spec at all**, which is exactly where an integration layer
would have paid. See [15-feature-audit.md](./15-feature-audit.md).
