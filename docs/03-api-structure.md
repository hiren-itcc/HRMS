# 5 — API Structure

Base URL: `/api/v1` (versioned from day one). OpenAPI served at `/api/docs` (Swagger UI, non-production only unless authenticated).

## Conventions

- **Auth:** `Authorization: Bearer <access-token>` on every route except `auth/*` public endpoints. Refresh token travels only as an httpOnly cookie (web) or request body (future mobile).
- **Permissions:** each route declares `@RequirePermissions('resource.action')` (doc 04). "Self" endpoints (`/me/...`) bypass the matrix — they are scoped by the JWT subject.
- **Envelope:** success returns the resource directly; errors return RFC-7807-style `{ statusCode, error, message, details? }`. No `{ success: true }` wrappers.
- **Lists:** `?page=&limit=&sort=&order=&search=` + module-specific filters. Response: `{ data: T[], meta: { page, limit, total } }`.
- **Dates:** ISO-8601 UTC in transport; date-only fields as `YYYY-MM-DD`.
- **Idempotency:** check-in/out and approval actions are idempotent (repeating returns current state, not an error).

## Endpoints by module

### Auth (`/auth`) — public unless noted
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Email + password → access token + refresh cookie |
| POST | `/auth/refresh` | Rotate refresh token → new pair |
| POST | `/auth/logout` | Revoke current session (authed) |
| POST | `/auth/forgot-password` | Send reset email (always 200) |
| POST | `/auth/reset-password` | Token + new password |
| POST | `/auth/accept-invite` | Invite token + password → activates user |
| GET | `/auth/me` | Current user + role + permissions + employee summary (authed) |
| GET | `/auth/sessions` · DELETE `/auth/sessions/:id` | List / revoke own sessions (authed) |

### Organization (`/organization`)
| Method | Path |
|---|---|
| GET / PATCH | `/organization` — profile, timezone, logo |
| GET / POST | `/organization/departments` · GET/PATCH/DELETE `/organization/departments/:id` |
| GET / POST | `/organization/designations` · PATCH/DELETE `/organization/designations/:id` |
| GET / POST | `/organization/locations` · PATCH/DELETE `/organization/locations/:id` |
| GET / POST | `/organization/holidays` · PATCH/DELETE `/organization/holidays/:id` |
| GET | `/organization/chart` — org-chart tree (department → employees) |

### Employees (`/employees`)
| Method | Path |
|---|---|
| GET | `/employees` — list (filters: department, location, status, type, search) |
| POST | `/employees` — create record (optionally `sendInvite: true`) |
| GET / PATCH | `/employees/:id` |
| DELETE | `/employees/:id` — soft delete (Admin only) |
| POST | `/employees/:id/invite` — (re)send login invite |
| POST | `/employees/:id/offboard` — set ON_NOTICE/EXITED + exitDate |
| GET | `/employees/:id/reports` — direct reports |
| GET / PATCH | `/me/profile` — self view/edit of editable subset (phone, address, emergency contacts) |

### Attendance (`/attendance`)
| Method | Path |
|---|---|
| POST | `/attendance/check-in` · POST `/attendance/check-out` — self, idempotent |
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
| GET | `/documents?employeeId=&categoryId=` — scoped: self sees own + ORG-visible |
| GET | `/documents/:id/download` — permission check → 302 to signed URL |
| DELETE | `/documents/:id` — soft delete |

### Announcements (`/announcements`)
| Method | Path |
|---|---|
| GET | `/announcements` — audience-filtered for caller, pinned first |
| POST | `/announcements` · PATCH/DELETE `/announcements/:id` |
| POST | `/announcements/:id/read` — mark read |
| GET | `/announcements/:id/reads` — read receipts (author/HR) |

### Notifications (`/notifications`)
| GET `/notifications?unread=` · POST `/notifications/read-all` · POST `/notifications/:id/read` |

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
(`yearStartMonth`, `allowNegativeBalance`) and `modules`; each is stored as one
`Setting` row so patching one never rewrites another.

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
