# 15 — Feature audit: what is missing, and where the docs disagree with the code

Reviewed 4 August 2026 against commit `de67af1`, and re-swept 13 August 2026.
Covers all 30 API modules, 104 web pages, the 111-permission catalogue and
docs 00–15.

> **Status:** every **P0** and every **P1** item is done — session pruning,
> session management, the four orphaned endpoints, structure deactivation,
> payroll adjustments, offboarding, emergency contacts, the org chart and a
> frontend test layer that CI gates on.
>
> **The one piece deliberately not built is Playwright and the five golden
> flows.** They need a seeded database and a running API in CI, which does not
> exist yet; a suite that cannot run in CI is not a gate. That is the next
> infrastructure job, and it is tracked in §6.
>
> **P2 and P3 are no longer untouched**, whatever this box used to say: exits
> and the full-and-final settlement, WFH, assets, notifications and recruitment
> have all shipped since the review. Items struck through are done; the rest of
> P2 and P3 stand.

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

### ~~Password reset leaked whether an account existed~~ ✅ fixed

Found in production on 7 August, by sending one password-reset request to see
whether email worked at all. It did not, and the 500 that came back was the
finding: `AuthService.forgotPassword` let a refused send throw, so a real
account answered 500 and an unknown address answered 200.

Rate limited to 5/min, so a slow oracle rather than a dump — but unauthenticated,
and the controller's own summary reads *"response never reveals account
existence"*.

**Nothing in this repository could have caught it.** No unit test sends mail, no
CI job has a transport, and the failure needs a live Resend key on an unverified
domain. It is the strongest argument in this document for the E2E layer §6 item
15 still describes as unbuilt.

### Nothing else is currently broken in CI

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
| ~~**Notifications**~~ — `GET /notifications`, mark-read, bell in the topbar, 30 s polling | `03:119-120`, `05:10`, `08:23`, `09:34` | ✅ **Built.** The table this audit called dead now has a module, four routes and a bell. In-app only — **email notifications are still absent**, and so is the event fan-out: senders call `notify()` directly, because `@nestjs/event-emitter` is still not a dependency. |
| **All four scheduled jobs** — `attendance.day-close`, `leave.year-end`, `auth.session-prune`, `announcement.expire` | `08:61-70` | **Verified absent.** `@nestjs/schedule` is not a dependency. Zero `@Cron` decorators. |
| **Domain events / `EventEmitter2`, `events.ts` per module** | `08:36`, `08:53-59` | **Verified absent.** `@nestjs/event-emitter` is not a dependency. |
| ~~**Frontend tests**~~ | `09:60-66`; a sprint-exit criterion five times in `11` | ✅ **Started.** Vitest + Testing Library wired into turbo; the api client and the two newest screens are covered. **Playwright and the five golden flows are still absent** — they need a seeded database and a running API that CI cannot provide. |
| ~~**Session management**~~ | `03:26`, `07:41`, `05:66` | ✅ **Built.** `GET /auth/sessions`, `DELETE /auth/sessions/:id` and `/profile/sessions`, linked from the avatar menu. |
| ~~**Offboarding**~~ | `03:46`, `05:64`, `12:118-120` | ✅ **Built.** `POST /employees/:id/offboard` plus the screen-12 dialog. Retires the dead `employee.offboard` permission and gives `EmployeeStatus.ON_NOTICE` its first meaning. |
| ~~**Org chart**~~ | `03:36`, `05:72` | ✅ **Built.** `GET /organization/chart` plus screen 16. Somebody whose manager has left becomes a root rather than vanishing from the tree. |
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
| ~~`leave_approved`, `leave_rejected` emails~~ | `leave-requests.service.ts:145` | ✅ **Sent**, from `announceDecision()`, and tested. This row said "no sender; approving leave notifies nobody" for as long as there was one. |
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
| ~~`Notification`~~ | `schema.prisma:643` | ✅ **Alive.** Written by `NotificationsService`, read by the header bell. |
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

