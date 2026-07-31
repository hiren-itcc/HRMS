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

### Reports (`/reports`) — read-only aggregates; all accept `?format=json|csv`
| Path | Content |
|---|---|
| `/reports/headcount` | By department/location/type; joiners & leavers per month |
| `/reports/attendance-summary?month=` | Present/absent/late/WFH per employee |
| `/reports/leave-summary?year=` | Taken vs balance by type & department |
| `/reports/attrition?year=` | Exits, attrition %, tenure distribution |

### Settings & Admin (`/settings`, `/roles`, `/audit`)
| Method | Path |
|---|---|
| GET / PATCH | `/settings` — namespaced key-values |
| GET | `/roles` · GET `/permissions` — matrix data |
| PATCH | `/roles/:id/permissions` — edit grants (Admin; system-role guardrails) |
| GET | `/audit?entity=&actorId=&from=&to=` — audit trail (Admin) |

## Cross-cutting behavior

- **Scoping middleware:** every query passes through the tenant scope (`organizationId` from JWT) — enforced in services, verified by tests, so a future second tenant leaks nothing.
- **Approver resolution (Phase 1):** an employee's approver = their `manager`'s user; HR/Admin can act on anything they hold `*.approve` for. Multi-step approval chains are a future module (doc 11) — the `ApprovalStatus` machine already supports it.
- **Rate limits:** `auth/*` 5/min/IP; global 100/min/user (NestJS Throttler).
- **Swagger:** DTOs annotated; every endpoint tagged by module → the docs page is the API contract for the future mobile app.
