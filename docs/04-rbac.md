# 7–8 — User Roles & Permission Matrix

RBAC is **data, not code** (ADR §1.5): four seeded system roles, permissions as `resource.action` rows, grants editable from Settings → Roles (system roles have guardrails: ADMIN grants can't be reduced below a safe floor).

## Roles (Phase 1)

| Role | Code | Who | Intent |
|---|---|---|---|
| **Admin** | `ADMIN` | Founder / IT owner | Everything, including settings, roles, audit, org profile |
| **HR** | `HR` | HR team | All people operations org-wide; no role/permission editing, no destructive org settings |
| **Manager** | `MANAGER` | Team leads | Self-service **plus** visibility & approvals over their direct reports only |
| **Employee** | `EMPLOYEE` | Everyone else | Self-service: own profile, attendance, leave, documents, announcements |

Notes:
- Roles attach to **User**, not Employee — someone with no login has no role.
- **Manager is scope-based:** the `MANAGER` role holds `*.team` permissions; the *set of people* it applies to is resolved from `Employee.managerId` at query time. A manager with zero reports effectively degrades to Employee.
- One role per user in Phase 1 (simplicity first). The join table `RolePermission` already supports multi-role/custom roles later without schema change.

## Permission catalog

Format `resource.action`. Scope suffixes: `.own` (self), `.team` (direct reports), unsuffixed = org-wide.

```
employee.read.own      employee.update.own
employee.read.team
employee.read          employee.create      employee.update      employee.delete
employee.invite        employee.offboard

attendance.read.own    attendance.mark.own      attendance.request.own
attendance.read.team   attendance.approve.team
attendance.read        attendance.approve       attendance.manage   (shifts, admin edits)

leave.read.own         leave.request.own
leave.read.team        leave.approve.team
leave.read             leave.approve            leave.manage        (types, balance adjust)

document.read.own      document.upload.own
document.read.team
document.read          document.upload          document.manage     (categories, delete)

announcement.read      announcement.manage

org.read               org.manage               (departments, designations, locations, holidays)
report.view.team       report.view              report.export

settings.manage        role.manage              audit.read
```

## Permission matrix (seed data)

| Permission | ADMIN | HR | MANAGER | EMPLOYEE |
|---|:-:|:-:|:-:|:-:|
| `employee.read.own` / `employee.update.own` | ✅ | ✅ | ✅ | ✅ |
| `employee.read.team` | ✅ | ✅ | ✅ | — |
| `employee.read` (all) | ✅ | ✅ | — | — |
| `employee.create` / `update` / `invite` / `offboard` | ✅ | ✅ | — | — |
| `employee.delete` | ✅ | — | — | — |
| `attendance.mark.own` / `read.own` / `request.own` | ✅ | ✅ | ✅ | ✅ |
| `attendance.read.team` / `approve.team` | ✅ | ✅ | ✅ | — |
| `attendance.read` (all) / `approve` (all) | ✅ | ✅ | — | — |
| `attendance.manage` (shifts, corrections) | ✅ | ✅ | — | — |
| `leave.request.own` / `read.own` | ✅ | ✅ | ✅ | ✅ |
| `leave.read.team` / `approve.team` | ✅ | ✅ | ✅ | — |
| `leave.read` (all) / `approve` (all) | ✅ | ✅ | — | — |
| `leave.manage` (types, adjustments) | ✅ | ✅ | — | — |
| `document.read.own` / `upload.own` | ✅ | ✅ | ✅ | ✅ |
| `document.read.team` | ✅ | ✅ | ✅ | — |
| `document.read` (all) / `upload` (any) / `manage` | ✅ | ✅ | — | — |
| `announcement.read` | ✅ | ✅ | ✅ | ✅ |
| `announcement.manage` | ✅ | ✅ | — | — |
| `org.read` (directory, org chart, holidays) | ✅ | ✅ | ✅ | ✅ |
| `org.manage` | ✅ | ✅ | — | — |
| `report.view.team` | ✅ | ✅ | ✅ | — |
| `report.view` / `report.export` | ✅ | ✅ | — | — |
| `settings.manage` | ✅ | — | — | — |
| `role.manage` | ✅ | — | — | — |
| `audit.read` | ✅ | — | — | — |

## Enforcement (single path, no exceptions)

```
Request → JwtAuthGuard (identity) → PermissionsGuard (matrix) → Service (scope filter)
```

1. **`JwtAuthGuard`** validates the access token; attaches `{ userId, orgId, roleCode, permissions[] }` (permissions embedded in JWT claims; token lifetime 15 min bounds staleness after a grant change).
2. **`PermissionsGuard`** reads `@RequirePermissions(...codes)` metadata; any-of semantics, e.g. leave inbox declares `leave.approve.team | leave.approve`.
3. **Service-level scoping** is the part guards can't do: `.team` queries add `WHERE employee.managerId = callerEmployeeId`; `.own` routes derive the employee from the JWT and ignore any client-sent id. **Rule: scope is never taken from request params.**
4. **UI mirrors, never replaces:** the web app hides what `GET /auth/me` says you can't do — cosmetic only; the API is the boundary.

## Adding a future module (e.g. Payroll)

1. Seed `payroll.*` permission rows and default grants (migration).
2. Annotate new controllers with `@RequirePermissions('payroll.…')`.
3. Optionally add a `PAYROLL_ADMIN` custom role via Settings → Roles — no code change.
