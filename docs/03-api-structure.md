# 5 — API Structure

Base URL: `/api/v1` (versioned from day one). OpenAPI served at `/api/docs` (Swagger UI, non-production only unless authenticated).

## Conventions

- **Auth:** `Authorization: Bearer <access-token>` on every route except `auth/*` public endpoints. Refresh token travels only as an httpOnly cookie (web); the request-body variant for a non-browser client is designed but unbuilt and unplanned (doc 07).
- **Permissions:** each route declares `@RequirePermissions('resource.action')` (doc 04). "Self" endpoints (`/me/...`) bypass the matrix — they are scoped by the JWT subject.
- **Envelope:** success returns the resource directly; errors return RFC-7807-style `{ statusCode, error, message, details? }`. No `{ success: true }` wrappers.
- **Lists:** `?page=&limit=&sort=&order=&search=` + module-specific filters. Response: `{ data: T[], meta: { page, limit, total } }`.
- **Dates:** ISO-8601 UTC in transport; date-only fields as `YYYY-MM-DD`.
- **Idempotency:** check-in/out and approval actions are idempotent (repeating returns current state, not an error). Repeating means *while nothing has changed* — clocking in again after a clock-out opens a new session rather than returning the old one.

## Endpoints by module

> **A note on the permission column.** Some sections below use a two-column
> `| Method | Path |` table and name the permission only in prose, or not at
> all. Roughly 120 routes are gated in code by a `@RequirePermissions` that this
> document does not state. The gate is real either way — `permissions.guard.ts`
> enforces it — but the authority is `docs/04-rbac.md` and the decorator, not
> this table. Widening every table is outstanding work.


### Health (`/health`) — public, no token

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness. Answers without touching the database, so a wedged query cannot make the process look dead |
| GET | `/health/ready` | Readiness. Pings the database; this is the one a load balancer should watch |

Both are `@Public`. Note the global prefix still applies — the paths are
`/api/v1/health` and `/api/v1/health/ready`, not `/health`.

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
| GET / POST | `/organization/departments` · PATCH/DELETE `/organization/departments/:id` |
| GET | `/organization/departments/options` · `/designations/options` · `/locations/options` · `/employment-types/options` · `/shifts/options` — id+label pickers; `org.read` |
| GET / POST | `/organization/designations` · PATCH/DELETE `/organization/designations/:id` |
| GET / POST | `/organization/locations` · PATCH/DELETE `/organization/locations/:id` |
| GET / POST | `/organization/employment-types` · PATCH/DELETE `/organization/employment-types/:id` |
| GET / POST | `/organization/shifts` · PATCH/DELETE `/organization/shifts/:id` |
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
| GET | `/employees/:id/avatar` — the photo itself; `directory.read` |
| POST / DELETE | `/employees/:id/avatar` — set or take down; `employee.update` |
| POST / DELETE | `/me/avatar` — your own; `employee.update.own` |

| POST | `/employees/:id/offboard` — put on notice, mark exited, or withdraw a resignation; `employee.offboard` |
| POST | `/employees/:id/confirm` — off probation; `employee.confirm` |
| POST | `/employees/:id/extend-probation` — push the end date back, with a reason; `employee.confirm` |
| GET | `/employees/:id/activity` — employment history, from the audit trail |
| GET | `/employees/export` — the list as CSV/Excel; `employee.read` \| `report.export` |
| GET | `/employees/import/template` — the column headers to fill in; `employee.import` |
| POST | `/employees/import/preview` — upload, parse, report what would happen; `employee.import` |
| POST | `/employees/import/:id/commit` — apply a previewed import; `employee.import` |
| GET | `/employees/import/:id` — one import and its row-level results; `employee.import` |

**Neither avatar write carries `@RequirePermissions`, and that is deliberate.**
Whether setting a photo costs `employee.update.own` or `employee.update`
depends on whose record the id belongs to, and the guard cannot see that — it
sees a permission, not a subject. The service decides, which is also what stops
self-service being a way to put a photo on a colleague.