**~~Notifications.~~** ✅ **Built**, after being retracted once. Docs 03 and 05
carry it again and doc 02 no longer calls the table dead. In-app only: a bell,
an unread count and mark-read. Email and a general event fan-out remain
unbuilt, and `@nestjs/event-emitter` is still not a dependency — senders call
`notify()` directly.

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
| ~~**Recruitment / ATS**~~ ✅ built, internal · ~~**public careers page**~~ ✅ **also built** — `/careers` and `/careers/:slug`, the product's first unauthenticated write surface | ⚠️ | ✅ all four |
| ~~**Performance / goals / OKR**~~ ✅ built — weighted goals, review cycles that enrol, self then manager assessment, shared and signed off · **no 360°, calibration, competency frameworks or nine-box, and a rating feeds no increment** | ⚠️ | ✅ all four |
| ~~**Expense & reimbursement**~~ ✅ built — categories, multi-line claims, receipts, approval, and an approved claim becoming a payslip line · **no mileage rates, per-diems, corporate cards or multi-currency** | ⚠️ | ✅ all four |
| ~~**Asset management**~~ ✅ built — per-item register, issue/return history, exit clearance computed from it · **no depreciation, procurement or vendors** | ⚠️ | ✅ Keka, Darwinbox |
| ~~**Exit / offboarding**~~ ✅ built, ~~FNF~~ ✅ **too** — encashment, notice recovery, gratuity · **settlement tax still entered by hand** | ⚠️ | ✅ all four |
| ~~**Helpdesk / ticketing**~~ ✅ built — tickets, a two-sided thread with internal notes, a queue and per-desk routing · **no attachments, SLAs, ticket numbers or email-in** | ⚠️ | ✅ Zoho, Darwinbox |
| ~~**Projects & timesheets**~~ ✅ built — a project register, staffing with allocation and membership windows, a weekly grid, manager approval, and utilisation · **no cost or billing rates, no client, no tasks or board, no capacity forecasting, and no reconciliation against attendance** | ⚠️ | ✅ Keka, Zoho |
| **Engagement / surveys** | ❌ | ✅ Darwinbox, Keka |
| ~~**Org chart**~~ | ✅ | ✅ all four |
| **Mobile app** | ❌ — and **not planned**; dropped from the roadmap rather than deferred | ✅ all four |
| ~~**Notifications**~~ ✅ built — in-app **and** email, three transports, per-user preference · **no digests, batching or domain events** | ⚠️ | ✅ all four |
| ~~**Bulk import / export**~~ ✅ built — employees only; no bulk salary or attendance upload | ✅ all four |
| Multi-entity payroll | ❌ (schema is org-scoped and ready) | ✅ Keka, greytHR |

### Found by the end-to-end suite

Worth recording separately, because these are the return on building that layer
and none of them was reachable from a unit test.

| Defect | How it surfaced |
|---|---|
| **An announcement could not be posted from the UI at all.** `publishAt` defaulted to `''` — what an untouched `datetime-local` holds, and what the field's own hint ("Leave empty to post now") tells you to leave it as — and the schema rejected it, so the resolver blocked submit and Publish did nothing. Never noticed because the seed writes announcements through Prisma and never touches the schema | 55 announcement requests in the run and **not one POST** |
| **`/auth/refresh` was limited like a password form.** The client fires it on every bootstrap, so five a minute signed people out for reloading too often | 18 attempts, 9 refused |
| **`TRUST_PROXY` unset in production.** `req.ip` was Render's proxy, so rate limits were a handful of shared buckets rather than per-client, and `AuditLog.ip` recorded infrastructure | every address in the live audit log was a private `10.x` |
| **…and setting it to `1` did not fix it.** Render fronts services with Cloudflare, so `X-Forwarded-For` carries **three** hops; Express takes the *(n+1)th from the right*, so `1` lands on the Render internal address. Wants `2` | the audit log kept recording `10.x` after the change — which reads as "never took effect", and was not that. Counted from the real header rather than assumed |
| **Every 500 was unattributable.** The exception filter turned an unknown throw into "Something went wrong" and logged nothing | a real 500 in CI could not be read from its own logs |
| **`clock-card` vanished on any error**, the only component in the app that did, so a failed load looked identical to "you have no clock card" | three rounds chasing a selector that was correct |

