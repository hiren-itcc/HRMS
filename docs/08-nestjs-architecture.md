# 13 — NestJS Architecture

Modular monolith. One deployable, strict module boundaries — the "microservices later if ever" shape. No CQRS, no event bus, no repositories-over-Prisma abstraction in Phase 1 (Karpathy rule: nothing speculative); seams are noted where each would land.

## Module map

```
AppModule
├── ConfigModule        (global) Zod-validated env, typed accessor
├── DatabaseModule      (global) PrismaService (+ tx helper)
├── LoggerModule        (global) nestjs-pino — request-scoped, redacts auth headers/cookies
├── AuthModule          strategies/ (jwt, refresh), guards, token+session services
├── RbacModule          PermissionsGuard, @RequirePermissions, seed catalog
├── UsersModule         user lifecycle (invite/activate/suspend)
├── OrganizationModule  org, departments, designations, locations, holidays
├── EmployeesModule     employee CRUD, offboarding, org-chart query, "me" profile
├── AttendanceModule    check-in/out, records, requests, shifts, day-close job
├── LeaveModule         types, balances, requests, year-end job
├── DocumentsModule     upload/download + StorageService port (S3Adapter | LocalAdapter)
├── AnnouncementsModule feed, audience resolution, read receipts
├── NotificationsModule fan-out on domain events (in-process, doc-listed seam for queue)
├── ReportsModule       read-only aggregate queries + CSV serializer
├── SettingsModule      typed settings registry over key-value rows
├── AuditModule         AuditInterceptor + AuditService.log()
└── MailModule          MailService port (SmtpAdapter; templates)
```

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

## Domain events (in-process now, queue-shaped for later)

Nest `EventEmitter2` with **typed event contracts** in each module's `events.ts`:

`leave.requested` → notify approver · `leave.decided` → notify employee · `attendance.request.decided` · `employee.invited` → mail · `announcement.published` → notifications fan-out.

Handlers must be idempotent and side-effect-only (no business decisions). This is the exact seam where BullMQ + Redis replaces the emitter when Payroll needs durable jobs — call sites unchanged.

## Scheduled jobs (`@nestjs/schedule`)

| Job | When | Does |
|---|---|---|
| `attendance.day-close` | nightly per-location TZ | Marks ABSENT/HOLIDAY/WEEK_OFF for unmarked employees; computes workMinutes for missing checkouts (per settings policy) |
| `leave.year-end` | Jan 1 (org's leave-year from settings) | Writes next-year balances with carry-forward caps |
| `auth.session-prune` | daily | Deletes expired/revoked sessions past retention |
| `announcement.expire` | hourly | Unpins/hides expired announcements |

Jobs are service methods triggered by the scheduler — trivially re-pointed at a queue later.

## Data access

- **PrismaService** with `$transaction` helper; multi-write invariants (e.g. leave approve = update request + increment balance.used) are always transactional.
- **Tenant scoping:** every query includes `organizationId` from `AuthContext`. Enforced by convention + a unit-test suite that asserts each service method filters by org (the cheap Phase 1 substitute for RLS; Postgres RLS is the noted upgrade path).
- Migrations via `prisma migrate`; **seed** creates: org, roles+permission matrix (doc 04), admin user, default leave types, default shift, document categories.

## Testing strategy

| Layer | Tool | What |
|---|---|---|
| Unit | Jest (Nest default) | Services with mocked Prisma — business rules: balance math, rotation/reuse, scope filters, day-close |
| Integration | Jest + Testcontainers (Postgres) | Module flows against real DB: apply→approve leave, check-in/out invariants |
| E2E (API) | Supertest | Auth flows + one happy-path per module + 403 matrix spot-checks (each role hits a forbidden route) |

Coverage gate: services ≥ 80%. Guards/auth/leave-math are the non-negotiable suites.