The read is gated on `directory.read`, which every role holds. That width is
correct: the directory and the org chart already show every colleague's face to
everybody, and a stricter gate would leave photo-shaped holes in both for
ordinary staff. A photo nobody has set is a 404, so the browser falls back to
initials rather than being handed a placeholder.

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
| GET | `/attendance/me?from=&to=` — self history |
| GET | `/attendance?date=&departmentId=` — team/org view (permission-scoped: manager sees reports, HR sees all) |
| POST | `/attendance/requests` — regularization request (self) |
| GET | `/attendance/requests?status=` — inbox (approver) / own (employee) |
| POST | `/attendance/requests/:id/approve` · `/reject` · `/cancel` |
| GET | `/attendance/summary?month=` — org/team roll-up; `attendance.read` \| `attendance.read.team` |
| GET | `/attendance/employees/:employeeId?from=&to=` — one person's history; `attendance.read` \| `attendance.read.team` |

**Shifts are not here.** They live under `/organization/shifts` — a shift is a
piece of company structure, not an attendance record.

### Leave (`/leave`)
| Method | Path |
|---|---|
| GET / POST | `/leave/types` · PATCH/DELETE `/leave/types/:id` |
| GET | `/leave/balances/me` — self balances for current year |
| GET | `/leave/balances?employeeId=&year=` — HR view; POST `/leave/balances/adjust` (manual adjustment, audited) |
| POST | `/leave/requests` — apply (validates balance + overlaps + holidays) |
| GET | `/leave/requests?status=&employeeId=` — own / inbox / HR-all by permission |
| POST | `/leave/requests/:id/approve` · `/reject` · `/cancel` |
| GET | `/leave/calendar?month=` — who's out (team/org scoped) |
| GET | `/leave/types/options` — id+label picker |
| GET | `/leave/requests/preview?from=&to=&half=` — working days and balance impact before applying |

### Documents (`/documents`)
| Method | Path |
|---|---|
| GET / POST | `/documents/categories` · PATCH/DELETE `/documents/categories/:id` |
| POST | `/employees/:employeeId/documents` — multipart upload (max size from settings); allowed during onboarding |
| GET | `/documents?employeeId=&categoryId=&search=` — **org-wide, `document.read`.** The HR list across every employee, paginated. Per-employee reads stay on `/employees/:id/documents`, where the scope depends on *which* employee and so has to be settled in the service |
| GET | `/documents/:id/file` — permission check, then **streams** the bytes (`StreamableFile`). No redirect and no signed URL: the bucket is private and stays private, so the API is the only reader |
| PATCH | `/documents/:id` — move to another folder |
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

**`me` carries the reader's own figures** — leave still bookable this year with
the per-type breakdown behind it, and the requests they have raised and are
waiting on somebody else to decide. It is the mirror of `approvals`, scoped by
employee id alone: the `.own` codes need no `'__none__'` sentinel because there
is no record to match against. The whole block is null for an account with no
employee record, because a row of zeroes would read as "you have used all your
leave" rather than as "the question does not arise for you". A leave type with
nothing left is kept in the breakdown — it is the answer to "can I take sick
leave", and dropping it would leave the total unexplained by the list under it.

Days present this month are deliberately **not** here: deriving a month of day
statuses needs the holiday calendar, the working week and approved leave, which
is `AttendanceService`'s job and already an endpoint. The dashboard asks
`/attendance/me` for it rather than growing a second copy of that derivation.

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

### Careers (`/careers`) — **public, no token**

| Method | Path | Permission |
|---|---|---|
| GET | `/careers` — open roles that have been published | **none** |
| GET | `/careers/:slug` — one role | **none** |
| POST | `/careers/:slug/apply` — multipart, optional `cv` | **none** |

The only unauthenticated **write** surface in the product. Everything else
behind `/api/v1` requires a token, so every assumption the rest of the API makes
about a caller — an organization, a permission set, an audit identity — is false
here. What follows from that:

- **Two conditions to be visible**, not one: `status = OPEN` *and* a non-null
  `slug`. Open is the decision to hire; a slug is the decision to say so
  publicly. Openings that predate this have no slug, which is why the column is
  nullable — a derived default would have published every old DRAFT on deploy.
- **Its own mapper, which never spreads a row.** The internal opening carries
  `minMonthlyCtc`, `maxMonthlyCtc`, `hiringManagerId` and `headcount`. There is a
  test that serialises the response and greps it, because that is the failure
  that matters and it is invisible in a diff.
- **No enumeration.** A closed role, an unpublished one and one that never
  existed all answer 404. Applying twice reports the same success as applying
  once — "you have already applied" is a way to test whether an address is in
  the database, and this is the one endpoint anybody at all can ask.