The pattern is worth stating: every one is a **cross-boundary** failure — a
client default meeting a server schema, a limit meeting a client's own call
pattern, a proxy meeting a request. That is the class of bug a mocked-Prisma
unit test cannot see by construction, and it is the argument for the layer.

### Found by running a real import against the dev database

Neither of these is reachable from the unit tests, and both were visible in the
first preview response of the first real file. Workstream C had 26 parser tests
and a full service spec and had never once been pointed at a database.

| Defect | How it surfaced |
|---|---|
| **Every suggestion was lower-cased.** Matching normalises to a key, and `nearestName` returned *the key* — so the preview offered `Did you mean "engineering"?`, `"bengaluru studio"`, `"senior software engineer"`. A suggestion exists to be copied back into the file; none of those is what the record is called | read the preview response against the seeded org. The unit tests asserted the lower-cased string, and one used `/i` — they agreed with the defect rather than catching it |
| **Every bad column was reported twice.** The two staging passes see the same failure from opposite ends: the resolver says `No department called "Enginering". Did you mean…`, then the schema finds `departmentId` absent and adds `Department is required` | a three-row file produced 10 and 12 problems; a blank employment type produced the identical sentence twice. The existing assertion only ever read `problems[0]` |

What *did* hold up, against a real database: the fuzzy resolver caught all four
near misses in one file, the deferred manager link resolved a manager who
appeared **later** in the file (`EMP-0029` → `EMP-0030`), codes allocated
sequentially, `joinDate` landed on IST midnight, and both refusals fired — a
second commit and a commit with unresolved rows.

### Open — Finance cannot open the receipt on a claim it is approving

Found while designing the helpdesk, by looking for a pattern to copy for
attachments and finding one that does not work.

An expense receipt is an ordinary `Document` on the claimant, and reading one
goes through `DocumentsService.openFile` → `ensureEmployeeAccess`
(`documents.service.ts:238`), which allows `document.read`, self with
`document.read.own`, or a direct report with `document.read.team`.

`FINANCE_PERMS` spreads `EMPLOYEE_PERMS` — which carries only
`document.read.own` — plus `expense.read`, `expense.approve` and
`expense.manage`. A receipt belongs to the claimant, so `isSelf` is false and
Finance gets a **403 on the one document its role exists to look at**.

Verified by reading both files rather than by running it, so the failing call
has not been executed — but the three inputs are not ambiguous.

Not fixed here: it means editing `DocumentsService`, and `docs/11-roadmap.md:70`
says a design that needs to reach into another module's internals wants an ADR
first. The fix is a decision about whose permission governs an attachment, not
a one-line grant — adding `document.read` to Finance would hand it every
document in the company to solve a receipt.

It is also why the helpdesk defers attachments rather than copying this shape.

### Fixed — `AuditLog.ip` was only ever written by the auth path

Found while checking whether `TRUST_PROXY` had taken effect, by reading the live
table rather than the code. Sign-ins carried an address; **every other mutation
carried `NULL`** — 18 of the last 200 rows, including
`payroll.filing.generate` (an action that existed at the time), `employee.update` and `settings.update`.

The cause was that `auditMutation` (`common/utils/audit.ts`) takes
`{ orgId, userId }` and had no `ip` parameter at all. That context is the
decoded JWT, which is the right thing for *who* and the wrong place for *where
from* — a token payload cannot know the request's address.

**Resolved without touching the 164 call sites.** A `requestContextMiddleware`
registered on `AppModule` opens an `AsyncLocalStorage` store holding the
client address for the life of each request, and `auditMutation` reads it.
`ctx.ip` still wins when a caller passes one, so it is a default rather than a
hijack, and outside a request — seeder, CLI, lifecycle tick — the value is
`null`, which is the truth.

