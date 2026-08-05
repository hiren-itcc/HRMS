# 5 — API Structure

Base URL: `/api/v1` (versioned from day one). OpenAPI served at `/api/docs` (Swagger UI, non-production only unless authenticated).

## Conventions

- **Auth:** `Authorization: Bearer <access-token>` on every route except `auth/*` public endpoints. Refresh token travels only as an httpOnly cookie (web) or request body (future mobile).
- **Permissions:** each route declares `@RequirePermissions('resource.action')` (doc 04). "Self" endpoints (`/me/...`) bypass the matrix — they are scoped by the JWT subject.
- **Envelope:** success returns the resource directly; errors return RFC-7807-style `{ statusCode, error, message, details? }`. No `{ success: true }` wrappers.
- **Lists:** `?page=&limit=&sort=&order=&search=` + module-specific filters. Response: `{ data: T[], meta: { page, limit, total } }`.
- **Dates:** ISO-8601 UTC in transport; date-only fields as `YYYY-MM-DD`.
- **Idempotency:** check-in/out and approval actions are idempotent (repeating returns current state, not an error). Repeating means *while nothing has changed* — clocking in again after a clock-out opens a new session rather than returning the old one.

## Endpoints by module

### Auth (`/auth`) — public unless noted
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Email + password → access token + refresh cookie |
| POST | `/auth/refresh` | Rotate refresh token → new pair |
| POST | `/auth/logout` | Revoke current session (authed) |
| POST | `/auth/forgot-password` | Send reset email (always 200) |
| POST | `/auth/reset-password` | Token + new password |
| GET | `/auth/invite/:token` | Is this invitation still usable, and whose is it? |
| POST | `/auth/accept-invite` | Invite token + password → activates user |
| POST | `/auth/change-password` | Returns a **fresh** access token — the old one still asserts `mustChangePassword` (authed) |
| GET | `/auth/me` | Current user + role + permissions + employee summary (authed) |
| GET | `/auth/sessions` · DELETE `/auth/sessions/:id` | List / revoke own sessions (authed) |

Sessions carry no permission: the subject comes from the JWT and is never read
from a parameter, so another user's session id matches nothing. They sit under
`/auth` rather than `/me` because the refresh cookie is scoped to
`Path=/api/v1/auth` — anywhere else the browser would not send it, and the list
could not mark which device you are reading it on. Revoking your own session is
allowed and clears the cookie with it.

### Organization (`/organization`)
| Method | Path |
|---|---|
| GET / PATCH | `/organization` — profile, timezone, logo |
| GET / POST | `/organization/departments` · GET/PATCH/DELETE `/organization/departments/:id` |
| GET / POST | `/organization/designations` · PATCH/DELETE `/organization/designations/:id` |
| GET / POST | `/organization/locations` · PATCH/DELETE `/organization/locations/:id` |
| GET / POST | `/organization/holidays` · PATCH/DELETE `/organization/holidays/:id` |
| GET | `/organization/chart` — reporting tree, work contact facts only; `org.read` |

### Employees (`/employees`)
| Method | Path |
|---|---|
| GET | `/employees` — list (filters: department, location, status, type, search) |
| GET | `/employees/options` — id + label pairs for pickers |
| POST | `/employees` — create record; `createLogin` (default true) and `loginRole` decide whether a sign-in comes with it (doc 07) |
| GET / PATCH | `/employees/:id` |
| PATCH | `/employees/:id/role` — change the role on their login; `role.manage` |
| PUT | `/employees/:id/bank` — bank details; `employee.update` |
| DELETE | `/employees/:id` — soft delete (Admin only) |
| GET / PATCH | `/me/profile` — self view/edit of editable subset (phone, personal email, address) |

| POST | `/employees/:id/offboard` — put on notice, mark exited, or withdraw a resignation; `employee.offboard` |
| POST | `/employees/:id/confirm` — off probation; `employee.confirm` |
| POST | `/employees/:id/extend-probation` — push the end date back, with a reason; `employee.confirm` |
| GET | `/employees/:id/activity` — employment history, from the audit trail |

**Offboarding is not deletion.** `DELETE` archives a record that should not have
existed; offboarding records that somebody left, and keeps everything. Only
`EXITED` touches the sign-in (suspended, sessions revoked) — `ON_NOTICE` leaves
it alone, because somebody working their notice is still an employee.
`ACTIVE` withdraws a resignation and revives a login **only** from `SUSPENDED`,
never from `INVITED`.

