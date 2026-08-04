# 15 — Feature audit: what is missing, and where the docs disagree with the code

Reviewed 4 August 2026 against commit `de67af1`. Covers all 18 API modules, 57
web pages, the 54-permission catalogue and docs 00–14.

> **Status:** every **P0** item is done, and **6 of 9 P1 items**. Built so far:
> session pruning, session management, the four orphaned endpoints, structure
> deactivation, payroll adjustments, offboarding and emergency contacts. Still
> open: the org chart and frontend tests. Items struck through below are fixed.

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
| ~~**Session management**~~ | `03:26`, `07:41`, `05:66` | ✅ **Built.** `GET /auth/sessions`, `DELETE /auth/sessions/:id` and `/profile/sessions`, linked from the avatar menu. |
| ~~**Offboarding**~~ | `03:46`, `05:64`, `12:118-120` | ✅ **Built.** `POST /employees/:id/offboard` plus the screen-12 dialog. Retires the dead `employee.offboard` permission and gives `EmployeeStatus.ON_NOTICE` its first meaning. |
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

### ~~Payroll adjustments — the largest one~~ ✅ **built**

`payroll.calc.ts` fully implemented one-off bonuses, incentives and loan
recovery, with 12 dedicated passing tests, and `payroll-runs.service.ts`
hardcoded `adjustments: []`. There was no endpoint, no DTO and no table to enter
one, so the whole feature was finished and unreachable.

Now a `PayrollAdjustment` table, three endpoints and a panel on the run screen.
Notes worth keeping:

- An adjustment belongs to the **month**, not the run, so deleting and
  recalculating a run keeps it. Calculation is destructive by design.
- Unique per `(employee, month, component)`. Two "Bonus" rows would print two
  payslip lines with the same code and no way to tell them apart, so entering
  the same one twice raises the figure instead of failing.
- The amount is always positive; whether it adds or subtracts comes from the
  component's kind, so a negative bonus cannot be typed by accident.
- Statutory and employer-cost components are refused — PF is computed from
  settings, and a hand-entered PF line would disagree with the rules that
  produced it.
- Refused once the month is locked or published, the same rule salary revisions
  follow.

This also unblocked most of `11:82-86`: bonuses and incentives are done, and
loans and reimbursements can be entered per month — what is still missing is the
EMI *schedule* and the reimbursement approval flow, not the payslip line.

### Everything else

| Thing | Where | Status |
|---|---|---|
| `leave_approved`, `leave_rejected` emails | `email-templates.service.ts:24` | **Open.** Editable in Settings; no sender. Approving leave notifies nobody. |
| ~~Folder rename~~ | `documents.controller.ts:68` | ✅ **Wired.** Matters more than it looks: a folder cannot be deleted while documents are in it, so a badly-named folder people had already filed into could only be fixed by emptying it first. |
| ~~Delete a salary revision~~ | `payroll.controller.ts:150` | ✅ **Wired** onto the revision timeline. This audit first called it "unassign a salary", which was **wrong** — it deletes one revision, and the API refuses once that month's payroll is settled. |
| ~~One employee's attendance month~~ | `attendance.controller.ts:85` | ✅ **Wired** as a card on the employee record — the tab `05:62` specifies. Read-only: there is no admin attendance editor and no endpoint for one. |
| ~~Announcement permalink~~ | `announcements.controller.ts:88` | ✅ **Wired.** `/announcements/[id]`, linked from each card title. |
| ~~"Deactivate it instead"~~ | `structures/page.tsx:169` | ✅ **One click now.** This audit said no deactivate control existed anywhere. That was **overstated** — the structure editor has always had an active switch. What was missing was a control where the advice is given, so acting on it meant opening the editor to hunt for a toggle. |
| `unknownVariables()` ×2, `isRunEditable()`, `editBlockedReason()`, `currentLeaveYear()` | letters, settings, payroll, rbac, leave | **Open.** Implemented, zero callers outside their own specs. |

### Dead permissions

Granted to roles, enforced by nothing. They make the RBAC matrix in `04` read
as though it describes enforcement, when for these three rows it does not.

| Permission | Granted to | Reality |
|---|---|---|
| ~~`employee.offboard`~~ | Admin, HR | ✅ Now enforced on `POST /employees/:id/offboard`. |
| `attendance.manage` | Admin, HR | Shifts CRUD lives under `organization/shifts` and is gated by `org.manage`. |
| `employee.update.own` | everyone | `PATCH /me/profile` has no `@RequirePermissions` and never checks it; self-scoping comes from the JWT subject. |