Two things came out of the fix worth recording. `auditOrgMutation`
(`organization/services/audit.helper.ts`) kept a **second copy of the same
insert**, so every department, designation, location, shift and holiday change
would have carried on writing `NULL`; it now delegates. And the auth path keeps
a **third** insert of its own, deliberately: a sign-in event holds the request
already and its `entityId` is nullable in a way the shared signature is not.

The ambient-state trade is real and is argued in the header of
`common/request-context.ts`. It is bounded by what the store may hold — facts
about the request, never capabilities — so nothing can grant itself permissions
through it.

### Statutory filing — removed from scope (2026-08-20)

The engine computes PF, ESI and PT correctly, and the rates come from settings
rather than constants. **Producing filing artefacts is no longer this product's
job**: the Returns feature — EPFO ECR, ESIC return, the TDS challan register
and Form 24Q — was removed on 2026-08-20, along with the `payroll.filing`
permission, the `statutory` settings group and the three tables behind it. The
24Q generator had never produced a usable file (its FVU layout was never
transcribed). What stays: the six payroll reports (PF / ESI / PT / register /
bank-transfer / tax), and the full monthly TDS pipeline — regime choice,
declarations, slab editing, projection and the payslip deduction.

Still absent, and now explicitly out of scope unless the decision is revisited:
Form 16, Form 12BB artefact, gratuity register, Payment of Bonus Act, LWF.

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

13. ~~**Org chart**~~ ✅ — collapsible tree at `/organization/chart`.
14. ~~**Frontend tests**~~ ✅ — Vitest + Testing Library, wired into turbo so CI
    gates on them.

**Still open:**

15. ~~Playwright and the five golden flows~~ ✅ **built**, and this item was
    wrong about the blocker. It named "a Postgres service container" — `ci.yml`
    had one all along. What was actually missing was narrower: nothing ever
    applied migrations to it (the drift check only populates a *shadow*
    database, so `hrms` held an empty schema at the end of every run), nothing
    seeded, nothing started either server, and Playwright was not installed.

    CI is now five jobs: `check` (no database, gates the rest), `integration`,
    `migration-drift`, and `e2e` — the last gated to `master` or a PR labelled
    `e2e`, exactly as `10:59` specified before it existed.

    **Two layers, not one, and the reason is this document's own §1.** A
    Playwright spec would *not* have caught the password-reset enumeration bug,
    even aimed straight at it: the failure needs a mail transport that throws,
    and with no API key the transport is `LogTransport`, which never does. Both
    addresses answer 200 and the spec passes. So the regression test is a
    Supertest one that injects a refusing transport and asserts the two
    responses are byte-identical — `apps/api/test/auth.e2e-spec.ts`. The general
    rule, worth applying to anything that promises indistinguishability: assert
    the **equality of two responses under an injected failure**, not the success
    of one.

    Also added: a `FileTransport` behind `MAIL_OUTBOX_DIR`, so the invite flow
    asserts on a real link instead of scraping a pino log; a positive
    "is this the throwaway" database guard that refuses anything hosted, with
    the actual production URL as one of its test cases; and `dependabot.yml`.

    **Not done**: the coverage gate. A global 80% threshold would fail on the
    commit that adds it — organization, audit and six of the eleven payroll
    services have no spec at all — and a gate disabled the day it lands teaches
    everyone to
    disable gates. Lighthouse is deferred for the same reason it always is: its
    own flake profile.
16. ~~**`leave_approved` / `leave_rejected` emails**~~ ✅ **built** —
    `leave-requests.service.ts:145` calls `mail.sendTemplate` from
    `announceDecision()`, pinned by `leave-requests.notify.spec.ts`.

    This item stayed open in writing long after it was closed in code, which is
    the same failure this document exists to catch, committed by the document
    itself. Email generally is built too: a mail module with three transports
    (log, Resend, and a file outbox gated on `MAIL_OUTBOX_DIR` and checked
    *before* the API key, so a test harness cannot send real mail), and a
    general fan-out in `notifications.service.ts` that emails
    `notification_generic` on every `notify()` unless the caller passes
    `{ email: false }`.

    **Still genuinely absent**: `@nestjs/event-emitter` — senders call
    `notify()` directly — digests or batching, and per-event templates beyond
    the five keys in `email-templates.ts`.