### Notifications (`/notifications`)

| Method | Path |
|---|---|
| GET | `/notifications` · `/notifications/unread-count` |
| POST | `/notifications/:id/read` · `/notifications/read-all` |

**No permission on any route**, and no endpoint that creates one. Every route is
scoped to the JWT subject and never reads whose data it is from a parameter —
the same rule `/auth/sessions` and `/me/profile` follow. A permission here
would be weaker: it would be something an administrator could grant one person
over another's notifications. A notification is a consequence of something else
happening, never a thing anybody posts.

Retention is a 90-day query bound rather than a pruning job, for the same reason
the lifecycle tick hangs off a request: there is no scheduler.

### Exits (`/resignations`, `/offboardings`, `/lifecycle`)

| Method | Path |
|---|---|
| GET | `/resignations/me` · `/resignations/me/eligibility` — own requests, and the notice owed |
| POST | `/resignations` — file one for yourself; `resignation.request.own` |
| PATCH | `/resignations/:id` · POST `/resignations/:id/withdraw` — own, while it is still with you |
| GET | `/resignations` — org-wide or direct reports; `resignation.read` or `.read.team` |
| GET | `/resignations/:id` · `/resignations/:id/activity` |
| POST | `/resignations/:id/decision` — approve, reject or send back; `resignation.approve` or `.approve.team` |
| GET / POST | `/offboardings` — everyone leaving; start a termination or contract end; `employee.offboard` |
| GET / PATCH | `/offboardings/:id` — detail; move the last working date |
| POST | `/offboardings/:id/complete` · `/offboardings/:id/cancel` |
| PATCH | `/offboardings/tasks/:taskId` — sign a clearance item off, waive it, reopen it; `offboarding.clearance` |
| GET / PUT | `/offboardings/:id/interview` — the exit conversation; `employee.offboard` only |
| GET | `/offboardings/:id/activity` — the trail for this exit |
| GET | `/lifecycle/stats` — dashboard counts, each null when the caller may not see it |
| GET / POST | `/lifecycle/status` · `/lifecycle/run`; `settings.manage` |

**Completion is gated on clearance.** `complete` refuses while any *required*
`OffboardingTask` is still `PENDING`, and names them. That one rule is
"employees cannot complete an exit until required assets are returned" —
generic, so it also covers the handover and the outstanding dues.

**`offboarding.clearance` is not `employee.offboard`.** Finance and Managers
sign items off without being able to schedule or complete anybody's exit. Which
exit a Manager may touch is a question the guard cannot answer, so the service
checks they are that employee's manager. `IT_ADMIN` items fall to
`employee.offboard` holders until an IT role exists.

**The exit interview is HR-only**, and deliberately not readable by the
leaver's own manager — who is very often the subject of the answers.

**Two entry points, one exit.** An employee resigning and HR recording a
termination both produce an `Offboarding`; only the first has a `Resignation`
behind it. Neither writes `Employee.status` or `exitDate` — both go through
`EmploymentTransitionService`, which is also what `POST /employees/:id/offboard`
has always used. There is exactly one place employment state changes.

**One decision endpoint, not three.** Which desk a caller is acting from comes
from the record's own status and routing, never from the request body.

**`/lifecycle/run` is idempotent** and carries no scheduler. The tick fires at
most once a day off `GET /auth/me`, because the instance sleeps and a timer
that silently does not fire is worse than none — see docs/08.

`exitDate` is the mechanism; `status` is the label. Attendance, payroll and
reports all filter on the date, which is why an employee who leaves mid-month
still gets their final part-month payslip.

`PATCH /me/profile` takes **`emergencyContacts` as a replace-all array**, capped
at five. Omitting the key leaves the existing rows alone — a patch that only
changes a phone number must not wipe somebody's next of kin. Sending `[]` clears
them. The replace runs in a transaction, so there is no window where a person
has no emergency contact at all. They are returned on the employee detail
response too: an emergency contact only HR can reach is no use on the day it is
needed.

**Not built:** `GET /employees/:id/reports` was specified here and never
implemented — direct reports come back on the employee detail response
([15-feature-audit.md](./15-feature-audit.md)).

