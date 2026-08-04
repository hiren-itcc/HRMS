# 15 — Feature audit: what is missing, and where the docs disagree with the code

Reviewed 4 August 2026 against commit `de67af1`. Covers all 18 API modules, 57
web pages, the 54-permission catalogue and docs 00–14.

## How to read this

Two different claims appear below and they are not equally strong:

- **Verified** — I ran the check and it returned nothing, or returned the thing
  quoted. The command is given so you can re-run it.
- **Found nothing** — a targeted search came back empty. A differently-named
  implementation could exist and I failed to find it.

Every file:line reference was resolved at the commit above. Line numbers move;
the surrounding quote is the durable part.

The single most useful thing in this document is §4. Missing features are
ordinary backlog. Documentation that describes a feature nobody built is worse
than backlog, because it is indistinguishable from a bug report until someone
spends an afternoon on it.

---

## 1. Broken right now

One item. It is smaller than it first looked, and the correction is worth
recording because it is an easy trap.

### Nothing is currently broken in CI

`biome ci .` exits 1 on a Windows working copy. **That is a CRLF artefact of the
local checkout, not a red pipeline.** Verified by cloning the repo to a fresh
LF checkout — what GitHub Actions builds — where the same command exits 0.

```bash
git -c core.autocrlf=false clone . /tmp/ci-check
cd /tmp/ci-check && biome ci .        # exit 0
```

If you develop on Windows, set `core.autocrlf=input` or `biome ci` will
report every file as mis-formatted and none of it will be real.

Three things that *were* wrong were fixed while writing this: the Biome config
declared schema 2.3.0 against a pinned 2.5.6 CLI (`056fb39`), docs 12 and 14
both said password-reset email was never delivered months after Resend was
wired (`92375f7`), and the bootstrap runbook printed the wrong permission and
grant counts (`de67af1`).

---

## 2. Specified in the docs, absent from the code

Each row was checked. "Verified absent" means the dependency is not installed or
the identifier appears nowhere outside generated Prisma output.

| Feature | Promised in | Status |
|---|---|---|
| **Notifications** — `GET /notifications`, mark-read, bell in the topbar, 30 s polling, event fan-out | `03:119-120`, `05:10`, `08:23`, `09:34` | **Verified absent.** `Notification` exists at `schema.prisma:643` with **zero reads and zero writes**. No module, no UI, no bell. |
| **All four scheduled jobs** — `attendance.day-close`, `leave.year-end`, `auth.session-prune`, `announcement.expire` | `08:61-70` | **Verified absent.** `@nestjs/schedule` is not a dependency. Zero `@Cron` decorators. |
| **Domain events / `EventEmitter2`, `events.ts` per module** | `08:36`, `08:53-59` | **Verified absent.** `@nestjs/event-emitter` is not a dependency. |
| **Frontend tests** — Vitest, Testing Library, MSW, and 5 golden Playwright flows | `09:60-66`; a sprint-exit criterion five times in `11` | **Verified absent.** Zero test files under `apps/web` or `packages/ui`. All 468 tests are API unit tests. |
| **Session management** — `GET /auth/sessions`, `DELETE /auth/sessions/:id`, screen 14 `/profile/sessions` | `03:26`, `07:41`, `05:66` | **Verified absent.** `/profile` contains only `page.tsx`; the avatar menu links only to `/profile`. |
| **Offboarding** — endpoint, dialog listing consequences, `ON_NOTICE` transition | `03:46`, `05:64`, `12:118-120` | **Verified absent.** `employee.offboard` is granted to HR and **enforced nowhere**. `DELETE /employees/:id` uses `employee.delete` instead. |
| **Org chart** — `GET /organization/chart`, screen 16 collapsible tree | `03:36`, `05:72` | Found nothing. The data exists (`managerId`, and a flat direct-reports list renders at `employees/[id]/page.tsx:499`). |
| `GET /employees/:id/reports` | `03:47` | Found nothing. Manager scoping exists via the list filter; the named endpoint does not. |
| **Company-wide documents** and `Document.visibility` | `02:500-514` | **Verified absent.** The enum is dead. Doc 02 self-declares this at `:512-514`. |
| **Employee list saved views and CSV export** | `05:60` | Found nothing. Reports export; the employee list does not. |
| **Integration and E2E layers** — Testcontainers, Supertest | `08:80-84` | `supertest` is installed and imported by no spec. |
| **Coverage gate ≥ 80%, Lighthouse job, `pnpm audit`, Dependabot** | `08:86`, `10:59-63`, `10:84` | **Verified absent** from `ci.yml`, which runs lint → typecheck → build → test → migration drift. |
| `useCan(perm)` hook and `<Can perm="…">` | `07:52`, `09:50` | **Verified absent** under those names. The working equivalent is `can()` from `useSession()`. |
| **Storybook / Ladle** as "the visual contract" | `06:174` | **Verified absent.** No config anywhere. |