### Dead schema

| Object | Line | State |
|---|---|---|
| `Notification` | `schema.prisma:643` | Zero reads, zero writes. Only reference is a `deleteMany` in the seed. |
| ~~`EmergencyContact`~~ | `:318` | ✅ **Alive.** Editable on `/profile` as a replace-all array and shown on the employee record. It was written by the seed and read by nothing — not even in `DETAIL_INCLUDE`, so the seeded rows were unreachable. |
| `Document.visibility`, `enum DocVisibility` | `:550`, `:564` | Seed writes the literal `'PRIVATE'`; no API code reads or filters it. |
| `Department.headId` | `:146` | Read by the department report, **never written** — no create/update schema accepts it. In any non-seeded tenant the report's "Head" column is permanently `—`. |
| `LocationVerification.OUTSIDE` / `.NOT_APPLICABLE` | `:441`, `:445` | Never produced. `NOT_APPLICABLE` is still the column default, so the default writes a value nothing generates. |
| `AttendanceSource.MOBILE` / `.IMPORT` | `:356-357` | Never written. |
| ~~`EmployeeStatus.ON_NOTICE`~~ | `:242` | ✅ Now set by offboarding. It still behaves like `ACTIVE` in every filter, and that is correct — somebody serving notice is still an employee. `exitDate` is what changes behaviour. |

---

## 4. Where the docs and the code disagree

Grouped by which side needs to change, because that decides the fix.

### 4a. The docs are behind — update the doc — ✅ **fixed**

**~~An entire shipped module appears in no document.~~** ✅ *Resolved.*
Onboarding ships two tables (`EmployeeInvite`, `Onboarding`), 11 endpoints,
three route trees, a new `EmployeeStatus.ONBOARDING`, a dedicated guard, and the
permission `employee.onboarding.approve`. Docs 02, 03, 04 and 05 mentioned none
of it; all four now carry it.

**~~The invite flow is documented two incompatible ways.~~** ✅ *Resolved — and
the answer was that nothing was broken.* Both paths are live and both are
deliberate. *Add employee* creates an ACTIVE login on `DEFAULT_USER_PASSWORD`
with `mustChangePassword`, which is right when HR can say the password out loud
— backfilling existing staff. *Onboard* creates no password at all (argon2 over
32 random bytes) and emails a single-use link to the hire's **personal**
address, because the work mailbox does not exist on day one. A third path,
`createLogin: false`, creates no login at all, and no document mentioned it.

Docs 07 and 12 now describe all three and say which to use when. The defect was
never the code — it was that the docs presented one of three as the only one,
so the natural move with a new hire was the wrong one.

**~~Doc 02 had drifted on eight-plus models.~~** ✅ *Resolved.* It declared
`EmploymentType` twice and incompatibly — a table and an enum, with
`Employee.employmentType` typed as the enum — so anyone following it would write
a column the database does not have. Also missing were
`User.mustChangePassword`, `LeaveRequest.leaveYear` (which `13:141-146` insists
is stored, and is right), `Location.type`, announcement category and priority,
and both onboarding tables. Model and enum names now diff clean both ways, and
the page states that the schema wins where they disagree.

One comment there was wrong rather than merely incomplete, and worth knowing:
`NOT_APPLICABLE` in `LocationVerification` is **not** vestigial like `OUTSIDE`.
It is the column default, and check-in writes only the `in*` columns — so it is
exactly what `outVerification` holds on a session opened and not yet closed.

### 4b. The docs are ahead — either build it or retract it — ✅ **retracted**

**~~"Nothing is calculated overnight" versus four nightly jobs.~~** ✅ *Resolved,
and the useful finding is that only one of the four is a gap.* The code sides
with doc 12 — there is no scheduler at all. Checking each rather than retracting
the table wholesale:

- `attendance.day-close` — **superseded** by derive-on-read.
- `announcement.expire` — **superseded**, and improved on: `publishAt`/`expiresAt`
  are enforced in the query `where`, so an expired post is invisible the moment
  it expires rather than up to an hour later.
- `leave.year-end` — **superseded** by lazy per-year balance provisioning, which
  also handles an employee joining mid-year.
