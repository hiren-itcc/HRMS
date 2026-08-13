# 18–20 — Development Roadmap, Sprint Planning, Future Expansion

## 18 — Roadmap (Phase 1 ≈ 12 weeks, 6 × 2-week sprints)

```
M0  Foundation ready        (end S1)  repo, CI, DB, auth skeleton runs in Docker
M1  People core             (end S3)  auth + org + employees usable end-to-end
M2  Time & leave            (end S5)  attendance + leave with approvals
M3  Phase-1 complete        (end S6)  docs, announcements, reports, settings, hardening → v1.0.0
M4  Design system + payroll (post-1.0) coss UI migration; payroll core
```

**Shipped after v1.0.0**, in order:

- **coss UI migration** — the Radix primitive layer replaced with coss (Base
  UI). 17 hand-maintained primitives became 56, `radix-ui` dropped, and the
  chrome went neutral with indigo as the accent. Brought a command palette, a
  real date picker, searchable comboboxes and a contrast gate with it.
- **Payroll core** — salary structures, effective-dated salary revisions, the
  Draft→Published run workflow with locking, payslips, payment recording and
  six statutory reports. A new `FINANCE` system role makes separation of duties
  the default rather than an option.

Ordering rationale: every module depends on Employees; Attendance/Leave carry the most business-rule risk, so they get the middle sprints with slack; Reports come last because they read everything else.

## 19 — Sprint planning

### Sprint 1 — Foundation (M0)
Monorepo scaffold (Turbo/pnpm/Biome/Husky/tsconfig bases) · docker compose (postgres, minio) · Prisma schema + initial migration + seed (roles, permissions, admin) · Nest bootstrap (config, pino, Swagger, guards pipeline) · Next bootstrap (shell, theme tokens, `packages/ui` primitives) · CI green.
**Exit:** `docker compose up` + seeded login via Swagger; deploy pipeline dry-run to staging.

### Sprint 2 — Auth & RBAC (M1 start)
Login/refresh-rotation/logout/sessions · invite + reset flows (MailService) · PermissionsGuard + matrix seeds + 403 tests · web: (auth) screens, SessionProvider, api-client refresh, route guarding · Storybook/Ladle for `packages/ui`.
**Exit:** all four roles log in and see role-correct nav; golden E2E #1 (login→dashboard) green.