---

## 3. Built, but reachable by nobody

Code that exists, passes tests, and cannot be invoked by a user. Cheaper to
finish than to build, and each is currently paying maintenance for nothing.

### Payroll adjustments — the largest one

`payroll.calc.ts` fully implements one-off bonuses, incentives and loan
recovery, with 12 dedicated passing tests at `payroll.calc.spec.ts:211-240`.
`payroll-runs.service.ts:262` hardcodes `adjustments: []`.

There is no endpoint, no DTO and no table to enter one. `11:82-86` lists loans,
bonuses and reimbursements as deferred "plugs in as an adjustment" work — the
engine side is already done.

### Everything else

| Thing | Where | Why nobody reaches it |
|---|---|---|
| `leave_approved`, `leave_rejected` emails | `email-templates.service.ts:24` | Editable in Settings; no sender. Approving leave notifies nobody. |
| Folder rename | `documents.controller.ts:68` | API and client method exist; `/documents/folders` renders only Create and Delete. |
| Unassign a salary | `payroll.controller.ts:150` | `payrollApi.deleteSalary` is written and never called. |
| One employee's attendance month | `attendance.controller.ts:85` | `attendanceApi.employeeMonth` is written and never called; the employee detail page has no attendance tab, though `05:62` specifies one. |
| Announcement permalink | `announcements.controller.ts:88` | `announcementsApi.detail` is written and never called. |
| "Deactivate it instead" | `structures/page.tsx:169` | Delete is blocked with a tooltip recommending deactivation. **No deactivate control exists anywhere.** |
| `unknownVariables()` ×2, `isRunEditable()`, `editBlockedReason()`, `currentLeaveYear()` | letters, settings, payroll, rbac, leave | Implemented, zero callers outside their own specs. |

### Dead permissions

Granted to roles, enforced by nothing. They make the RBAC matrix in `04` read
as though it describes enforcement, when for these three rows it does not.

| Permission | Granted to | Reality |
|---|---|---|
| `employee.offboard` | Admin, HR | No offboarding feature exists. |
| `attendance.manage` | Admin, HR | Shifts CRUD lives under `organization/shifts` and is gated by `org.manage`. |
| `employee.update.own` | everyone | `PATCH /me/profile` has no `@RequirePermissions` and never checks it; self-scoping comes from the JWT subject. |

### Dead schema

