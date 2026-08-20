# 7–8 — User Roles & Permission Matrix

RBAC is **data, not code** (ADR §1.5): five seeded system roles, permissions as `resource.action` rows, grants editable from Settings → Roles (system roles have guardrails: ADMIN grants can't be reduced below a safe floor).

**Composing roles.** `POST /roles` creates one, `PATCH /roles/:id` renames it, `DELETE /roles/:id` removes one nobody holds — all gated on `role.manage`. This page described composing a custom role from foundation onwards while no such route existed and `roleCodeSchema` was an enum of the five seeded codes, so a role made by hand could be assigned to nobody. Both are fixed; the claims below are now literally true. Three rules are worth knowing before reading them:

- **You cannot grant what you do not hold.** The ceiling applies to creating a role as much as to editing one — otherwise minting a role holding the whole catalogue and stepping into it would walk straight around the editor's guard.
- **You cannot edit your own role's permissions.** `perms` lives in an access token for up to fifteen minutes, so without this a holder could re-grant a permission that was stripped from them seconds earlier and have the ceiling wave it through on the stale claim.
- **A role code is permanent.** The access token carries `roleCode`, not a role id; renaming a code would leave live sessions naming a role that no longer exists.

## Roles (Phase 1)

| Role | Code | Who | Intent |
|---|---|---|---|
| **Admin** | `ADMIN` | Founder / IT owner | Everything, including settings, roles, audit, org profile |
| **HR** | `HR` | HR team | All people operations org-wide, including configuring and running payroll; no role/permission editing, no payroll approval |
| **Finance** | `FINANCE` | Finance / accounts | Approves, locks and pays payroll. Deliberately holds **no** salary or structure write |
| **Manager** | `MANAGER` | Team leads | Self-service **plus** visibility & approvals over their direct reports only |
| **Employee** | `EMPLOYEE` | Everyone else | Self-service: own profile, attendance, leave, documents, announcements |

Notes:
- Roles attach to **User**, not Employee — someone with no login has no role.
- **Manager is scope-based:** the `MANAGER` role holds `*.team` permissions; the *set of people* it applies to is resolved from `Employee.managerId` at query time. A manager with zero reports effectively degrades to Employee.
- One role per user in Phase 1 (simplicity first). The join table `RolePermission` already supports multi-role/custom roles later without schema change.
- **Finance exists for separation of duties, not for convenience.** HR configures structures, assigns salaries and calculates a run; Finance approves, locks and records payment. No seeded role holds both `payroll.process` and `payroll.approve`, so the person who produces the numbers is never the person who releases the money. An organization that genuinely wants one person doing both can grant it in Settings → Roles — but it has to be a decision, not a default. The same three permissions carry the full & final settlement, which is why it has no codes of its own: HR prepares, Finance releases, and that is already the split.
- **`asset.assign` is separate from `asset.manage` for the same reason `offboarding.clearance` is separate from `employee.offboard`.** Buying and retiring equipment is an admin job; handing a laptop to a joiner is not. Assets give `IT_ADMIN` its second reason to exist as a composed role — there is still no seeded one, so those clearance items keep falling to `employee.offboard` holders until an organization makes one. Every role holds `asset.read.own`, including a leaver: somebody who cannot see their own list cannot return it.
- **A hiring manager gets `recruitment.read.team` and `recruitment.interview.submit`, and nothing else.** Their own openings, and feedback on the people they interview — not the offer, and not the hire. The scope resolves through `JobOpening.hiringManagerId` using the same `'__none__'` sentinel every other team scope uses: a manager with no employee record must match nothing, where an `undefined` would drop the filter and show them every opening in the company.
- **`recruitment.hire` is separate from `recruitment.offer.manage`** for the reason `employee.onboarding.approve` is separate from `employee.update`: converting a person into staff creates a login and a payroll subject, and an organization may well want that held by someone other than whoever negotiates the offer. It is also the one permission in the catalogue that is not sufficient on its own — hiring runs through the ordinary onboarding invite, so it spends `employee.invite` too, and the service says so rather than letting the caller discover it from the wrong refusal.
- Roles are **per organization** (migration `20260801050000_role_per_organization`): editing HR's grants in one tenant does not touch another's.

## Permission catalog

Format `resource.action`. Scope suffixes: `.own` (self), `.team` (direct reports), unsuffixed = org-wide.

```
employee.read.own      employee.update.own
employee.read.team
employee.read          employee.create      employee.update      employee.delete
employee.invite        employee.offboard    employee.onboarding.approve
 employee.confirm       (confirm off probation, extend probation)
employee.import        (bulk CSV: template, preview, commit)

resignation.request.own   resignation.read.own
resignation.read.team     resignation.approve.team
resignation.read          resignation.approve

offboarding.clearance     (sign one exit clearance item off)

Note: offboarding adds no code of its own. `employee.offboard` already means
'may change whether this person works here' and is already held by exactly
Admin and HR, so every /offboardings route uses it.

directory.read         (work contact details for everyone — not the HR record)

Note: the attendance geofence lives on Location, so configuring it needs
org.manage rather than any attendance permission.

attendance.read.own    attendance.mark.own      attendance.request.own
attendance.read.team   attendance.approve.team
attendance.read        attendance.approve       attendance.manage   (unused — see below)

leave.read.own         leave.request.own
leave.read.team        leave.approve.team
leave.read             leave.approve            leave.manage

wfh.read.own           wfh.request.own
wfh.read.team          wfh.approve.team
wfh.read               wfh.approve        (types, balance adjust)

document.read.own      document.upload.own
document.read.team
document.read          document.upload          document.manage     (categories, delete)

letter.read.own
letter.read            letter.issue             letter.template.manage

asset.read.own
asset.read             asset.manage             asset.assign        (issue, take back)

expense.read.own       expense.submit.own
expense.read.team      expense.approve.team     (a manager, for their own reports)
expense.read           expense.approve          expense.manage      (categories, and the payslip line each pays out on)

performance.read.own   performance.goal.own
performance.read.team  performance.goal.team    performance.review.team   (write the manager half, for their own reports)
performance.read       performance.manage       (cycles, and reassigning a reviewer)

helpdesk.read.own      helpdesk.raise.own
helpdesk.read          (every ticket in the organization)
helpdesk.respond       (the queue: assigned to me, plus unassigned)
helpdesk.manage        (desks and their routing)

payroll.tax.view       (anybody's regime, projection and declaration)
payroll.tax.manage     (the year's slabs, limits and source; and a monthly TDS override)
payroll.tax.declaration.approve                  (agree a declaration — asserts proofs were seen)

project.read.own       (projects I am on, or run)
timesheet.read.own     timesheet.submit.own     (fill, send, pull back my own week)
timesheet.read.team    timesheet.approve.team   (a manager, for their own reports)
project.read           project.manage           (the register: open, edit, close, delete, staff)
timesheet.read         (every week in the organization)

recruitment.read.team  (a hiring manager's own openings)
recruitment.read       recruitment.opening.manage
recruitment.candidate.manage                     (add a candidate, put them forward, move a stage)
recruitment.interview.submit                     (feedback — once; it freezes)
recruitment.offer.manage                         (draft, send, record the answer)
recruitment.hire       (convert an accepted offer into staff — also spends employee.invite)

announcement.read      announcement.manage

org.read               org.manage               (departments, designations, locations, holidays)
report.view.team       report.view              report.export

payroll.read.own       (own salary, own history, own published payslips)
payroll.read.team      (a manager's direct reports)
payroll.read           (org-wide, including runs still in review)
payroll.structure.manage                         (salary structures)
payroll.salary.manage                            (assign and revise salaries)
payroll.process        (open a run, calculate, publish; prepare a settlement)
payroll.approve        (approve, reopen, lock; approve or cancel a settlement)
payroll.pay            (record payment against payslips and settlements)

settings.manage        role.manage              audit.read
```

## Permission matrix (seed data)

| Permission | ADMIN | HR | FINANCE | MANAGER | EMPLOYEE |
|---|:-:|:-:|:-:|:-:|:-:|
| `employee.read.own` / `employee.update.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `employee.read.team` | ✅ | ✅ | — | ✅ | — |
| `employee.read` (all) | ✅ | ✅ | ✅ | — | — |
| `employee.create` / `update` / `invite` / `offboard` | ✅ | ✅ | — | — | — |
| `employee.onboarding.approve` | ✅ | ✅ | — | — | — |
| `employee.confirm` (off probation) | ✅ | ✅ | — | — | — |
| `employee.import` (bulk CSV) | ✅ | ✅ | — | — | — |
| `employee.delete` | ✅ | — | — | — | — |
| `directory.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `attendance.mark.own` / `read.own` / `request.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `attendance.read.team` / `approve.team` | ✅ | ✅ | — | ✅ | — |
| `attendance.read` (all) / `approve` (all) | ✅ | ✅ | — | — | — |
| `attendance.manage` (shifts, corrections) | ✅ | ✅ | — | — | — |
| `leave.request.own` / `read.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `leave.read.team` / `approve.team` | ✅ | ✅ | — | ✅ | — |
| `leave.read` (all) / `approve` (all) | ✅ | ✅ | — | — | — |
| `leave.manage` (types, adjustments) | ✅ | ✅ | — | — | — |
| `document.read.own` / `upload.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `document.read.team` | ✅ | ✅ | — | ✅ | — |
| `document.read` (all) / `upload` (any) / `manage` | ✅ | ✅ | — | — | — |
| `letter.read.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `letter.read` / `letter.issue` / `letter.template.manage` | ✅ | ✅ | — | — | — |
| `asset.read.own` (what I am holding) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `asset.read` / `asset.manage` / `asset.assign` | ✅ | ✅ | — | — | — |
| `expense.read.own` / `expense.submit.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `expense.read.team` / `expense.approve.team` | ✅ | ✅ | — | ✅ | — |
| `expense.read` (all) | ✅ | ✅ | ✅ | — | — |
| `expense.approve` / `expense.manage` | ✅ | — | ✅ | — | — |
| `performance.read.own` / `performance.goal.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `performance.read.team` / `performance.goal.team` / `performance.review.team` | ✅ | ✅ | — | ✅ | — |
| `performance.read` / `performance.manage` | ✅ | ✅ | — | — | — |
| `payroll.tax.view` (anybody's tax) | ✅ | ✅ | ✅ | — | — |
| `payroll.tax.manage` / `payroll.tax.declaration.approve` | ✅ | ✅ | — | — | — |
| `project.read.own` / `timesheet.read.own` / `timesheet.submit.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `timesheet.read.team` / `timesheet.approve.team` | ✅ | ✅ | — | ✅ | — |
| `project.read` / `project.manage` / `timesheet.read` | ✅ | ✅ | — | — | — |
| `recruitment.read.team` (own openings) / `recruitment.interview.submit` | ✅ | ✅ | — | ✅ | — |
| `recruitment.read` / `opening.manage` / `candidate.manage` / `offer.manage` / `hire` | ✅ | ✅ | — | — | — |
| `wfh.read.own` / `wfh.request.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `wfh.read.team` / `wfh.approve.team` | ✅ | ✅ | — | ✅ | — |
| `wfh.read` / `wfh.approve` | ✅ | ✅ | — | — | — |
| `announcement.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `announcement.manage` | ✅ | ✅ | — | — | — |
| `org.read` (directory, org chart, holidays) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `org.manage` | ✅ | ✅ | — | — | — |
| `report.view.team` | ✅ | ✅ | — | ✅ | — |
| `report.view` / `report.export` | ✅ | ✅ | ✅ | — | — |
| `settings.manage` | ✅ | — | — | — | — |
| `role.manage` | ✅ | — | — | — | — |
| `resignation.request.own` / `read.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `resignation.read.team` / `approve.team` | ✅ | ✅ | — | ✅ | — |
| `resignation.read` / `approve` | ✅ | ✅ | — | — | — |
| `offboarding.clearance` | ✅ | ✅ | ✅ | ✅ | — |
| `audit.read` | ✅ | — | — | — | — |
| `payroll.read.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `payroll.read.team` | ✅ | ✅ | — | ✅ | — |
| `payroll.read` (all runs, incl. in review) | ✅ | ✅ | ✅ | — | — |
| `payroll.structure.manage` | ✅ | ✅ | — | — | — |
| `payroll.salary.manage` (assign, revise) | ✅ | ✅ | — | — | — |
| `payroll.process` (open, calculate, publish; prepare a settlement) | ✅ | ✅ | — | — | — |
| `payroll.approve` (approve, reopen, lock; approve a settlement) | ✅ | — | ✅ | — | — |
| `payroll.pay` (record payment, incl. settlements) | ✅ | — | ✅ | — | — |
| `helpdesk.read.own` / `helpdesk.raise.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `helpdesk.read` (every ticket) / `helpdesk.respond` / `helpdesk.manage` | ✅ | ✅ | — | — | — |

## Enforcement (single path, no exceptions)

```
Request → JwtAuthGuard (identity) → PermissionsGuard (matrix) → Service (scope filter)
```

1. **`JwtAuthGuard`** validates the access token; attaches `{ userId, orgId, roleCode, permissions[] }` (permissions embedded in JWT claims; token lifetime 15 min bounds staleness after a grant change).
2. **`PermissionsGuard`** reads `@RequirePermissions(...codes)` metadata; any-of semantics, e.g. leave inbox declares `leave.approve.team | leave.approve`.
3. **Service-level scoping** is the part guards can't do: `.team` queries add `WHERE employee.managerId = callerEmployeeId`; `.own` routes derive the employee from the JWT and ignore any client-sent id. **Rule: scope is never taken from request params.**
4. **UI mirrors, never replaces:** the web app hides what `GET /auth/me` says you can't do — cosmetic only; the API is the boundary.

### Three codes in the table are seeded but never checked

The matrix above lists what a role is *granted*. For most rows that is also what
is *enforced*, but three are granted to somebody and read by nothing:

| Code | Why it is inert |
|---|---|
| ~~`employee.offboard`~~ | ✅ Now enforced on `POST /employees/:id/offboard`. |
| `attendance.manage` | Shifts turned out to belong to company setup, not attendance: they live at `organization/shifts` behind `org.manage`. Nothing else claimed the code. |
| `employee.update.own` | `PATCH /me/profile` carries no `@RequirePermissions`. Self-scope comes from the JWT subject, which is stronger — there is no id to tamper with. |

Revoking any of the three changes nothing, which is the problem: the table reads
as though it describes enforcement. They are listed in
[15-feature-audit.md](./15-feature-audit.md) with the endpoints that would give
them meaning.

## Beyond the guard: content as a second gate

Letters need something the matrix cannot express either — not *when* an action
is legal, but whether *this particular row* may be read. An offer letter and a
salary certificate quote pay; an appointment letter does not. So a letter
carries `containsSalary`, computed at issue from the template **and** from the
salary variables its body actually interpolates, and reading one takes:

```
subject of the letter                        → always
letter.read                                  → letters that quote no pay
letter.read + payroll.read                   → all of them
```

Gating on the letter's content rather than the reader's role is what makes this
survive Settings → Roles: a custom role granted `letter.read` without
`payroll.read` was never considered by anyone, and still cannot read a CTC.

It is also why **letters have no `.team` scope**. A document is a filing cabinet
a manager legitimately browses; a letter is a bilateral instrument between the
company and one person. Adding the scope later is one code and one branch —
removing it after tenants have granted it is a breaking change.

## Beyond the guard: whose team, which desk

Resignation approval needs something the matrix cannot express either.
`resignation.approve.team` says "you may approve for your team" — the guard
cannot tell *whose* team, so the service checks the caller is the manager the
request was routed to at submit time. Routing is frozen on the row rather than
read from `Employee.managerId` at decision time: a reorganisation mid-notice
must not move a decision to somebody who knows nothing about it.

Which desk a decision counts as is taken from the record, never from the
request. A manager cannot claim to be giving final sign-off, and an HR user who
happens to also be somebody's manager cannot skip the manager step by
accident. HR acting on a request still at the manager's desk *does* give final
approval — that is what unsticks a request whose reviewer has themselves left —
and the audit row records `managerStepSkipped`.

Nobody may decide on their own resignation, whatever they hold.

The same gap appears once more in exit clearance. `offboarding.clearance` says
"you may clear an exit item"; it cannot say *whose*. A `MANAGER`-owned item
therefore demands the caller actually be that employee's manager — without it
every manager in the organization could sign off every handover.
`employee.offboard` holders may sign off anything, which is also what covers
`IT_ADMIN` items until somebody composes an IT role in Settings → Roles.

### Why the helpdesk has no team scope either

`helpdesk.read.team` does not exist, and a manager holds nothing here beyond
the two codes everybody has.

A ticket is bilateral — one person and a desk. It may be a payslip query, a
request to correct a date of birth, or a grievance about a manager, and in the
last case the manager a team scope would hand it to is exactly who must not
read it by default. Adding the scope later is one code; removing it after
tenants have granted it is a breaking change to their access model.

`helpdesk.respond` grants **the queue** — tickets assigned to you plus
unassigned ones — and not org-wide reading, which is `helpdesk.read`.
Collapsing the two would make "may work the desk" and "may read every grievance
in the company" the same grant, and they are not the same grant.

`helpdesk.raise.own` exists rather than being implied by `read.own`, the same
call `expense.submit.own` and `resignation.request.own` make. Raising a ticket
is not really a privilege HR withholds — switching it off only means the
question arrives as a direct message instead — but the code lets an organization
turn it off for a population without touching the module.

An organization that wants team leads answering tickets composes a role in
Settings → Roles and grants `helpdesk.respond`. No code change is needed.

### Why income tax has no team scope

Every other module here uses the own/team/all triad. Income tax deliberately
does not, and a **manager holds nothing in it**.

What somebody declared under 80D is a medical-insurance premium for their
parents. What they claim under 80U is a disability. What their HRA exemption
implies is where they live and what they pay for it. A reporting line is a
reason to approve their leave; it is not a reason to read any of that.

So there are three codes and no `.team`: `payroll.tax.view` reads anybody's
position, `payroll.tax.declaration.approve` agrees a declaration, and
`payroll.tax.manage` maintains the year's slabs and can override a month. HR
holds all three, Finance holds only the first — it answers for the TDS it
deposits, so it must see how a figure was reached, but whether somebody's 80C
proof is genuine is not its call.

Your own tax page needs no code of its own. It is gated by `payroll.read.own`,
which everybody already holds: a permission granted to all five roles answers no
question.

### Ownership as a grant, not a permission

Projects add one more of these, and it is the only place in the product where
a *row* confers a right no code does.

`project.manage` is org-wide and lands on HR. But a project's own `managerId`
may add, edit and remove its members **without holding it** — the service
accepts `project.managerId === claims.employeeId` as an alternative
(`assertMayManage`). The controller therefore carries only `project.read.own`
on the staffing routes: the guard is the floor, and the service is the rule.

The alternative was every staffing change routing through HR, which is how a
register stops matching reality — and a new permission for "may staff the
projects I run" would have to be granted per person to mean anything, which is
not a permission, it is a row.

The grant deliberately stops short of `DELETE /projects/:id`. Deleting is a
register-level act rather than a staffing one, so the owner is refused there
and HR is not. There is no `project.read.team`: `project.read.own` already
means "on it, or running it", and a project somebody's report is on that they
neither run nor work on is not theirs to read.

Finance holds nothing in this module at all. It records hours, not money —
there is no cost rate and no billing rate, so there is no finance decision in
it. If cost rates ever land they are salary data, and that argument starts in
`permissions.ts`, not here.

## Beyond the guard: state as a second gate

Payroll needs something the matrix cannot express — *when* an action is legal,
not just *who* may take it. `payroll.approve` does not mean "may approve at any
time"; it means "may approve a run that is in review". Both gates apply:

```
PermissionsGuard (who)  →  payroll.workflow.ts (what state allows)  →  Service (scope)
```

The state machine also owns the permission each action demands
(`RUN_ACTION_PERMISSION`), so "reopen needs the approver, not the processor"
is written once rather than in both the routing table and the service.

`resignation.workflow.ts` follows the same shape, with
`RESIGNATION_ACTION_PERMISSION`. Most of the resignation validations are that
table rather than an `if`: "cannot approve twice" is `hr_approve` having no
`APPROVED` in its `from`, and "cannot start offboarding before approval" is
`complete` accepting only `APPROVED`.

## Adding a future module

1. Add the codes to `PERMISSIONS` in `packages/shared/src/constants/permissions.ts`
   and the default grants to `ROLE_PERMISSIONS`.
2. Write a migration that inserts the `Permission` rows and the
   `RolePermission` grants for **every existing organization** — a tenant that
   upgrades must not end up with fewer capabilities than a fresh one. See
   `20260802090000_payroll_module` for the pattern, including creating a new
   system role per org.
3. Annotate the new controllers with `@RequirePermissions(...)`.
4. Add the nav entry and, if the module should be switchable, a `modules` flag
   in settings — presentation only, never authorization.

Custom roles need no code at all: an organization that wants a
`PAYROLL_ADMIN` holding both process and approve can compose one in
Settings → Roles.