- **5 applications a minute per IP**, against the global 100. Reads keep the
  global limit: a job board being scraped is not an attack.
- **The CV is checked on content type *and* extension.** A browser sends
  whatever type it likes and an extension is chosen by the uploader; neither
  alone is a check. PDF and DOCX only, 5 MB, stored under `<orgId>/careers/` in
  the same private bucket, and the `Document` row carries no `employeeId` and no
  `uploadedById` because there is neither.
- **Attribution is not accepted from the applicant.** `source` is always
  `Careers page` and `referrerId` is never written — a stranger inventing their
  own referral is a stranger inventing a referral bonus.

One tenant only, for now. The service resolves the single organization and
refuses plainly if a second ever exists; the roadmap's answer is a per-org
subdomain, and guessing would publish one company's vacancies under another's
URL.

### Performance (`/performance`)

| Method | Path | Permission |
|---|---|---|
| GET | `/performance/cycles` — the cycles | `performance.read.own` |
| GET | `/performance/cycles/active` — the one running, or `null` | `performance.read.own` |
| GET | `/performance/cycles/:id` — one cycle, with its coverage counts | `performance.read.own` |
| POST | `/performance/cycles` — plan one; created as a draft | `performance.manage` |
| PATCH | `/performance/cycles/:id` — edit a draft's dates | `performance.manage` |
| POST | `/performance/cycles/:id/open` — enrol everybody eligible; **idempotent** | `performance.manage` |
| POST | `/performance/cycles/:id/close` — refused with reviews outstanding unless `force` | `performance.manage` |
| DELETE | `/performance/cycles/:id` — only a draft nobody is enrolled in | `performance.manage` |
| GET | `/performance/goals` — `scope=own\|team\|all`, filter cycle and status | `performance.read.own` |
| POST | `/performance/goals` — somebody else's needs `performance.goal.team` | `performance.goal.own` |
| GET / PATCH / DELETE | `/performance/goals/:id` | `performance.read.own` / `performance.goal.own` |
| GET | `/performance/reviews` — `scope=own\|team\|all`, `awaitingMe` | `performance.read.own` |
| GET | `/performance/reviews/:id` — with that cycle's goals attached | `performance.read.own` |
| PATCH | `/performance/reviews/:id/self` — save a draft | `performance.read.own` |
| POST | `/performance/reviews/:id/self/submit` | `performance.read.own` |
| POST | `/performance/reviews/:id/self/skip` — move past one nobody will write | `performance.manage` |
| PATCH | `/performance/reviews/:id/manager` — save; not visible to them yet | `performance.review.team` |
| POST | `/performance/reviews/:id/share` — release it to the employee | `performance.review.team` |
| POST | `/performance/reviews/:id/acknowledge` | `performance.read.own` |
| POST | `/performance/reviews/:id/reopen` · `/cancel` · `/reassign` | `performance.manage` |

**Writing your own self-assessment is gated by a read code, and that is not an
oversight.** No permission expresses it, because being asked to assess yourself
is a consequence of being enrolled in a cycle rather than a privilege somebody
grants. `performance.read.own` reaches the handler and the service checks you
are the subject. The client is told what it may do through `canSelfAssess`,
`canManagerAssess` and `canAcknowledge` on the payload.

**`managerRating`, `managerComment` and `managerActions` are omitted from the
response**, not nulled, for a reader who may not see them yet. A `null` would be
indistinguishable from "the manager wrote nothing" — a different fact, and one
the employee is owed at the right time. Deciding it server-side is also what
stops a component leaking a rating by rendering it and hiding it.

**`scope=team` on reviews resolves from the reviewer snapshot, not the current
reporting line.** On goals it is the opposite, and both are deliberate: a review
belongs to whoever was in the conversation, a goal to whoever manages you now.

### Expenses (`/expenses`)