| Object | Line | State |
|---|---|---|
| `Notification` | `schema.prisma:643` | Zero reads, zero writes. Only reference is a `deleteMany` in the seed. |
| `EmergencyContact` | `:318` | Written by the seed, never read. Not in `DETAIL_INCLUDE`, so seeded rows are unreachable — while `03:48` and `05:65` both promise emergency contacts on the profile screen. |
| `Document.visibility`, `enum DocVisibility` | `:550`, `:564` | Seed writes the literal `'PRIVATE'`; no API code reads or filters it. |
| `Department.headId` | `:146` | Read by the department report, **never written** — no create/update schema accepts it. In any non-seeded tenant the report's "Head" column is permanently `—`. |
| `LocationVerification.OUTSIDE` / `.NOT_APPLICABLE` | `:441`, `:445` | Never produced. `NOT_APPLICABLE` is still the column default, so the default writes a value nothing generates. |
| `AttendanceSource.MOBILE` / `.IMPORT` | `:356-357` | Never written. |
| `EmployeeStatus.ON_NOTICE` | `:242` | Settable, but no logic branches on it — behaves identically to `ACTIVE`. |

---

## 4. Where the docs and the code disagree

Grouped by which side needs to change, because that decides the fix.

### 4a. The docs are behind — update the doc

**An entire shipped module appears in no document.** Onboarding ships two tables
(`EmployeeInvite`, `Onboarding`), 11 endpoints, three route trees, a new
`EmployeeStatus.ONBOARDING`, a dedicated guard, and the permission
`employee.onboarding.approve`. Docs 02, 03, 04 and 05 mention none of it. Doc
04's catalogue is short by exactly that one permission.

**The invite flow is documented two incompatible ways, and both code paths
exist.** `07:70-73` and `12:107-109` say an account is created in the same
transaction on a shared `DEFAULT_USER_PASSWORD` with `mustChangePassword`.
`mail.service.ts:41-45` describes the opposite: a single-use link to the hire's
**personal** address, and "no password is ever put in it".
`employees.service.ts:217` still reads `DEFAULT_USER_PASSWORD`, so both are
live — which one runs depends on whether HR used *Add employee* or *Onboard*.
This is the most confusing thing in the repo for a newcomer.

**Doc 02 claims at `:68-69` to be "the narrative form" of the applied schema and
has drifted on eight-plus models**, including declaring `EmploymentType` twice
and incompatibly — as a table at `:223-230` and as an enum at `:302`. Also
missing: `User.mustChangePassword`, `LeaveRequest.leaveYear` (which `13:141-146`
insists is stored), `Location.type`, announcement category and priority, and the
two onboarding tables.

### 4b. The docs are ahead — either build it or retract it

**"Nothing is calculated overnight" (`12:174`) versus four nightly jobs
(`08:65-68`).** The code sides with doc 12: there is no scheduler. Doc 08's jobs
table describes a superseded design that nobody retracted. One of the four —
`attendance.day-close` — was genuinely replaced by derive-on-read. The other
three were not replaced by anything:

- `leave.year-end` — balances are provisioned lazily per leave year, so this is
  arguably covered. Worth confirming rather than assuming.
- `auth.session-prune` — **nothing deletes expired refresh sessions.** The table
  grows without bound.
- `announcement.expire` — expiry is enforced in the query `where`, so the
  behaviour is right and only the job is missing.

**Notifications** (§2) is the largest example: four documents describe a feature
with a database table and no code.

### 4c. Both are defensible; the docs describe a design that was superseded

**The sidebar is specified grouped and built flat.** `05:20-39` wants
collapsible *My Space* / *My Team* / *People* groups; `nav-items.ts:28` is a
flat array of 11 items. Routes differ too: `/attendance/team` vs the specified
`/team/attendance`, `/leave/settings` vs `/leave/admin`, and `/attendance/admin`
does not exist at all. `05:81` also specifies a **unified** approvals inbox —
leave and regularisation on one screen — where the code ships two.

**The web route guard.** Docs 01, 07 and 09 all describe `middleware.ts`
checking refresh-cookie presence. The file is `proxy.ts` (Next 16 renamed the
primitive) and it checks a separate non-httpOnly marker cookie — necessarily so,
since the refresh cookie is scoped to `Path=/api/v1/auth` on a different host.
The docs' mechanism could not work as written.

**Self-service paths.** `03:8` sets a `/me/...` convention. Letters and profile
honour it; `03:68` `GET /me/attendance` is really `/attendance/me`, and `03:79`
`GET /me/leave/balances` is really `/leave/balances/me`.

