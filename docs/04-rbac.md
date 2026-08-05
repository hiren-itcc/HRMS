# 7–8 — User Roles & Permission Matrix

RBAC is **data, not code** (ADR §1.5): five seeded system roles, permissions as `resource.action` rows, grants editable from Settings → Roles (system roles have guardrails: ADMIN grants can't be reduced below a safe floor).

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
- **Finance exists for separation of duties, not for convenience.** HR configures structures, assigns salaries and calculates a run; Finance approves, locks and records payment. No seeded role holds both `payroll.process` and `payroll.approve`, so the person who produces the numbers is never the person who releases the money. An organization that genuinely wants one person doing both can grant it in Settings → Roles — but it has to be a decision, not a default.
- Roles are **per organization** (migration `20260801050000_role_per_organization`): editing HR's grants in one tenant does not touch another's.

## Permission catalog

Format `resource.action`. Scope suffixes: `.own` (self), `.team` (direct reports), unsuffixed = org-wide.

```
employee.read.own      employee.update.own
employee.read.team
employee.read          employee.create      employee.update      employee.delete
employee.invite        employee.offboard    employee.onboarding.approve
 employee.confirm       (confirm off probation, extend probation)

resignation.request.own   resignation.read.own
resignation.read.team     resignation.approve.team
resignation.read          resignation.approve

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
leave.read             leave.approve            leave.manage        (types, balance adjust)

document.read.own      document.upload.own
document.read.team
document.read          document.upload          document.manage     (categories, delete)

letter.read.own
letter.read            letter.issue             letter.template.manage

announcement.read      announcement.manage

org.read               org.manage               (departments, designations, locations, holidays)
report.view.team       report.view              report.export

payroll.read.own       (own salary, own history, own published payslips)
payroll.read.team      (a manager's direct reports)
payroll.read           (org-wide, including runs still in review)
payroll.structure.manage                         (salary structures)
payroll.salary.manage                            (assign and revise salaries)
payroll.process        (open a run, calculate, publish)
payroll.approve        (approve, reopen, lock)
payroll.pay            (record payment against payslips)

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
| `audit.read` | ✅ | — | — | — | — |
| `payroll.read.own` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `payroll.read.team` | ✅ | ✅ | — | ✅ | — |
| `payroll.read` (all runs, incl. in review) | ✅ | ✅ | ✅ | — | — |
| `payroll.structure.manage` | ✅ | ✅ | — | — | — |
| `payroll.salary.manage` (assign, revise) | ✅ | ✅ | — | — | — |
| `payroll.process` (open, calculate, publish) | ✅ | ✅ | — | — | — |
| `payroll.approve` (approve, reopen, lock) | ✅ | — | ✅ | — | — |
| `payroll.pay` (record payment) | ✅ | — | ✅ | — | — |

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