| Method | Path | Permission |
|---|---|---|
| GET | `/expenses` — claims; `scope=own\|team\|all`, filter status | `expense.read.own` |
| GET | `/expenses/:id` — one claim with its lines | `expense.read.own` |
| POST | `/expenses` — start a claim | `expense.submit.own` |
| PATCH | `/expenses/:id` — edit a draft; **lines are replaced wholesale** | `expense.submit.own` |
| POST | `/expenses/:id/submit` — send for approval | `expense.submit.own` |
| POST | `/expenses/:id/withdraw` — pull it back before a decision | `expense.submit.own` |
| POST | `/expenses/:id/approve` — needs `payrollMonth` | `expense.approve.team` |
| POST | `/expenses/:id/reject` | `expense.approve.team` |
| GET | `/expenses/categories` — what can be claimed for | `expense.read.own` |
| GET | `/expenses/categories/all` — including deactivated | `expense.manage` |
| POST / PATCH / DELETE | `/expenses/categories` · `/expenses/categories/:id` | `expense.manage` |

**The read routes carry the weakest code that could reach them.** A guard cannot
know *whose* claim an id belongs to, so `expense.read.own` gets you to the
handler and the service narrows from the token — the same arrangement the
avatar routes and the leave list use. Somebody else's claim answers **404, not
403**: whether a claim exists is itself information about a person's spending.

**Approving requires a month, and it is the approver's choice.** Which month
somebody is paid in is a judgement, and a claim filed on the 31st is usually
next month's.

**An approved claim becomes a payslip line** through
`PayrollAdjustmentsService`, not a direct write — so the statutory-component
refusal and the locked-month check live in one place. Two claims approved into
one month against one category **sum into a single adjustment**, because
`PayrollAdjustment` is unique per (employee, month, component) and two rows
would be two payslip lines with the same code.

There is no "mark paid" route. Whether the money arrived is whether the payroll
run for the claim's month was published, and that is derived on read.

### Projects (`/projects`) and timesheets (`/timesheets`)

| Method | Path | Permission |
|---|---|---|
| GET | `/projects` — register; `scope=own\|all`, filter status, search code/name | `project.read.own` |
| POST | `/projects` — open one | `project.manage` |
| GET | `/projects/reports/utilisation` — hours per person per project, `from`/`to` | `project.read` |
| GET | `/projects/:id` — one project with its members | `project.read.own` |
| PATCH | `/projects/:id` — edit | `project.read.own` **+ manage or be its manager** |
| DELETE | `/projects/:id` — delete; refused once anything is logged | `project.manage` |
| POST | `/projects/:id/members` — staff somebody | `project.read.own` **+ manage or be its manager** |
| PATCH | `/projects/members/:memberId` — role, allocation, dates | `project.read.own` **+ manage or be its manager** |
| DELETE | `/projects/members/:memberId` — refused once they have logged hours | `project.read.own` **+ manage or be its manager** |
| GET | `/timesheets` — weeks; `scope=own\|team\|all`, status, `from`/`to` | `timesheet.read.own` |
| GET | `/timesheets/week?weekStart=` — my week and the projects I may log against | `timesheet.read.own` |
| PUT | `/timesheets/week` — save the week; **entries are replaced wholesale** | `timesheet.submit.own` |
| GET | `/timesheets/:id` — one week | `timesheet.read.own` |
| POST | `/timesheets/:id/submit` — send it to my manager | `timesheet.submit.own` |
| POST | `/timesheets/:id/withdraw` — pull it back to draft | `timesheet.submit.own` |
| POST | `/timesheets/:id/approve` | `timesheet.approve.team` |
| POST | `/timesheets/:id/reject` — **note required** | `timesheet.approve.team` |

**Timesheets are not nested under a project.** A week spans projects, so
`/projects/:id/timesheets` would make the resource lie about what it is. The web
app still shows them behind the Projects nav entry — the path and the screen do
not have to agree.

**`GET /timesheets/week` writes nothing.** It answers `timesheet: null` when the
week has never been touched. A GET that lazily created the row would leave an
empty draft for everybody who ever opened the screen, and `PUT` has to handle
the not-yet-existing case anyway — it upserts on `(employeeId, weekStart)`,
which is also what makes two requests racing to open one week collide instead of
producing two half-filled sheets.

**Saving is deliberately more permissive than submitting.** `PUT` refuses only
what would corrupt the row: a non-Monday `weekStart`, a day outside the week,
the same project twice on one day, a project from another organization.
Membership windows, closed projects and a 30-hour Tuesday are `submit`'s
question — a draft is a scratchpad, and being blocked mid-thought is how people
stop filling one in. `submit` then reports **every** problem at once.