**Signed URLs.** `03:92` and `02:803` specify `GET /documents/:id/download`
returning a 302 to a signed URL. The route is `/documents/:id/file` and streams
through the API — deliberately, because `ensureEmployeeAccess` is what makes
personnel files private and a signed URL routes around it. The doc should record
the reasoning, not the original plan.

### 4d. Small but wrong

| | |
|---|---|
| Fonts | `06:61` says Inter + Geist Mono via `@fontsource-variable`, explicitly not `next/font`. `09:56` says `next/font` with Plus Jakarta Sans. `packages/ui/package.json` confirms doc 06; Plus Jakarta Sans appears nowhere. |
| Screen count | `05:44` says 47 screens; `11:49` says 38. |
| Settings groups | `03:206` says "the three groups" and then lists four. |
| PDF export | `README:16` claims CSV/Excel/**PDF**. No PDF path exists; `12:383` agrees with the code. |
| Component count | `06:115` says 56 primitives; there are 57 (`time-picker.tsx` is undocumented). |
| ADR status | `00:3` still reads "Nothing below is implemented yet." |
| Undocumented endpoints | ~15 shipped endpoints are in no doc, including `PATCH /employees/:id/role`, `PUT /employees/:id/bank`, `GET /attendance/summary`, `GET /leave/requests/preview` and all the `options` sub-routes. |

---

## 5. How this compares to the Indian HRMS market

Benchmarked against **Keka**, **greytHR**, **Zoho People** and **Darwinbox** —
the products this would be sold against, and the ones whose statutory model the
payroll module already follows (PF, ESI, PT, ₹, Indian holidays).

### Modules

| Module | Here | Keka / greytHR / Zoho |
|---|---|---|
| Core HR, employee master | ✅ strong — scoped RBAC, audit, soft delete | ✅ |
| Attendance | ✅ **ahead** — geofenced work-mode detection, multi-session days, derive-on-read | ✅ + biometric, facial, IP restriction, mobile |
| Leave | ✅ strong — configurable year, carry-forward, half-days | ✅ |
| Payroll calculation | ✅ strong — structures, effective-dated revisions, locked runs, frozen payslips | ✅ |
| Documents & letters | ✅ **ahead** on letters — frozen output, content-based salary gating | ✅ |
| Announcements | ✅ | ✅ |
| Reports | ✅ 4 + dashboard | ✅ + custom report builder |
| Onboarding | ✅ invite → self-serve → HR review | ✅ |
| **Recruitment / ATS** | ❌ | ✅ all four |
| **Performance / goals / OKR** | ❌ | ✅ all four |
| **Expense & reimbursement** | ❌ | ✅ all four |
| **Asset management** | ❌ | ✅ Keka, Darwinbox |
| **Exit / offboarding + FNF** | ❌ | ✅ all four |
| **Helpdesk / ticketing** | ❌ | ✅ Zoho, Darwinbox |
| **LMS / training** | ❌ | ✅ Zoho, Darwinbox |
| **Engagement / surveys** | ❌ | ✅ Darwinbox, Keka |
| **Org chart** | ❌ | ✅ all four |
| **Mobile app** | ❌ | ✅ all four |
| **Notifications** | ❌ | ✅ all four |
| **Bulk import / export** | ❌ (reports only) | ✅ all four |
| Multi-entity payroll | ❌ (schema is org-scoped and ready) | ✅ Keka, greytHR |

### Statutory filing — the sharpest commercial gap

The engine computes PF, ESI and PT correctly, and the rates come from settings
rather than constants. What it cannot produce is the **filing artefacts**, which
is what an Indian payroll buyer is actually purchasing:

| Output | Status |
|---|---|
| **Form 16** (Part A + B) | ❌ — `11:89` scopes it as "a tax engine, not a payroll feature" |
| **Form 24Q** quarterly TDS return | ❌ |
| **ECR** text file for the EPFO portal | ❌ |
| **ESIC** contribution challan | ❌ |
| **Form 12BB** / investment declarations | ❌ |
| **Old vs new regime** TDS projection | ❌ — monthly TDS is typed in per employee |
| **Gratuity** | ❌ |
| **Bonus** (Payment of Bonus Act) | ❌ |
| **LWF** | ❌ |
| PF / ESI / PT / register / bank-transfer reports | ✅ six reports ship |

greytHR's whole market position is that these are one click. Any pitch against
it has to answer this.

---

## 6. Prioritised TODO

### P0 — the docs actively mislead

1. **Document the onboarding module** in docs 02, 03, 04, 05. It ships and is in
   no specification. — *docs only*
2. **Resolve the two invite flows.** Decide whether `DEFAULT_USER_PASSWORD`
   creation survives now that invites exist, then make docs 07 and 12 describe
   the one that does. — `employees.service.ts:217`, docs 07, 12
3. **Retract or build doc 08's async infrastructure.** Events, `EventEmitter2`
   and four jobs, none of which exist. At minimum mark the table superseded and
   keep `auth.session-prune` as a real item. — `docs/08`
4. **Retract or build notifications.** Four docs describe it; a table exists;
   nothing else does. — `docs/03`, `05`, `08`, `09`
5. **Reconcile doc 02 with the schema** — eight-plus divergences including the
   duplicate `EmploymentType`. — `docs/02`

### P1 — promised, small, and mostly already half-built

6. **Session list and revoke** + `/profile/sessions`. `RefreshSession` holds
   everything needed. — new routes in `auth.controller.ts`, one page
7. **Prune expired refresh sessions.** Nothing deletes them today.
8. **Offboarding** — endpoint, `ON_NOTICE`, exit date, consequences dialog.
   Retires a dead permission and a dead enum member at the same time.
9. **Wire the four orphaned endpoints** — folder rename, unassign salary,
   employee attendance tab, announcement permalink. Client methods already
   exist; each needs a button.
10. **Structure deactivation** — the UI already tells users to do it.
11. **Emergency contacts** on the profile screen — table and seed data exist,
    nothing reads them.
12. **Payroll adjustments** — expose the engine that is already written and
    tested. Unblocks bonuses, loans and reimbursements from `11:82-86`.
13. **Org chart** — `managerId` is populated and cycle-checked.
14. **Frontend tests.** Zero exist. Start with the five golden flows in `09:64`
    rather than chasing coverage.

### P2 — market table stakes

15. Exit & offboarding with full-and-final settlement (`11:88`)
16. Expense & reimbursement
17. Performance / goals / OKR (`11:61` reserves the seam)
18. Asset management (`11:62` reserves the seam)
19. Bulk employee import/export
20. Notifications, if P0 #4 resolves toward building
21. Form 16, Form 24Q, ECR, ESIC challan

### P3 — differentiators, once the above is settled

22. Recruitment / ATS (`11:60`)
23. Helpdesk, LMS, engagement surveys
24. Mobile app (`07:55` designs the auth variant)
25. Multi-tenant self-signup (`11:65` — `organizationId` scoping is already there)

---

## Method

Three parallel agents inventoried the API modules, the web surface and the docs;
every claim quoted here was then re-checked directly. The searches that returned
nothing:

```bash
grep -rn "@nestjs/schedule\|@nestjs/event-emitter\|EventEmitter\|@Cron" apps/api/src apps/api/package.json
grep -rni "notification" apps/api/src apps/web/src --exclude-dir=generated
grep -n "vitest\|playwright\|testing-library\|msw" apps/web/package.json packages/ui/package.json
grep -rn "employee.offboard\|attendance.manage\|employee.update.own" apps packages --include=*.ts
```

The last returns hits only in `packages/shared/src/constants/permissions.ts` and
the generated `dist` — which is the finding.
