# ADR-000 — Architecture Decisions & Challenges

Status: **Proposed — awaiting approval.** Nothing below is implemented yet.

This document records where the requested stack was accepted, where it was challenged, and the assumptions the whole design rests on. Read this first.

---

## 1. Challenges to the requested stack

### 1.1 "Tailwind CSS v5" does not exist — use v4

Tailwind's current major is **v4.x** (CSS-first config, `@theme`, no `tailwind.config.js` required). There is no v5. The design system (doc 10) is written against **Tailwind v4** with CSS custom-property tokens, which is also what coss UI targets. When v5 ships, migration will be a token-layer change only.

### 1.2 Separate NestJS API — accepted, with the trade-off stated

A Next.js-only app (Server Actions + Prisma) would ship Phase 1 faster with half the surface area. We keep **NestJS** anyway because the stated roadmap (mobile app, payroll, AI, integrations) needs a long-lived, framework-agnostic API with RBAC enforced in one place, background jobs, and Swagger for third-party consumers. The cost — duplicated DTO/validation surface — is neutralized by sharing Zod schemas and generated types from `packages/shared` and `packages/types`.

**Consequence:** the Next.js app is a pure API consumer. No Prisma imports in `apps/web`, ever.

### 1.3 Multi-tenancy: decide now, not in Payroll phase

The prompt doesn't say whether this serves one company or many. This is the single most expensive thing to retrofit, so the schema is **multi-tenant-ready from day one**: every tenant-owned table carries `organizationId`, and Phase 1 simply runs with one `Organization` row. Cost today: one column + one index per table. Cost of retrofitting later: a full data migration and an audit of every query.

### 1.4 Refresh tokens in httpOnly cookies, not localStorage

Tokens readable by JS are exfiltratable by any XSS. Access token lives in memory only; refresh token is an **httpOnly, Secure, SameSite=Lax cookie** scoped to `/auth`, with **rotation + reuse detection** (doc 06). This constrains the future mobile app to a header-based variant of the same endpoints — designed in from the start.

### 1.5 RBAC in the database, not in code enums

Hard-coded role checks (`if role === 'HR'`) rot immediately. Permissions are **data**: `Role ↔ Permission` join tables, seeded, checked by a single `PermissionsGuard`. Adding "Payroll Admin" later is a seed row, not a refactor.

### 1.6 What was cut from Phase 1 (simplicity first)

No microservices, no Redis/queue (added when payroll needs it), no event sourcing, no GraphQL, no i18n scaffolding, no soft-delete-everywhere (only where the domain needs it: employees, documents). Each is listed in doc 10-roadmap §future-expansion with its insertion point.

---

## 2. Explicit assumptions (challenge these at review)

| # | Assumption | Impact if wrong |
|---|-----------|-----------------|
| A1 | Single company at launch; multi-tenant later | None — schema already scoped |
| A2 | ~~Web-first; mobile app is a later phase~~ — **settled the other way:** web-only, mobile dropped from the roadmap (doc 11 §20). §1.2 and §1.4 above are left as written, because they record why the decision was made at the time | None — the header-token variant §1.4 constrains itself to is documented and unbuilt either way (doc 07) |
| A3 | File storage is S3-compatible (or local disk in dev via MinIO) | Documents module abstracts storage behind one interface |
| A4 | Deployment is Docker on a VPS/cloud VM (per Docker Compose + GH Actions in the brief), not Vercel | If Vercel is wanted for `web`, only CI docs change |
| A5 | Email (invites, resets) via SMTP provider; provider not chosen yet | One `MailService` port; provider is config |
| A6 | Attendance is check-in/out via web (no biometric hardware in Phase 1) | Device integration lands as a new `source` on the same table |
| A7 | Timezone: org has one default TZ; timestamps stored UTC | Per-location TZ is a column already present on `Location` |

---

## 3. Deliverable index

| # | Deliverable | Document |
|---|------------|----------|
| 1 | Folder structure | `01-folder-structure.md` |
| 2–4 | DB schema, Prisma models, ER diagram | `02-database.md` |
| 5 | API structure | `03-api-structure.md` |
| 7–8 | User roles, permission matrix | `04-rbac.md` |
| 6, 9 | Navigation, UI screen list | `05-navigation-and-screens.md` |
| 10–11 | Design system, component library | `06-design-system.md` |
| 12 | Authentication architecture | `07-auth-architecture.md` |
| 13 | NestJS architecture | `08-nestjs-architecture.md` |
| 14 | Next.js architecture | `09-nextjs-architecture.md` |
| 15–17 | Coding standards, git strategy, CI/CD | `10-engineering-standards.md` |
| 18–20 | Roadmap, sprints, future expansion | `11-roadmap.md` |
