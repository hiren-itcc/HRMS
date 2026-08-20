# 13 — NestJS Architecture

Modular monolith. One deployable, strict module boundaries — the "microservices later if ever" shape. No CQRS, no event bus, no repositories-over-Prisma abstraction in Phase 1 (Karpathy rule: nothing speculative); seams are noted where each would land.

## Module map

Thirty first-party modules, registered in `apps/api/src/app.module.ts`.

```
AppModule
├── ConfigModule          (global) Zod-validated env, typed accessor
├── PrismaModule          (global) PrismaService (+ tx helper)
├── LoggerModule          (global) nestjs-pino — request-scoped, redacts auth headers/cookies
├── StorageModule         (global) StorageAdapter port (SupabaseStorage | LocalDiskStorage)
├── NotificationsModule   (global) in-app + email notify, per-user preference
├── ThrottlerModule       (framework) rate limiting, guard registered below
│
├── AuthModule            strategies/jwt, guards, token + invite services
├── RbacModule            PermissionsGuard, @RequirePermissions, role CRUD, custom roles
├── OrganizationModule    org, departments, designations, employment types, locations, shifts, holidays
├── EmployeesModule       employee CRUD, directory, "me" profile, offboard action
├── EmployeeImportModule  CSV template, preview, commit
├── OnboardingModule      invite a hire, self-serve intake, HR review queue
├── AttendanceModule      check-in/out, sessions, records, correction requests
├── LeaveModule           types, balances, requests
├── WfhModule             remote-work requests and the weekly cap
├── DocumentsModule       per-employee upload/stream, folders
├── LettersModule         templates, issue, void
├── AnnouncementsModule   feed, audience resolution, read receipts, attachments
├── PayrollModule         structures, salaries, runs, payslips, reports,
│                         pay components, income tax
├── SettlementsModule     full-and-final settlement on exit
├── ResignationsModule    resignation request and approval
├── OffboardingModule     exit checklist, clearance, exit interview
├── AssetsModule          register, assignment, exit clearance feed
├── ExpensesModule        categories, claims, approval → payslip line
├── PerformanceModule     goals, review cycles, ratings
├── HelpdeskModule        tickets, threads, desks and the queue
├── ProjectsModule        project register, staffing, weekly timesheets, utilisation
├── RecruitmentModule     openings, candidates, interviews, offers, public careers page
├── ReportsModule         read-only aggregate queries + CSV/Excel serializer
├── DashboardModule       the landing summary
├── LifecycleJobsModule   POST /lifecycle/run — the seam where a scheduler would sit
├── SettingsModule        typed settings registry over key-value rows, email templates
├── AuditModule           audit query + facets (writes go through auditMutation)
└── HealthController      liveness + readiness (no module of its own)
```

**`MailModule` is deliberately not in that list.** It is not an `AppModule`
child — it is imported by the four modules that actually send mail (Auth, Leave,
Notifications, Onboarding), which keeps "who can send email" answerable from the
import graph rather than from grep.

**`PrismaModule` and `NotificationsModule` are `@Global`**, which is why several
modules — Performance, Helpdesk, Projects — have a genuinely empty `imports`
array. A module with nothing to import is the goal, not an oversight.

One entry this map used to carry is still **not built**: `UsersModule` — user
lifecycle lives inside Auth and Employees.

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
helmet/CORS → pino http log → requestContextMiddleware
  → ThrottlerGuard → JwtAuthGuard → PasswordChangeGuard → OnboardingGuard → PermissionsGuard
  → ZodValidationPipe → Controller → Service (tx, scope)
  → HttpExceptionFilter (RFC-7807 shape, maps Prisma known errors → 404/409)