### P2 — market table stakes

15. ~~Exit & offboarding~~ ✅ **built** — resignation workflow, notice periods,
    probation lifecycle, an `Offboarding` record for every way of leaving, and a
    daily check that needs no scheduler. ~~Full-and-final settlement is still
    absent~~ ✅ **also built**: leave encashment, notice recovery and gratuity,
    every figure overridable, on its own `Settlement` entity rather than a
    `PayrollRun`. **Tax on a settlement is still entered by hand** — the system
    projects tax nowhere, and a settlement is not where a tax engine should
    first appear.
16. ~~Expense & reimbursement~~ ✅ **built** — three tables, one enum, seven
    permission codes, thirteen routes and four screens. The payslip end already
    existed: `PayComponent.taxable` carried the note "Reimbursements and
    employer contributions do not", and `PayrollAdjustment` was already keyed
    (employee, month, component), so an approved claim becomes a payroll row and
    the calculation engine needed no change at all.

    Three things worth recording:

    - **No `PAID` state.** Whether the money arrived is whether the payroll run
      for the claim's month was published, which payroll already knows, so it is
      derived on read. A stored copy is the one that goes stale — the same
      bargain attendance's day-close and announcement expiry make.
    - **One approval stage**, not manager-then-finance. Leave, WFH and
      resignation are all single-stage; a second would be two more states and
      two more checks for no asked-for gain.
    - **`isRunEditable()` finally has a caller.** It is listed above under
      "implemented, zero callers outside their own specs" — approving a claim
      into a locked month is what now reaches it, through
      `PayrollAdjustmentsService`.

    **Not built**: mileage rates, per-diems, corporate-card feeds, multi-currency,
    and any advance-against-expenses flow.
17. ~~WFH / hybrid working~~ ✅ **built** — remote-day requests with a weekly
    cap, an org default and a per-employee allowance. **Nothing is enforced at
    clock-in**: a remote day nobody approved is still recorded, and flagged on
    read, because refusing the punch would lose the record of a day worked.
18. ~~Performance / goals / OKR~~ ✅ **built** — review cycles that enrol
    everybody eligible, weighted goals, a self-assessment then a manager
    assessment, shared and signed off. Three tables, three enums, seven
    permission codes, twenty routes and four screens, and the module imports
    nothing at all.

    Two things worth knowing. The roadmap predicted it would reuse
    `ApprovalStatus` and it does not — a review is never approved or rejected,
    and widening the shared enum would have made `SHARED` representable on every
    leave request in the product (`11:62` now records why). And its migration
    **grants its own permissions**, which `20260807070000_expenses` did not —
    that omission is why the admin account could not see Expenses in the sidebar
    and why a destructive re-seed was the only fix available.

    **Not built**: 360°/peer feedback, calibration, competency frameworks,
    nine-box, and any link from a rating to a pay increment. The last is the
    deliberate one — an increment is an effective-dated `EmployeeSalary`
    revision gated by `payroll.salary.manage`, and wiring a rating into it would
    be this module writing salary.
19. ~~Asset management~~ ✅ **built** — a per-item register with issue/return
    history, and the exit checklist's "return company assets" line is now
    computed from it rather than ticked. **No depreciation, procurement or
    vendor management**: this is an asset register, not a fixed-asset ledger.
20. ~~Bulk employee import/export~~ ✅ **built** — `GET /employees/export`
    (CSV or Excel, behind `report.export` as well as `employee.read`, because
    "may read an employee" and "may walk out with the dataset" are different
    permissions), and a three-step import: `GET import/template`,
    `POST import/preview`, `POST import/:id/commit`.

    The preview is the feature. A commit is **refused unless its preview is
    clean**, so a half-imported file is not a state the system can reach, and
    unresolved references are matched by name — containment first, then
    Levenshtein within `max(2, len/3)` — and shown for confirmation rather than
    guessed at silently. Rows are created **sequentially, never
    `Promise.all`**: `nextCode()` has no retry, and concurrent inserts race it.

    Leading `=`, `+`, `-` and `@` are stripped on export, so a cell cannot
    become a formula when the file is opened in Excel.