**The staffing routes carry `project.read.own` and check the rest in the
service**, because a project's own manager may staff it without
`project.manage` — see docs/04-rbac.md §ownership-as-a-grant. Read routes carry
the weakest code that could reach them and the service narrows from the token's
scope; an unreadable project or week answers **404, not 403**.

**Deleting counts first.** `TimesheetEntry.projectId` is RESTRICT, so without a
`_count` pre-flight the database refuses as a raw Prisma error and the caller
gets a 500. Both delete routes answer with a sentence naming the count and the
way out — mark the project completed, or set a leaving date on the member.

There is no cost or billing rate anywhere in this module, and no client entity.

### Helpdesk (`/helpdesk`)

| Method | Path | Permission |
|---|---|---|
| GET | `/helpdesk/tickets` — `scope=own\|queue\|all`, filter status/priority/category | `helpdesk.read.own` |
| GET | `/helpdesk/tickets/:id` — one ticket and its thread | `helpdesk.read.own` |
| POST | `/helpdesk/tickets` — raise one | `helpdesk.raise.own` |
| POST | `/helpdesk/tickets/:id/comments` — reply, or `internal: true` for a note | `helpdesk.read.own` |
| POST | `/helpdesk/tickets/:id/assign` — hand it over, or `null` back to the queue | `helpdesk.respond` |
| POST | `/helpdesk/tickets/:id/start` · `/wait` · `/resolve` | `helpdesk.respond` |
| POST | `/helpdesk/tickets/:id/reopen` · `/close` · `/cancel` | `helpdesk.read.own` |
| PATCH | `/helpdesk/tickets/:id/priority` · `/category` | `helpdesk.respond` |
| GET | `/helpdesk/summary` — counts behind the tabs | `helpdesk.read.own` |
| GET | `/helpdesk/categories` | `helpdesk.read.own` |
| POST / PATCH / DELETE | `/helpdesk/categories` · `/helpdesk/categories/:id` | `helpdesk.manage` |

**The read routes carry the weakest code that could reach them**, as expenses
does above and for the same reason: the guard cannot know whose ticket an id
belongs to. Reply, reopen, close and cancel are all `helpdesk.read.own` at the
guard, and the service decides whether you are the requester on this one or
somebody working the desk. An unreachable ticket answers **404, not 403** —
whether a ticket exists is itself information, and a helpdesk that distinguishes
"forbidden" from "not found" can be probed for whether a colleague has raised a
grievance.

**Scope narrows rather than refusing.** Asking for `all` without `helpdesk.read`
returns your own tickets with a 200, matching expenses and performance. A 200 is
therefore never evidence that the scope you asked for is the scope you got.

**`helpdesk.respond` grants the queue, not the organization.** The queue is
tickets assigned to you plus unassigned ones; reading one assigned to somebody
else needs `helpdesk.read`. Collapsing the two would make "may work the desk"
and "may read every grievance in the company" a single grant.

**There is no `helpdesk.read.team`**, for the reason letters gives: a ticket is
bilateral between one person and a desk, and the manager it concerns is exactly
who must not read it by default. An organization that wants team leads on a desk
grants `helpdesk.respond` to a role composed in Settings — no code needed.

**Comments have three kinds, and only two are writable.** `PUBLIC` and
`INTERNAL` come from this route; `SYSTEM` is written by the service on every
transition and is what this module has instead of a status-history table. The
thread is filtered by `visibleComments` before it is returned, so an internal
note never reaches the requester's payload at all.

**No notification ever carries a comment body** — every one sends the ticket
subject. That removes the internal-note leak class outright rather than relying
on each call site to remember.

There is no `PATCH` on a ticket's subject or description. A correction is a
comment; editing the text an agent has already read is how a thread stops making
sense.

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

### Recruitment (`/recruitment`)