### Sprint 3 — Organization & Employees (M1)
Org profile/departments/designations/locations/holidays CRUD · employee CRUD + multi-step create + invite + offboard · directory + org chart · my profile + sessions screen · audit interceptor live.
**Exit:** HR creates employee → invite → new user sees Employee dashboard (E2E #4).

### Sprint 4 — Attendance (M2 start)
Check-in/out (idempotent) + today card · my-attendance calendar · shifts · day-close job · regularization request→approve flow · team/admin views · Lighthouse CI job.
**Exit:** E2E #2 (check-in/out) green; day-close verified against fixture TZs.

### Sprint 5 — Leave (M2)
Types + balances + seed defaults · apply flow with day-calc (holidays/week-offs/half-days) + balance preview · approve/reject (transactional balance update) · leave calendar · admin screens + manual adjustment (audited) · unified approvals inbox · notifications fan-out.
**Exit:** E2E #3 (apply→approve) green; balance math unit suite ≥ 95% branch coverage.

### Sprint 6 — Docs, Announcements, Reports, Settings, Hardening (M3)
Documents (upload/download signed URLs, categories, visibility) · announcements (audience, pinned, read receipts) + E2E #5 · 4 reports + CSV export (dataviz-compliant charts) · settings + roles editor + audit viewer · security pass (rate limits, headers, dependency audit), a11y pass (pre-delivery checklist on all 38 screens), perf budgets · **v1.0.0 tag → production**.

**Team assumption:** 1–2 full-stack + this agent; each sprint keeps ~20% slack. Sprints 4–5 carry the domain risk — if timezone/leave-math complexity bites, Reports (S6) is the designated scope buffer.

## 20 — Future expansion plan

The architecture reserves an explicit seam for each planned module — adding one never restructures existing code (doc 01 §4, doc 04 §adding-a-module).

| Module | Lands as | Touches existing schema | New infra |
|---|---|---|---|
| ~~**Payroll**~~ | ✅ **Shipped.** `modules/payroll` + `features/payroll`; derives loss of pay from Leave and Attendance at calculation | none — seven new tables FK to Employee, exactly as designed | none in the end: payslips are HTML + browser print rather than server-rendered PDFs, and calculation is fast enough to stay synchronous, so neither BullMQ nor Redis was needed |
| ~~**Recruitment**~~ | ✅ **Shipped, internal half.** Five tables, six enums, seven permission codes, fourteen routes and five screens. The prediction held exactly: `Candidate` is not `Employee`, and `POST /recruitment/offers/:id/hire` *converts* by calling the same `OnboardingService.onboard` that HR's own screen calls, so employee-code generation, the INVITED user and the invite to the **personal** address stay in one place | none — five new tables FK to Employee, Department, Designation, Location, EmploymentType and Document | ✅ **and the second half shipped too.** The careers page cost one nullable column and one widened one — `JobOpening.slug`, and `Document.uploadedById` losing NOT NULL because an anonymous CV has no uploader, the same call `AuditLog.actorId` already made for the lifecycle tick. `@nestjs/throttler` turned out to be a dependency already, with `ThrottlerGuard` global, so the rate limit is one decorator rather than a new package |
| ~~**Expenses**~~ | ✅ **Shipped.** Three tables, one enum, seven permission codes, thirteen routes and four screens. The prediction held again: a claim becomes a payslip line through `PayrollAdjustmentsService`, so the calculation engine needed no change — the payslip end was already built, and `PayComponent.taxable` had carried the note "Reimbursements and employer contributions do not" since payroll shipped | none — three new tables FK to Organization, Employee, PayComponent and Document | none |
| ~~**Performance**~~ | ✅ **Shipped.** Three tables, three enums, seven permission codes, twenty routes and four screens. **The ApprovalStatus half of this prediction did not survive contact** — see below. The rest did: notifications reuse `notify`/`notifyPermission` unchanged, and the manager-routing pattern (`Employee.managerId`, the own/team/all triad, the `'__none__'` scope sentinel, 404-not-403 on an unreadable row) carried over exactly | none — verified: the migration has zero `ALTER TABLE` against any pre-existing table, zero `DROP`, zero `ALTER COLUMN` | none, and in the strongest sense available: `PerformanceModule` has an empty `imports` array, which no previously shipped module managed |
| ~~**Assets**~~ | ✅ **Shipped.** Three tables, four permission codes, three screens. The exit checklist’s “return company assets” line is now computed from real assignments and cannot be ticked by hand. **Not via an event** — `@nestjs/event-emitter` is still not a dependency, so `AssetClearanceService` writes the task directly | one additive column, `OffboardingTask.kind` | none |
| ~~**WFH / Hybrid**~~ | ✅ **Shipped.** One table, one nullable column on Employee, six permission codes. Attendance already detected who worked remotely; this is only the forward half — asking, agreeing, and a weekly cap | one nullable column, `Employee.remoteDaysPerWeek` | none |
| ~~**Helpdesk**~~ | ✅ **Shipped.** Three tables, three enums, five permission codes, eighteen routes and four screens. The prediction held in the strongest form available: `HelpdeskModule` has an empty `imports` array, the second module to manage it, because `NotificationsModule` and `StorageModule` are both `@Global` and everything else it needs is `PrismaService`. Two shapes were **not** reused on purpose — `ApprovalStatus`, because a ticket is never approved or rejected and `WAITING_ON_REQUESTER` has no member to map to, and the own/team/all triad, because there is no `.team` scope here at all | none — the migration has zero `ALTER TABLE` against any pre-existing table, zero `DROP`, zero `ALTER COLUMN`; `Organization`, `Employee` and `User` gain relation arrays, which emit no DDL | none |
| ~~**Projects & timesheets**~~ | ✅ **Shipped.** Four tables, two enums, eight permission codes, seventeen routes and five screens. `ProjectsModule` has an **empty `imports` array** — the third module to manage it after Performance and Helpdesk. The one thing this module introduced that no other has is an **ownership grant**: a project's own `managerId` may staff it without `project.manage`, checked in the service rather than by the guard, because the alternative was every membership change routing through HR | none — verified: the migration has zero `ALTER TABLE` against any pre-existing table, zero `DROP`, zero `ALTER COLUMN`; `Organization` and `Employee` gain relation arrays, which emit no DDL | none |
| **AI features** | `modules/ai` behind AI Gateway (leave-policy Q&A over docs, attrition signals from Reports read-models) | none | LLM provider key; pgvector if RAG |
| **Multi-tenant SaaS** | activate the dormant `organizationId` scoping: org signup flow + Postgres RLS + per-org subdomain | none (already scoped) | RLS policies, billing |

**Platform upgrades, triggered not scheduled:** SSE/WebSocket notifications when polling chafes · RS256 + JWKS when a second service consumes JWTs · read replicas when reports strain OLTP · Redis cache when p95 > 300 ms on hot lists.

**Rule for every future module:** new folder + new tables + permission seeds + nav entry. If a design requires editing an existing module's internals, the design is wrong — write an ADR first.

Payroll proved the rule holds: seven tables, a system role, 24 endpoints and
nine screens, with no existing module's behaviour touched. The one shared file
it changed — `auditMutation`, which gained an optional `meta` argument — was an
additive signature change every other module benefits from.

The exit phases proved it twice more. Resignation, offboarding and settlement
added eight tables, eleven enums and four screens between them; the only
existing behaviour touched was extracting the body of
`POST /employees/:id/offboard` into `EmploymentTransitionService`, with that
endpoint's original spec left unedited as proof nothing changed. **Settlement
needed no ADR** — a separate entity edits no existing module, so doc 01 rule 4
is satisfied without one. Had it been built as a kind of `PayrollRun`, as first
recommended, it would have needed one.

Assets is the first module to touch an existing table — one nullable-by-default
column, `OffboardingTask.kind`. That is still additive rather than a redesign,
and the seam it uses was left deliberately: `assertCleared`'s own comment said
the gate was generic "so Asset Management can later make one of these items
compute itself without the gate changing at all". It did not change.

Expenses is the first module to change an existing *signature*, and it is worth
being precise about what that means. `PayrollAdjustmentsService.upsert` gained
an optional third argument, `{ mode: 'add' }`, because it *replaced* the amount
for a given (employee, month, component) — which is right for a bonus typed
twice, and silently loses money when two separate expense claims are approved
into the same month against the same category.

That is the same shape as `auditMutation` gaining an optional `meta`: additive,
default-unchanged, and every existing caller behaves exactly as before. It is
deliberately **not** a field on `PayrollAdjustmentInput`, so it stays a decision
a calling service makes and never something an API client can send.

The alternative — expenses writing `prisma.payrollAdjustment` itself — would
have been a second copy of the statutory-component refusal and the locked-month
check, and one of the two would have drifted.

Performance is the first module where a prediction in this table was **wrong**,
and it is worth recording as carefully as the ones that held. The row promised
it would reuse the `ApprovalStatus` machine. It does not, and forcing it would
have been a mistake: that enum is `PENDING/APPROVED/REJECTED/CANCELLED`, and a
review is never approved and never rejected. It is written by two people,
shared, and signed off. `SHARED` mapped onto `APPROVED` makes the enum's name a
lie at every call site, and `ACKNOWLEDGED` has no member to map to at all.
Widening the shared enum instead would have made both representable on every
`LeaveRequest`, `AttendanceRequest` and `RemoteWorkRequest` in the product —
a redesign of three modules this one has no business touching, which is exactly
what rule 4 forbids.

`ExpenseClaimStatus` had already set this precedent for the same reason, so the
honest reading is that the prediction was written from the shape of the
workflow rather than from the vocabulary it needs. What *did* carry over is the
larger half and the part that would have been expensive to get wrong: the
manager-routing pattern, the permission triad, the scope sentinel, and the
notification calls, all unchanged.

Performance also changes **no existing signature at all** — worth stating
because expenses is on record above as the first module that did. It calls
`NotificationsService.notify`, `notifyPermission` and `auditMutation` exactly as
they already are.

Recruitment is the cleanest confirmation so far, because the prediction in this
very table was written before the code and turned out to be checkable. It
promised that a hire would *convert* rather than create, and the seam it
converts through — `OnboardingService.onboard` — needed one line added to make
it available: `exports: [OnboardingService]`. Nothing inside it changed. The
alternative, a second path that created an `Employee` and a `User` directly,
would have been a second copy of the code-generation, the unusable-password
hash, the onboarding row and the invite — and one of those four would have
drifted.

It did surface a defect of its own kind, worth recording because it is the sort
that does not fail loudly: money left the API as a `Decimal`, which serializes
to JSON as a string, while the web side declared it a number. `NaN` on a screen
is not a stack trace. `recruitment.mapper.ts` converts at the boundary, as
payroll's mapper already did — the lesson being that "every module converts its
own Decimals" is a convention nothing enforces.

## Payroll — what is deliberately not built yet

The specification was delivered in two phases. Phase 1 is above; Phase 2 is
scoped and unblocked, since the calculation engine already accepts an
`adjustments[]` input and the payslip already renders arbitrary lines:

| Deferred | Why it can wait |
|---|---|
| ~~Bonuses & incentives~~ | ✅ **Shipped.** Entered per employee per month on the run screen; not prorated, because a bonus is a bonus however much of the month was worked. |
| Loans & advances (EMI schedules, outstanding balance) | **Half shipped.** A single instalment can be entered as a deduction adjustment and the negative-net guard handles the month an EMI exceeds pay. What is missing is the *schedule*: an outstanding balance that draws down by itself rather than being typed in each month. |
| Reimbursements (requested → approved → paid) | **Half shipped.** The amount can be entered as a non-taxable earning adjustment. Missing is the request-and-approve flow in front of it. |
| **Arrears** from a back-dated revision after a locked month | Genuinely hard: needs a recalculation diff against a settled run. Today a revision into a locked month is refused rather than silently wrong |
| ~~**Full-and-final settlement** on exit~~ | ✅ **Shipped**, and it was module-sized as predicted: two tables, three enums, eleven routes and two screens. It is deliberately *not* a `PayrollRun` — see doc 02’s notable design calls for the four findings that killed that shape — and its amounts sit outside the statutory base. |
| ~~TDS projection (regimes, declarations)~~ | ✅ **Shipped.** Eight tables, three permission codes, a pure engine and four screens. Regime per financial year defaulting to New, an old-regime declaration HR approves, an annual projection off the salary structure, and monthly TDS as **remaining tax ÷ remaining payroll months** — twelve in April, six in October, one in March. Slabs are rows rather than constants, so a Finance Act change is a configuration edit. **Form 16 is still out**: Part A is issued by TRACES and Part B needs an annual statement this does not produce |

Each is additive. None of them requires changing what is already there.