21. ~~Notifications~~ ✅ **built** — in-app, with a bell that polls. P0 #4
    resolved toward building after all. **Email notifications remain absent**,
    so a resignation moving through approval reaches nobody who does not open
    the app.
22. **Form 16, Form 24Q, ECR, ESIC challan** — ~~half built~~ **removed on
    2026-08-20**. The Returns tab, the TDS challan register, the 24Q generator
    and the ECR/ESIC builders were deleted by the scope decision recorded
    above: this product deducts monthly TDS and reports payroll figures; it
    does not generate government return files. Form 16 remains absent, now by
    the same decision rather than by omission.

### P3 — differentiators, once the above is settled

23. ~~Recruitment / ATS~~ ✅ **built** — openings, candidates, applications,
    interviews and offers, with the hire converting through the existing
    onboarding invite. ~~The public careers page remains absent~~ ✅ **also
    built**: `/careers` and `/careers/:slug`, with an apply form that accepts a
    CV. It is the product's first unauthenticated write surface, so most of the
    work was refusals rather than features — a mapper that never spreads an
    opening, 404 for closed and unpublished alike, the same success reported to
    a repeat applicant, 5 posts a minute per IP, and a CV checked on both its
    content type and its extension.

    `JobOpening.slug` is nullable, and that is the safety story: every opening
    that predates this gets NULL and stays unpublished. **Not built**: a careers
    page per organization — the service serves the single tenant and says so
    plainly if a second appears.
24. ~~Helpdesk~~ ✅ **built** — three tables, five permission codes, eighteen
    routes and four screens. A ticket, a thread carrying public replies,
    internal notes and system entries, and desks that route by a single named
    default assignee.

    Two decisions worth keeping visible. There is **no `helpdesk.read.team`**:
    a ticket is bilateral, and where it is a grievance or a payslip query the
    manager it concerns is exactly who must not read it by default. And
    `helpdesk.respond` grants **the queue**, not org-wide reading — otherwise
    "may work the desk" and "may read every grievance in the company" become
    one grant.

    **Not built**: attachments (see below), SLAs and escalation — there is no
    scheduler, so a stored due date goes stale overnight — ticket numbers,
    email-in, per-category custom fields, routing rules, tags, watchers, merge,
    CSAT, and a knowledge base.

    Attachments are the one people will ask for first. The shape when it lands
    is a `TicketAttachment` table with its own upload and stream routes gated
    on the ticket's own readability, **not** a reuse of `Document` — see the
    Finance/receipt defect below, which is what reusing it would reproduce.
25. ~~Projects and timesheets~~ ✅ **built** — four tables, eight permission
    codes, seventeen routes and five screens. Two decisions worth keeping
    visible.

    The first is an **ownership grant**, which nothing else in the product has:
    a project's own manager may staff it without `project.manage`, checked in
    the service against `project.managerId` rather than by the guard. A
    permission for "may staff the projects I run" would have to be granted per
    person to mean anything, which is not a permission — it is a row. The grant
    stops at delete, because deleting the register entry is not staffing.

    The second is that **saving a week and submitting it enforce different
    rules**. `PUT` refuses only what would corrupt the row; membership windows,
    closed projects and a 30-hour Tuesday are `submit`'s question. A draft is a
    scratchpad, and being blocked mid-thought is how people stop filling one in.

    **Not built**: cost rates, billing rates, billable-vs-non-billable, a client
    entity, tasks or a board, capacity forecasting, and any reconciliation
    against attendance — the last deliberately, since a week rejected because
    somebody forgot to clock out is worse than the gap.
26. Engagement surveys
27. Multi-tenant self-signup (`11:66` — `organizationId` scoping is already there)

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