### Onboarding (`/employees/onboard`, `/onboarding`, `/me/onboarding`)

Invite a new hire, let them fill in their own details, and have HR review it
before the account works. The alternative to creating them on a shared default
password — doc 07 covers when to use which.

**HR side**

| Method | Path |
|---|---|
| POST | `/employees/onboard` — create the hire + an INVITED login, mint a token, email the hire's *personal* address; `employee.create` **and** `employee.invite` |
| GET / POST | `/employees/:id/invite` — read invite state / resend, revoking the outstanding link |
| GET | `/onboarding` — review queue, filterable by status |
| GET | `/onboarding/:id` — one submission with its documents |
| POST | `/onboarding/:id/approve` — validate deferred job fields, flip the employee to ACTIVE, revoke sessions so the stale `onboarding` claim dies; `employee.onboarding.approve` |
| POST | `/onboarding/:id/request-changes` — send it back with a note; same permission |

**Hire side** — all carry `@AllowDuringOnboarding()`, because `OnboardingGuard`
otherwise refuses every route to an account in this state.

| Method | Path |
|---|---|
| GET | `/me/onboarding` — checklist and current state |
| PATCH | `/me/onboarding/profile` |
| PUT | `/me/onboarding/bank` |
| POST | `/me/onboarding/documents` — upload against a checklist item |
| POST | `/me/onboarding/submit` — hand to HR |

`Onboarding.status` runs `IN_PROGRESS → SUBMITTED → APPROVED`, with
request-changes returning it to `IN_PROGRESS`. Submit and both review actions
use optimistic `updateMany` guards, so two reviewers acting at once cannot both
win. The employee sits at `EmployeeStatus.ONBOARDING` until approval and the
user at `INVITED`, which `login()` refuses — the account gates itself.

### Directory (`/directory`)

Separate from `/employees` on purpose: that serves the HR record behind
`employee.read`, this serves work contact details to everyone. The response is a
hard-coded column whitelist rather than the employee row, so a column added to
the table later cannot be published to the company by accident.

| Method | Path |
|---|---|
| GET | `/directory` — current colleagues (filters: department, location, search) |
| GET | `/directory/:id` — work profile: job title, department, work email/phone, location, manager |

### Attendance (`/attendance`)
| Method | Path |
|---|---|
| POST | `/attendance/check-in` — self; opens a session. Body `{ latitude, longitude, accuracyMeters }` **or** `{ locationUnavailable: true }` — one or the other is required, and the work mode is derived from the position, never sent |
| POST | `/attendance/check-out` — self; closes it. Same body rules |
| GET | `/attendance/today` — self, current day state |
| GET | `/me/attendance?from=&to=` — self history |
| GET | `/attendance?date=&departmentId=` — team/org view (permission-scoped: manager sees reports, HR sees all) |
| POST | `/attendance/requests` — regularization request (self) |
| GET | `/attendance/requests?status=` — inbox (approver) / own (employee) |
| POST | `/attendance/requests/:id/approve` · `/reject` · `/cancel` |
| GET / POST | `/attendance/shifts` · PATCH/DELETE `/attendance/shifts/:id` |

### Leave (`/leave`)
| Method | Path |
|---|---|
| GET / POST | `/leave/types` · PATCH/DELETE `/leave/types/:id` |
| GET | `/me/leave/balances` — self balances for current year |
| GET | `/leave/balances?employeeId=&year=` — HR view; POST `/leave/balances/adjust` (manual adjustment, audited) |
| POST | `/leave/requests` — apply (validates balance + overlaps + holidays) |
| GET | `/leave/requests?status=&employeeId=` — own / inbox / HR-all by permission |
| POST | `/leave/requests/:id/approve` · `/reject` · `/cancel` |
| GET | `/leave/calendar?month=` — who's out (team/org scoped) |

### Documents (`/documents`)
| Method | Path |
|---|---|
| GET / POST | `/documents/categories` · PATCH/DELETE `/documents/categories/:id` |
| POST | `/documents` — multipart upload (max size from settings) |
| GET | `/documents?employeeId=&categoryId=&search=` — **org-wide, `document.read`.** The HR list across every employee, paginated. Per-employee reads stay on `/employees/:id/documents`, where the scope depends on *which* employee and so has to be settled in the service |
| GET | `/documents/:id/download` — permission check → 302 to signed URL |
| DELETE | `/documents/:id` — soft delete |