| Method | Path | Permission |
|---|---|---|
| GET | `/recruitment` — openings, with a live-application count each | `recruitment.read` · `.read.team` |
| POST / PATCH | `/recruitment` · `/recruitment/:id` | `recruitment.opening.manage` |
| GET | `/recruitment/:id` — one opening and its whole pipeline | `recruitment.read` · `.read.team` |
| PATCH | `/recruitment/:id/status` — publish, pause, close, fill | `recruitment.opening.manage` |
| GET | `/recruitment/candidates` · `/recruitment/candidates/:id` | `recruitment.read` · `.read.team` |
| POST / PATCH | `/recruitment/candidates` · `/recruitment/candidates/:id` | `recruitment.candidate.manage` |
| POST | `/recruitment/applications` — put a candidate forward | `recruitment.candidate.manage` |
| PATCH | `/recruitment/applications/:id/stage` — move it, or end it | `recruitment.candidate.manage` |
| POST | `/recruitment/interviews` — book a round | `recruitment.candidate.manage` |
| PATCH | `/recruitment/interviews/:id/feedback` — once; it freezes | `recruitment.interview.submit` |
| POST | `/recruitment/offers` · GET `/recruitment/offers/:id` | `recruitment.offer.manage` / read |
| PATCH | `/recruitment/offers/:id/send` · `/respond` | `recruitment.offer.manage` |
| POST | `/recruitment/offers/:id/hire` | `recruitment.hire` **and** `employee.invite` |

**A hire converts; it does not create.** `POST /recruitment/offers/:id/hire`
reads the accepted offer and calls `OnboardingService.onboard` — the same
method HR's *Onboard a hire* screen calls. That already generates the employee
code, writes the `INVITED` user with an unusable password hash, creates the
`Onboarding` row and mails a single-use invite to the **personal** address,
because the work mailbox does not exist until this moment. A second path would
have been a second copy of those four things and one of them would have
drifted. The only field the route asks for is the work email; the name and
personal email come off the candidate, the job and the join date off the offer.

**Hiring spends two permissions, and says so.** Without the explicit
`employee.invite` check the caller reaches `onboard()` and gets *its* refusal,
which is correct but reads as though the recruitment permission was the
problem.

**Seven codes rather than one.** Raising an opening, adding a candidate, giving
feedback, making an offer and converting one into staff are five different
jobs, and in most organizations not all the same person's. `recruitment.hire`
is separate from `recruitment.offer.manage` for the reason
`employee.onboarding.approve` is separate from `employee.update`: converting a
person into staff creates a login and a payroll subject.

**The rules are their own file.** `application.stage.ts` is pure — no Prisma,
no clock — on the model of `asset.status.ts` and `settlement.calc.ts`. The
service fetches what the rules need and writes their answer down rather than
re-deciding: which transitions are legal, that REJECTED and WITHDRAWN are
terminal, that an offer cannot exist before the OFFER stage, that HIRED needs
an accepted one, and that closing an opening over live applications is refused.

**Backwards is allowed while an application is live.** A rescheduled round is
ordinary, and refusing it teaches people to reject-and-re-add, which loses the
history the rejection reason exists to keep.

**A declined or withdrawn offer ends the application; an accepted one does
not** — the hire has not happened yet, and the offer screen is where it does.

**The list counts *live* applications, not all of them.** How many people are
in this pipeline now is the number the screen is read for.

**Static segments before `:id`.** `candidates`, `applications`, `interviews`
and `offers` are all declared before `/:id`, which is an opening.

**Money crosses the wire as a number.** See doc 02 — `recruitment.mapper.ts`
converts Prisma's `Decimal` at the boundary, and `null` stays `null` rather
than becoming `0`.

### Announcements (`/announcements`)
| Method | Path |
|---|---|
| GET | `/announcements` — audience-filtered for caller, pinned first |
| POST | `/announcements` · PATCH/DELETE `/announcements/:id` |
| POST | `/announcements/:id/read` — mark read |
| GET | `/announcements/:id/reads` — read receipts (author/HR) |
| POST | `/announcements/:id/attachments` — multipart; `announcement.manage` |
| GET | `/announcements/attachments/:attachmentId/file` — streams the bytes; `announcement.read` |
| DELETE | `/announcements/attachments/:attachmentId` — `announcement.manage` |

### Notifications (`/notifications`)