- `auth.session-prune` — ✅ **now handled without a scheduler.**
  `TokenService.pruneExpired` deletes a user's expired rows whenever that user
  creates one, so the cleanup happens where the growth does. Revoked-but-
  unexpired rows survive, because reuse detection has to find the session to
  know a replay was a replay rather than a forgery.

Retracting all four would have been as wrong as leaving them: three would have
pointed maintainers at work that duplicates the read path.

**~~Notifications.~~** ✅ *Retracted* from docs 03, 05, 08, 09, the doc 01 tree
and doc 11's "behind existing NotificationsModule". The dead table is marked as
such in doc 02 and removed from the ER diagram. Building it is P2.

### 4c. Both are defensible; the docs describe a design that was superseded

**~~The sidebar is specified grouped and built flat.~~** ✅ *Doc 05 rewritten to
what shipped.* The nav is a flat array of 11 items from one file, and team and
admin views are tabs inside their section. The routes mattered most: doc 05
named `/team/attendance`, `/team/approvals`, `/leave/admin` and
`/attendance/admin`, and **other documents were citing those names**, so
following them landed nowhere. The real ones are `/attendance/team`,
`/attendance/approvals` and `/leave/settings`; `/attendance/admin` does not
exist at all. The approvals inbox was specified unified and shipped as two.

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
| ~~Screen count~~ | ✅ Doc 05 said 47, doc 11 said 38, and 57 page files exist. The count is gone from doc 05's heading — the two lists do not describe the same set, so no single number was right. |
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

### P0 — the docs actively mislead — ✅ **all done**

1. ~~Document the onboarding module.~~ Added to docs 03, 04 and 05, and both
   tables to doc 02. `f615009`, `c64026f`
2. ~~Resolve the two invite flows.~~ **Both are deliberate and both stay** —
   *Add employee* for staff who already work here, *Onboard* for a new hire with
   no work mailbox. There is also a third path, `createLogin: false`, that
   neither doc mentioned. Docs 07 and 12 now describe all three and say which to
   use when. No code changed. `5335657`
3. ~~Retract or build doc 08's async infrastructure.~~ Retracted. Three of the
   four jobs were **superseded, not skipped** — day-close by derive-on-read,
   announcement expiry by the query `where`, leave year-end by lazy
   provisioning — so each row now says what happens instead. `auth.session-prune`
   is the real gap and is P1 below. `46a2c95`
4. ~~Retract or build notifications.~~ Retracted from docs 03, 05, 08, 09 and
   the doc 01 tree, plus the stale "behind existing NotificationsModule" in doc
   11. The dead table is marked as such in doc 02. `46a2c95`, `c64026f`
5. ~~Reconcile doc 02 with the schema.~~ Model and enum names now diff clean
   both ways. `c64026f`

Two things were found while doing them. Doc 08's module map listed a
`UsersModule` and a `NotificationsModule` that do not exist while omitting
Letters, Onboarding, Payroll, Storage and Health — doc 01's tree had the same
drift. And doc 05's sidebar named four routes that do not exist
(`/team/attendance`, `/team/approvals`, `/leave/admin`, `/attendance/admin`),
which other documents were citing.

### P1 — promised, small, and mostly already half-built

6. ~~**Session list and revoke** + `/profile/sessions`.~~ ✅ `fb392ed`
7. ~~**Prune expired refresh sessions.**~~ ✅ `fb392ed` — done where the growth
   happens rather than on a timer, so the no-scheduler design holds.
8. ~~**Wire the four orphaned endpoints**~~ ✅ `1efa22b` — folder rename,
   salary-revision delete, employee attendance card, announcement permalink.
9. ~~**Structure deactivation**~~ ✅ `1efa22b`
10. ~~**Payroll adjustments**~~ ✅ — the engine was already written and tested;
    it needed a table, three endpoints and a panel.

11. ~~**Offboarding**~~ ✅ — `POST /employees/:id/offboard` and the screen-12
    dialog. Retired the dead `employee.offboard` permission and gave
    `ON_NOTICE` its first meaning.

12. ~~**Emergency contacts**~~ ✅ — editable on `/profile`, visible on the
    employee record.

**Still open:**

13. **Org chart** — `managerId` is populated and cycle-checked.
14. **Frontend tests.** Zero exist. Start with the five golden flows in `09:64`
    rather than chasing coverage.
15. **`leave_approved` / `leave_rejected` emails** — editable in Settings, never
    sent by anything.

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