### Letters (`/letters`)

Generated employment letters. An issued letter is **frozen** — the rendered
HTML is stored, never re-rendered — so editing a template afterwards cannot
rewrite a letter someone is already holding.

| Method | Path | Permission |
|---|---|---|
| GET | `/letters/templates` · PUT/DELETE `/letters/templates/:key` — edit / reset to the shipped default | `letter.template.manage` |
| GET | `/letters/preview?employeeId=&templateKey=` — renders, persists nothing, returns `blockers[]` | `letter.issue` |
| POST | `/letters` — `{ employeeId, templateKey }`; renders and freezes. No client-supplied body | `letter.issue` |
| GET | `/me/letters` | `letter.read.own` |
| GET | `/employees/:employeeId/letters` | service: own, or `letter.read` |
| GET | `/letters/:id` | service: own, or `letter.read` (+ `payroll.read` when it quotes pay) |
| POST | `/letters/:id/void` — withdraws with a reason; never deletes | `letter.issue` |

### Dashboard (`/dashboard`)

| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard/summary` | any signed-in user |

**No `@RequirePermissions` on the route, deliberately.** Every signed-in person
has a dashboard, and what they may see differs field by field rather than route
by route — a permission here would be either too strict to let an employee load
the page or too loose to mean anything. **Every figure is `null` when the caller
may not see it**, so a tile checks for null rather than for a permission and the
page cannot drift from the API's answer. A zero would be a lie: it reads as
"nothing is waiting on you" when the truth is "you may not know".

This module reads other modules' tables through Prisma directly, which is what
`SettlementsService` and `AssetClearanceService` already do. The screen's
question — "is anything waiting on me?" — is not any one domain's.

**`/lifecycle/stats` was deleted, not kept alongside.** It had exactly one
consumer, this page, so it was never an API anybody depended on; it was this
screen's backend under a name that stopped being true once the figures stopped
being about lifecycle.

**Exits are one figure and the headline is not a sum.** Somebody serving notice
almost always has an offboarding open too, so adding the three would count most
people twice — and a pending resignation is somebody who has *asked*, not
somebody who is leaving.

**A birthday's year never leaves the API.** `monthDay` is `"MM-DD"`, so age
cannot be read off the response even by somebody looking at the network tab.
Anniversaries carry `years`, because that is the substance of one. Celebrations
are gated on `directory.read`, which every seeded role holds.

`attendance/stats` also gained `remote` and `remoteUnplanned` — the second is
what puts the unapproved-remote-day flag somewhere a manager meets it without
opening the day view.

### Work from home (`/wfh`)

| Method | Path | Permission |
|---|---|---|
| GET | `/wfh/preview?startDate=&endDate=` — working days, and any week it would fill | `wfh.request.own` |
| GET | `/wfh/me` | `wfh.read.own` |
| GET | `/wfh` — `scope=own\|inbox\|all` | `wfh.read` \| `.read.team` \| `.approve.team` |
| GET | `/wfh/:id` | read scope on the record |
| POST | `/wfh` — ask for a range | `wfh.request.own` |
| PATCH | `/wfh/:id` — own, while still pending | `wfh.request.own` |
| POST | `/wfh/:id/cancel` — own; approved days still to come | `wfh.request.own` \| `wfh.approve` |
| POST | `/wfh/:id/approve` · `/wfh/:id/reject` | `wfh.approve` \| `.approve.team` |

Mirrors `leave.controller.ts` route for route: an employee asks, their manager
agrees, and the record is what somebody points at afterwards. Which requests a
`.team` holder may act on comes from `Employee.managerId` in the service, never
from a query parameter.

**Attendance asks this module exactly one question**, through
`approvedDaysIn(orgId, employeeIds, from, to)`: which employee-days were agreed,
as a set, for a range it is already fetching. `monthFor` and `dayView` each call
it once and mark any `WFH` day that is missing. The dependency runs
`Attendance → WFH` only — WFH never asks whether somebody actually worked from
home, which keeps a permission out of every clock-in.

**Nothing is enforced at the punch.** A remote day nobody approved is recorded
exactly as before and flagged on read. Refusing the clock-in would lose the
record of a day somebody worked, and a burst pipe at 7am is not a policy
violation the software should adjudicate.

**The cap is per week, and re-checked at approval.** Two requests can each pass
on the way in and only collide once one is approved, because the first decision
is what makes those days real. Refusals name the week and the count.

### Assets (`/assets`)

| Method | Path | Permission |
|---|---|---|
| GET | `/assets` — register; filter category/status, search tag/serial/name | `asset.read` |
| GET | `/assets/me` — what I am holding | `asset.read.own` |
| GET / POST | `/assets/categories` · PATCH/DELETE `/assets/categories/:id` | `asset.read` / `asset.manage` |
| GET | `/assets/employee/:employeeId` — what one person still holds | `asset.read` |
| GET | `/assets/:id` · `/assets/:id/activity` | `asset.read` |
| POST / PATCH | `/assets` · `/assets/:id` | `asset.manage` |
| DELETE | `/assets/:id` — refused once anybody has held it | `asset.manage` |
| POST | `/assets/:id/issue` · `/assets/:id/return` | `asset.assign` |
| POST | `/assets/:id/status` — IN_REPAIR / LOST / RETIRED, with a reason | `asset.manage` |

**`asset.assign` is not `asset.manage`.** Buying and retiring equipment is an
admin job; handing a laptop to a joiner is not. Same split, and the same
reasoning, as `offboarding.clearance` versus `employee.offboard`. There is no
`.team` scope: no manager workflow needs one, and the place the question really
arises — an exit — is already gated on `employee.offboard`.

**Static segments before `:id`.** `me`, `categories` and `employee` are declared
first; Nest matches in declaration order, so a static route arriving second
loses to the parameter above it.

**Per item, not per category.** A stock count cannot answer "who has SN-4471",
has nowhere to hold a serial or a warranty, and reduces the exit check to a
number somebody reconciles by hand.

**One open assignment per asset is a partial unique index**, not a service
check — see doc 02. `Asset.status` is stored rather than derived, so one method
is its only writer.

**`LOST` is the one status settable while somebody still holds it**, and it
closes their assignment. "It is gone" is exactly the case where the thing
cannot be handed back first. `IN_REPAIR` and `RETIRED` are refused there,
because both claim the company has it and the company does not.

**The exit clearance reads this module.** An `OffboardingTask` with
`kind: ASSET_RETURN` is settled by `AssetClearanceService` — the single writer
of that task's status — on issue, on return, on write-off, and once when the
exit starts. It cannot be ticked to `DONE` by hand; `NOT_APPLICABLE` with a
reason still works. `assertCleared` is unchanged: it already refused completion
while any required task was `PENDING`, which is all this needed. The dependency
runs `Offboarding → Assets` only, with no `forwardRef`.

### Announcements (`/announcements`)
| Method | Path |
|---|---|
| GET | `/announcements` — audience-filtered for caller, pinned first |
| POST | `/announcements` · PATCH/DELETE `/announcements/:id` |
| POST | `/announcements/:id/read` — mark read |
| GET | `/announcements/:id/reads` — read receipts (author/HR) |

### Notifications — **not built**

No `/notifications` endpoints exist. A `Notification` table is in the schema
with zero reads and zero writes, and there is no module, service or bell.

The unread/mark-read capability this section once specified was absorbed by
Announcements, which is the only thing that ever needed it:
`GET /announcements/unread-count`, `POST /announcements/:id/read` and
`POST /announcements/read-all`. A general notification feed would be a new
module — see [15-feature-audit.md](./15-feature-audit.md).

### Reports (`/reports`) — read-only aggregates
All four take `?from=&to=` (an arbitrary range, capped at 366 days) plus an
optional `?departmentId=`, and all accept `?format=json|csv|excel`. Each
returns the same envelope — `meta`, `kpis`, `charts`, `columns`, `rows` — so
one export layer serves every report and the web renders them with one
component. Viewing needs `report.view` (org-wide) or `report.view.team`
(direct reports); a non-JSON `format` additionally needs `report.export` and
is written to the audit log.

Attrition folded into the employee report rather than becoming a fifth
endpoint — it is the same query surface.

| Path | Content |
|---|---|
| `/reports/employees` | Headcount, joiners & leavers per month, attrition %, tenure distribution |
| `/reports/attendance` | Present/absent/half-day/late/hours per employee; daily org trend |
| `/reports/leave` | Days taken by type, month and department; allocated vs used |
| `/reports/departments` | Per-department headcount, movement, attendance rate, leave days |
| `/reports/summary` | Six-month headcount trend for the dashboard widget (no range params) |

### Payroll (`/payroll`)

| Method | Path | Permission |
|---|---|---|
| GET | `/payroll/components` — pay component catalogue | `payroll.structure.manage` \| `payroll.read` |
| GET / POST | `/payroll/structures` · GET/PATCH/DELETE `/payroll/structures/:id` | `payroll.read` / `payroll.structure.manage` |
| GET | `/payroll/structures/options` — active structures for the assignment form | `payroll.salary.manage` \| `payroll.read` |
| POST | `/payroll/structures/:id/clone` — copy, starts inactive | `payroll.structure.manage` |
| GET | `/payroll/salaries` — roster with current salary | `payroll.read` \| `payroll.salary.manage` |
| GET | `/payroll/salaries/me` · `/payroll/salaries/:employeeId` — revision timeline | `payroll.read.own` (+ scope) |
| POST | `/payroll/salaries` — assign or revise | `payroll.salary.manage` |
| DELETE | `/payroll/salaries/:id` — only if no settled payroll depends on it | `payroll.salary.manage` |
| GET | `/payroll/adjustments?month=&employeeId=` — one-offs for a month | `payroll.read` \| `payroll.process` |
| POST | `/payroll/adjustments` — set a bonus, incentive or recovery | `payroll.process` |
| DELETE | `/payroll/adjustments/:id` — before the month is settled | `payroll.process` |
| GET / POST | `/payroll/runs` · GET `/payroll/runs/:id` | `payroll.read` / `payroll.process` |
| GET | `/payroll/runs/:id/preflight` — what would block calculation | `payroll.process` |
| POST | `/payroll/runs/:id/actions` — every state transition | per action (below) |
| GET | `/payroll/payslips` · `/payroll/payslips/me` · `/payroll/payslips/:id` | `payroll.read.own` (+ scope) |
| PATCH | `/payroll/payslips/payment` — bulk payment status | `payroll.pay` |
| GET | `/payroll/reports/:kind?month=&format=` | `payroll.read` (+ `report.export` for CSV/Excel) |

**One endpoint for six transitions.** `POST /runs/:id/actions` takes
`{ action: calculate \| approve \| reopen \| lock \| publish \| cancel }`. The
state machine already knows which are legal from which status and which
permission each demands, so splitting it into six verbs would duplicate that
decision in the routing table. An illegal transition returns 400 with the
reason; a missing permission returns 403.

```
DRAFT ──calculate──> IN_REVIEW ──approve──> APPROVED ──lock──> LOCKED ──publish──> PUBLISHED
  ^                      │                      │
  └────── recalculate ───┘        reopen ───────┘        (APPROVED only)