This section said "**not built** — no endpoints exist, no module, service or
bell" long after all three existed. It was written when that was true and never
revisited; the module shipped, and the doc kept saying otherwise.

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` — the feed, `unreadOnly` | Scoped to the JWT subject, nothing else |
| GET | `/notifications/unread-count` — the bell | |
| POST | `/notifications/:id/read` · `/read-all` | |
| GET / PATCH | `/notifications/preferences` | The individual's email switch |

Every route is scoped to `claims.sub` rather than taking a user id, so there is
no permission code here at all — a notification feed you can ask about somebody
else is not a feed.

**Senders do not call this controller.** They call `NotificationsService.notify`
or `notifyPermission`, which writes the in-app row *and* emails the
`notification_generic` template unless the call passes `{ email: false }`.
`notifyPermission` resolves recipients through the role graph rather than by
role code, so a custom role composed in Settings is reached without any module
naming it. Delivery respects both `User.emailNotifications` and the
organization's `EmailTemplate.isActive` — either being off is enough.

The module is `@Global` and imports nothing, deliberately: anything that
notifies is something it could not depend on without closing a cycle.

Announcements keep their own unread/read routes
(`GET /announcements/unread-count`, `POST /announcements/:id/read`,
`POST /announcements/read-all`) — a read receipt on a post everyone can see is a
different thing from a notification addressed to one person.

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
| GET | `/payroll/components` — pay component catalogue; `includeInactive` needs the manage code | `payroll.structure.manage` \| `payroll.read` |
| POST | `/payroll/components` — add an allowance or deduction | `payroll.structure.manage` |
| PATCH | `/payroll/components/:id` — rename, reorder, retire | `payroll.structure.manage` |
| DELETE | `/payroll/components/:id` — refused if anything references it | `payroll.structure.manage` |
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

### Statutory filings and TDS returns — removed

`/payroll/filings`, `/payroll/challans` and `/payroll/returns` were removed on
2026-08-20, together with the `payroll.filing` permission and the `statutory`
settings group. The scope decision: this product calculates the year's TDS and
deducts it monthly (the Income tax module below); it does not generate
government return files — EPFO ECR, ESIC returns or Form 24Q. The 24Q builder
was gated behind an untranscribed FVU layout and never produced a usable file.

### Income tax (`/payroll/tax`)

| Method | Path | Permission |
|---|---|---|
| GET | `/payroll/tax/me?financialYear=&month=` — my regime, projection and this month's TDS | `payroll.read.own` |
| PUT | `/payroll/tax/me/regime` — choose a regime for a year | `payroll.read.own` |
| GET | `/payroll/tax/me/declaration?financialYear=` | `payroll.read.own` |
| PUT | `/payroll/tax/me/declaration` — **items are replaced wholesale** | `payroll.read.own` |
| POST | `/payroll/tax/me/declaration/submit` | `payroll.read.own` |
| GET | `/payroll/tax/configuration?financialYear=` — the year's slabs and limits | `payroll.tax.view` |
| PUT | `/payroll/tax/configuration` — save a year's rules; **bands are replaced wholesale** | `payroll.tax.manage` |
| POST | `/payroll/tax/configuration/copy` — clone one year into another, unconfirmed | `payroll.tax.manage` |
| GET | `/payroll/tax/configuration/:financialYear/impact` — published runs and TDS already deducted | `payroll.tax.manage` |
| GET | `/payroll/tax/pending?financialYear=` — declarations waiting on HR | `payroll.tax.declaration.approve` |
| GET | `/payroll/tax/employees?financialYear=&month=&regime=&status=&departmentId=&search=` | `payroll.tax.view` |
| GET | `/payroll/tax/employees/:employeeId` — one projection, slab by slab | `payroll.tax.view` |
| GET | `/payroll/tax/employees/:employeeId/declaration` | `payroll.tax.view` |
| POST | `/payroll/tax/employees/:employeeId/declaration/approve` | `payroll.tax.declaration.approve` |
| POST | `/payroll/tax/employees/:employeeId/declaration/reject` — **note required** | `payroll.tax.declaration.approve` |
| PUT | `/payroll/tax/employees/:employeeId/override` — one month, with a reason | `payroll.tax.manage` |
| DELETE | `/payroll/tax/employees/:employeeId/override?month=` | `payroll.tax.manage` |

**`month` is a parameter, never "now".** The remaining-months divisor has to be
reproducible: asking about April in December must still say twelve. Every read
takes the payroll month it is answering as of, and defaults to the current one
only when the caller omits it.

**Monthly TDS is `remaining tax ÷ remaining payroll months`** — twelve in April,
six in October, one in March, and six for somebody who joined in October
whatever month it is now. Not annual ÷ 12, and not a fixed six-month rule: both
under-deduct a mid-year joiner and dump the shortfall on them in March.

**An unconfirmed financial year refuses rather than guessing.** A
`TaxConfiguration` ships `UNCONFIRMED` until somebody enters that year's Finance
Act numbers, and payroll skips those employees rather than deducting zero — a
zero on a payslip reads as "no tax due", which is a different claim. The run
reports how many were skipped.

**Saving a declaration is more permissive than submitting it**, and **approval
is where `approvedAmount` is written** — capped again against the statutory
limit, because HR trimming a figure is a reason to lower it and never to exceed
the cap. Declaring above a section limit is allowed and capped on the way
through; refusing the number would only teach people to under-report it.

**Saving a year's rules is replace-all**, because slabs and surcharge bands have
no natural key — position is their identity, so there is nothing to address a
row by. The whole table goes in one transaction with its parent; a half-written
rate table is a state that cannot happen.

**Confirming is where the bar sits.** A draft may be malformed, which is what a
draft is for. `CONFIRMED` is the act that lets payroll deduct, so it refuses a
table with a gap, an overlap, no open-ended top band, a rate that falls as
income rises, or **no `source`** — an unsourced rate table is one nobody can
check. A gap is the one that matters: income falling between two bands is taxed
by no band at all, producing a smaller number on a payslip and no error anywhere.

**Un-confirming a year that has already deducted is refused.** `tdsForRun`
*skips* an employee whose year is unconfirmed rather than deducting zero, so
reverting mid-year would quietly stop TDS for the whole workforce and land the
shortfall on people in March. Correcting the figures is always the better move,
and the remaining months adjust for what was already taken.

**Editing a live year is allowed, and safe.** Published payslips cannot be
recalculated (`payroll.workflow.ts` only permits it from DRAFT or IN_REVIEW),
and `alreadyDeducted` is read from those frozen payslips — so the divisor
self-corrects and only the remaining months move. The same bargain PF, ESI and
professional tax already make. `impact` exists so the confirmation can name what
it disturbs rather than warning in the abstract.

**This module ends at the payslip line.** It decides what goes into the `TDS`
`PayslipLine` and stops there — downstream consumers read that frozen line,
never the engine.

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
to monthly gross would switch it off for the month. Settlement tax is entered by
hand — regular monthly TDS is computed (§income-tax), but a settlement sits
outside the monthly projection on purpose.

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
| GET | `/roles/assignable` — roles that may be given to an employee | `employee.create` \| `role.manage` |
| POST | `/roles` — compose a custom role | `role.manage` |
| PATCH | `/roles/:id` — rename or re-describe; the code is immutable | `role.manage` |
| DELETE | `/roles/:id` — refused while anybody holds it | `role.manage` |

**A custom role's `code` cannot change after creation.** The access token
carries `roleCode`, so renaming one would leave every live token asserting a
role that no longer exists. System roles cannot be renamed or deleted at all.

**Nobody may grant a permission they do not hold themselves**, and nobody may
edit the permissions of the role they are signed in under — the second is not
redundant, because `claims.perms` is up to fifteen minutes stale and would
otherwise let somebody restore a permission that was just taken from them.
| GET | `/audit?resource=&entity=&actorId=&action=&from=&to=` | `audit.read` |
| GET | `/audit/facets` — distinct actions and entities for the filters | `audit.read` |

`GET /settings` is deliberately ungated: every user needs `workingWeek` to
render the attendance calendar, `localization` to format dates, and `modules` to
render navigation.

There are **nine** groups, each stored as one `Setting` row so patching one
never rewrites another: `workingWeek` (`weekOffDays`, `weekStartsOn`), `leave`
(`yearStartMonth`, `allowNegativeBalance`), `payroll` (currency, pay day, LOP
basis, and the PF / ESI / professional-tax rules), `lifecycle`, `exitChecklist`,
`settlement`, `wfh` and `modules`.

`modules` has twelve keys — `attendance`, `leave`, `documents`, `announcements`,
`reports`, `payroll`, `assets`, `wfh`, `expenses`, `performance`, `helpdesk`,
`projects` — and is **presentation only, never authorization**: turning a module
off hides its navigation entry and leaves its API reachable by anyone holding
the permissions.

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
- **Swagger:** DTOs annotated; every endpoint tagged by module → the docs page is the API contract for any consumer other than `apps/web`. It was written for a mobile app that is no longer planned (doc 11 §20); the contract is worth keeping frozen regardless, because it is the reason a second consumer never becomes a redesign.