```

Five guards, in that order, registered as `APP_GUARD` in `app.module.ts`. The
two in the middle are easy to miss and both are refusals rather than checks:
`PasswordChangeGuard` blocks everything except the change-password route while
`User.mustChangePassword` is set, and `OnboardingGuard` does the same for a
starter who has not finished intake — with `@AllowDuringOnboarding` as the
escape hatch on the handful of routes they legitimately need.

**There is exactly one middleware**, and it is the only reason `AppModule`
implements `NestModule`. `requestContextMiddleware` opens an
`AsyncLocalStorage` store holding the client address so `auditMutation` can
record it without a `Request` being threaded through 164 call sites. It lives on
the module rather than in `main.ts` on purpose: the integration harness builds
the app straight from `AppModule`, and an audit trail that depends on which
entrypoint started the process is not one worth having.

**There are no interceptors.** `app.module.ts` registers zero `APP_INTERCEPTOR`.
Auditing is an explicit `auditMutation` call in each service, which is the
decision recorded above; nothing strips fields on the way out, because the
services select what they return rather than returning rows.

## Domain events — designed, not built

> **Not implemented.** `@nestjs/event-emitter` is not a dependency and no
> `events.ts` exists in any module. Services call each other directly.

The original design put `EventEmitter2` with typed contracts in each module —
`leave.requested` → notify approver, `announcement.published` → notifications
fan-out, and so on — as the seam where BullMQ + Redis would later take over.

It was never needed, because the two things it existed to carry both went
elsewhere. **Notifications shipped without it** — `NotificationsModule` is
`@Global` and senders call `notify()` or `notifyPermission()` directly, so a
fan-out is a function call rather than a listener nobody can find. And mail is
sent by a direct call after the transaction commits, where a failed send can be
*returned to the caller* rather than swallowed by a listener. For an invite,
that is the better shape: HR finds out immediately and can resend.

What is genuinely still absent is what an emitter would have bought on top:
digests, batching, and retry of a failed fan-out.

The seam is still the right one if durable background work ever arrives. It is
recorded here as a design note, not as something the code does.

## Scheduled jobs — one is a real gap, three are not

> **Not implemented.** `@nestjs/schedule` is not a dependency and there are zero
> `@Cron` decorators. **Nothing in this system runs on a timer.**
>
> That is still true, and one piece of work now depends on it staying true.
> `LifecycleService` confirms probations that have ended and closes notice
> periods that have run out — writes no derivation can do. It runs off
> `GET /auth/me`, at most once a day per organization, guarded by a
> `lifecycle.lastRunAt` setting row; `POST /lifecycle/run` does the same on
> demand and is the seam an external scheduler can be pointed at later.
>
> A `@Cron` was the obvious answer and is the wrong one here: the instance
> sleeps after fifteen idle minutes, so a nightly job would silently not fire on
> any night nobody used the product — no error, no log, just a day that did not
> happen. Everything the tick writes is **also derived on read**, so no screen
> depends on it having run; the worst a missed tick causes is a login that stays
> live a few hours longer than it should.

That is mostly deliberate. The system derives state when it is read rather than
writing it overnight — see *Nothing is calculated overnight* in
[12-how-it-works.md](./12-how-it-works.md). A nightly job that has not run yet
is a source of wrong answers at 00:05; a derivation cannot be stale.

| Originally specified | What actually happens |
|---|---|
| `attendance.day-close` — nightly, marks ABSENT/HOLIDAY/WEEK_OFF | **Superseded.** Day status is derived on read, in a defined precedence order. No job needed. |
| `announcement.expire` — hourly, hides expired posts | **Superseded.** `publishAt`/`expiresAt` are enforced in the query `where`, so an expired post is invisible the moment it expires rather than up to an hour later. |
| `leave.year-end` — writes next-year balances | **Superseded.** Balances are provisioned lazily the first time a leave year is touched, which also handles an employee joining mid-year. |
| `auth.session-prune` — deletes expired sessions | **Replaced, not skipped.** `TokenService.pruneExpired` deletes a user's expired rows whenever that user creates a session, so the work happens where the growth does and a dormant account costs nothing. Revoked-but-unexpired rows survive — reuse detection has to find the session to know a replay was a replay. |

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
| Unit | Jest (Nest default) | **Built.** 88 suites, 1,696 tests — balance math, rotation/reuse, scope filters, payroll calculation, income-tax projection and slabs, geofencing, offboarding, the org tree. The web app has its own Vitest layer (doc 09), 34 files and 225 tests; `pnpm turbo run test` runs both. |
| Integration | Jest + Supertest against a real Postgres | ✅ **Built** — `apps/api/test/*.e2e-spec.ts`, run by the `integration` CI job after `migrate deploy` and a seed. **Testcontainers is deliberately not used**: with a service container in CI it buys only local convenience and costs a Docker requirement on every machine, and `docker/compose.yaml` already provides local Postgres. |
| E2E (API) | Supertest | ✅ **Built.** It was installed and imported by no spec for months, which is how the password-reset enumeration bug reached production — the failure needed an injected transport, so no mocked-Prisma unit test and no browser flow could see it. |

Coverage gate: **not enforced.** `ci.yml` runs `turbo run test` with no coverage
threshold, so "services ≥ 80%" is an intention rather than a gate.

The unit layer is genuinely strong where the risk is — the pure business rules
in `payroll.calc.ts`, `tax.engine.ts`, `attendance.util.ts` and the leave math
all have dense suites. The weak spot is the opposite corner: the services that
touch Prisma. `organization` (7 controllers, 7 services), `audit`, and three
of the payroll services — `employee-salaries`, `payroll-reports` and
`salary-structures` — have **no spec at all**, which is exactly where an integration layer pays.

`payroll-runs` and `payslips` came off that list on 2026-08-20:
`payroll-runs.service.spec.ts` pins eligibility, the destructive rebuild, the
LOP union rule and the state machine against hand-computed figures (statutory
toggles off, so gross/TDS/net are arithmetic), and `payslips.service.spec.ts`
pins the visibility scoping — including that `mine()` restricts even a
`payroll.read` holder — the payment state machine's all-or-nothing batches,
and the earnings/deductions response shape the e2e depends on. `calculate` is
still also covered end-to-end by `payroll-tax.e2e-spec.ts` in CI.
See [15-feature-audit.md](./15-feature-audit.md).