```

`LOCKED` and `PUBLISHED` accept no transition at all — a payslip an employee
has already seen must not change underneath them, so a mistake there is
corrected by an adjustment in the next run. Payment status moves on its own
axis (`PENDING → PROCESSING → PAID`, with `FAILED` retryable) and only once the
run is published; `PENDING → PAID` is refused so a bank file can be exported in
between.

Calculation is **destructive by design**: it drops and rebuilds every payslip
for the run. Payroll is recalculated repeatedly during review, and merging
would leave a payslip behind for someone since excluded.

Reports (`register`, `bank-transfer`, `pf`, `esi`, `tax`, `department`) are
built from the payslips of a run rather than recalculated, so a report and the
payslip it summarises can never disagree. The bank-transfer report excludes
payslips with no account rather than emitting blank rows, and reports how many
it dropped.

### Settlements (`/payroll/settlements`)

| Method | Path | Permission |
|---|---|---|
| GET | `/payroll/settlements` — the queue | `payroll.read` |
| GET | `/payroll/settlements/for-offboarding/:offboardingId` — null if none | `payroll.read` |
| GET | `/payroll/settlements/:id` · `/payroll/settlements/:id/activity` | `payroll.read` |
| POST | `/payroll/settlements` — prepare one for an exit | `payroll.process` |
| POST | `/payroll/settlements/:id/recompute` — destructive, drafts only | `payroll.process` |
| POST / PATCH / DELETE | `/payroll/settlements/:id/lines[/:lineId]` — add, override, remove | `payroll.process` |
| POST | `/payroll/settlements/:id/approve` · `/cancel` | `payroll.approve` |
| POST | `/payroll/settlements/:id/pay` — with a bank reference | `payroll.pay` |

**Mounted under `/payroll`, not `/offboardings`, and that is the access
decision.** Finance holds `payroll.approve` and `payroll.pay` but not
`employee.offboard`; routing settlements through the exit record would have
meant granting Finance read on every offboarding in the company to release one
payment. `for-offboarding/:id` is declared before `:id` so the static segment
is never read as a settlement id.

**No new permission codes.** `payroll.process` prepares and edits,
`payroll.approve` approves, `payroll.pay` releases — the separation of duties
payroll already runs on, and it fits exactly: HR prepares, Finance releases.

```
DRAFT ──approve──> APPROVED ──pay──> PAID
  └──────────── cancel ────────────> CANCELLED   (from DRAFT or APPROVED)
```

`PAID` and `CANCELLED` accept nothing. Lines can only be touched while `DRAFT`,
the same bargain `calculate` makes: an approval on record has to be an approval
of figures somebody can still see. Recompute drops and rebuilds the computed
lines and **keeps manual ones** — a negotiated bonus cannot be derived twice.

**A settlement is not a payroll run**, deliberately. A run is unique per company
per month, prorates by working days, and computes statutory deductions on gross;
a settlement lands weeks after the last working day and its amounts must stay
outside that base, because ESI is a cliff rather than a taper and a payout added
to monthly gross would switch it off for the month. Tax is entered by hand, as
monthly TDS already is.

**Completion is not gated on settlement.** It routinely lands weeks late, and
blocking would keep somebody's access open until Finance pays. A company that
wants the coupling uses the finance-owned "clear outstanding dues" clearance
item, which is on the default checklist.

### Settings & Admin (`/settings`, `/roles`, `/audit`)
| Method | Path | Permission |
|---|---|---|
| GET | `/settings` — typed groups, defaults filled in | any signed-in user |
| PATCH | `/settings` — one or more groups | `settings.manage` |
| GET | `/settings/email-templates` | `settings.manage` |
| PUT / DELETE | `/settings/email-templates/:key` — edit / reset to default | `settings.manage` |
| GET | `/roles` · GET `/permissions` — matrix data | `role.manage` |
| PUT | `/roles/:id/permissions` — replace grants (guardrails applied) | `role.manage` |
| GET | `/audit?resource=&entity=&actorId=&action=&from=&to=` | `audit.read` |
| GET | `/audit/facets` — distinct actions and entities for the filters | `audit.read` |

`GET /settings` is deliberately ungated: every user needs `workingWeek` to
render the attendance calendar and `modules` to render navigation. The three
groups are `workingWeek` (`weekOffDays`, `weekStartsOn`), `leave`
(`yearStartMonth`, `allowNegativeBalance`), `payroll` (currency, pay day, LOP
basis, and the PF / ESI / professional-tax rules) and `modules`; each is stored
as one `Setting` row so patching one never rewrites another.

The patch schema strips defaults **recursively**, because the payroll group
nests: without that, a PATCH of `payroll.pf.employeeRate` would materialise its
siblings and reset the wage ceiling, since the whole group is one row.

Every key has a consumer — a setting nothing reads is a lie the UI tells. Date
and currency formats are deliberately absent until the ~15 formatter call
sites on the web read from here.

**Grants replace, not merge** — `PUT` carries the complete list for the role,
so two admins editing different rows cannot merge into a state neither chose.
Permissions the guardrails protect (the Admin floor: `settings.manage`,
`role.manage`) are added back and returned in `blocked` rather than silently
dropped. Changes reach signed-in users on their next token refresh, within 15
minutes.

## Cross-cutting behavior

- **Scoping middleware:** every query passes through the tenant scope (`organizationId` from JWT) — enforced in services, verified by tests, so a future second tenant leaks nothing.
- **Approver resolution (Phase 1):** an employee's approver = their `manager`'s user; HR/Admin can act on anything they hold `*.approve` for. Multi-step approval chains are a future module (doc 11) — the `ApprovalStatus` machine already supports it.
- **Rate limits:** `auth/*` 5/min/IP; global 100/min/user (NestJS Throttler).
- **Swagger:** DTOs annotated; every endpoint tagged by module → the docs page is the API contract for the future mobile app.
