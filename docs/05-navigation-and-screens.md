# 6 & 9 — Navigation Structure & UI Screen List

Navigation is **role-aware**: one shell, items filtered by permissions from `GET /auth/me`. Per ui-ux-pro-max nav rules: sidebar groups ≤ 7 top-level items per role, predictable back behavior, every screen deep-linkable (URL is the state).

## Navigation structure

```
┌────────────────────────────────────────────────────────────────┐
│ Topbar:  [Org logo]  [Command palette ⌘K]  [Theme]             │
│                                            [Avatar ▾ menu]     │
├──────────────┬─────────────────────────────────────────────────┤
│ Sidebar      │  Content area (breadcrumb + page)               │
└──────────────┴─────────────────────────────────────────────────┘
```

Two things this wireframe used to show are not there. **There is no
notifications bell** — notifications were never built (doc 03). And ⌘K is a
*command palette*, not global search: it matches the sidebar entries and two
actions, and does not search employees, documents or announcements. Per-list
search boxes do that work.

### Sidebar by role

Finance sees the Employee column plus Payroll (org-wide) and Reports.

**As built** — a flat list, defined once in `apps/web/src/components/nav-items.ts`
and consumed by both the sidebar and the ⌘K palette. An item appears when the
caller holds **any** of its permissions *and* the organization has that module
switched on in Settings.

| Item | Route | Shown when |
|---|---|---|
| Dashboard | `/dashboard` | always |
| Employees | `/employees` | `employee.read` \| `employee.read.team` |
| Directory | `/directory` | `directory.read` — everyone |
| Organization | `/organization` | `org.read` |
| Attendance | `/attendance` | module on |
| Leave | `/leave` | module on |
| Documents | `/documents` | module on |
| Payroll | `/payroll` | any payroll read, incl. `.own` — every employee has a salary page |
| Announcements | `/announcements` | module on |
| Reports | `/reports` | `report.view` \| `report.view.team` |
| Settings | `/settings` | `settings.manage` \| `role.manage` \| `audit.read` \| `org.manage` |

Team and admin views are reached as **tabs inside their section**, not as
separate nav entries: `/attendance/team`, `/attendance/approvals`,
`/leave/approvals`, `/leave/settings`. The tab strip only renders when more than
one tab is permitted, so an employee sees no chrome for views they cannot open.

This differs from the original design in three ways worth recording, because the
routes in it were cited elsewhere:

- **No collapsible groups.** *My Space ▾ / My Team ▾ / People ▾* were specified;
  the list is flat. With 11 items and permission filtering already cutting it to
  4–6 for most roles, the groups earned nothing.
- **No `/team/*` routes.** They are `/attendance/team` and
  `/attendance/approvals`, which keeps every attendance screen under one prefix.
  `/leave/admin` is `/leave/settings`, and **`/attendance/admin` does not exist** —
  there is no admin attendance editor, only the team view.
- **Approvals are two inboxes, not one.** A unified leave + regularisation inbox
  was specified; leave and attendance each have their own.

Avatar menu: My profile · Active sessions · Theme (light/dark/system) · Logout.

## UI screen list

Numbered as originally specified, so references from other docs still resolve.
Rows struck through or marked **not built** are the gap between this list and
`apps/web/src/app` — 57 page files exist, but they are not the same 57.
[15-feature-audit.md](./15-feature-audit.md) is the reconciled view.

### Auth (4)
| # | Screen | Route | Notes |
|---|---|---|---|
| 1 | Login | `/login` | Email+password; error inline; rate-limit message |
| 2 | Forgot password | `/forgot-password` | Always-success messaging |
| 3 | Reset password | `/reset-password?token=` | Strength meter; expiry state |
| 4 | Accept invite | `/invite?token=` | Set password → auto-login |

### Dashboard (3 variants, one route)
| 5 | Employee dashboard | `/dashboard` | Check-in/out card w/ live timer, leave balances, pending requests, pinned announcements, who's-out-today |
| 6 | Manager add-ons | ″ | + team presence strip, approvals inbox count |
| 7 | HR/Admin add-ons | ″ | + headcount stat tiles, today's absence/late list, joiners this month |

### Employees & profile (7)
| 8 | Employee list | `/employees` | Table: filter dept/location/status. **Saved views and CSV export are not built.** |
| 9 | Add employee | `/employees/new` | Single form, not a stepper. Creates the record and, by default, a login on the shared default password (doc 07) |
| 10 | Employee detail | `/employees/:id` | Contact, job, role, invite state, bank, documents, letters, direct reports. **No attendance or leave tab** — the endpoint for it exists and nothing calls it |
| 11 | Edit employee | `/employees/:id/edit` | HR fields; audit note on save |
| 12 | Offboard dialog | (modal on screen 10) | On notice / exited / withdraw a resignation, with an exit date and the consequences listed. Distinct from Delete, which archives the record |
| 13 | My profile | `/profile` | Self-editable subset: phone, personal email, address, and emergency contacts (add/remove, saved with the rest) |
| 14 | My sessions | `/profile/sessions` | Devices still able to refresh, newest first, with the current one marked; sign out any of them. Reached from the avatar menu |

### Onboarding (4)

The path for a new hire. Screen 9 is for staff who already work here; these are
for somebody joining, who has no work mailbox yet.

| # | Screen | Route | Notes |
|---|---|---|---|
| 8a | Invite a hire | `/employees/onboard` | Name, personal email, work email, join date, job details. Sends the invitation; a send failure is shown with the reason and the invite can be resent |
| 8b | Review queue | `/employees/onboarding` | Submissions with status chips. Note: the search box on this screen is inert |
| 8c | Review one | `/employees/onboarding/[id]` | Profile, bank and documents submitted by the hire, plus editable job details. Approve or send back with a note. The reviewer cannot edit what the hire submitted — only ask for changes |
| 8d | Hire's own intake | `/onboarding` | Profile → bank → required documents → submit. **Not in the sidebar**: the dashboard layout redirects any account with `EmployeeStatus.ONBOARDING` here, and `OnboardingGuard` refuses everything else |

### Directory & org (5)
| 15 | Directory | `/directory` | Card grid, search-first; every role. Work contact details only — the HR record stays on screen 10 behind `employee.read` |
| 15a | Colleague profile | `/directory/:id` | Name, job title, department, work email/phone, location, who they report to |
| 16 | Org chart | `/organization/chart` | Collapsible tree with a per-node count of everybody below. Search filters by name, code, title or department and expands to the hit. Several roots are normal |
| 17 | Departments & designations | `/organization/departments`, `/organization/designations` | Separate tabs, one CRUD table each — not two-pane. Employment types and shifts have their own tabs |
| 18 | Locations | `/organization/locations` | Includes the attendance geofence: coordinates and a radius, both optional |
| 19 | Holiday calendar | `/organization/holidays` | Year view, location filter |

### Attendance (5)
| 20 | My attendance | `/attendance` | Month calendar + day drawer listing that day's sessions with where each was worked; regularize action; open sessions on a past day flagged |
| 21 | Team attendance | `/attendance/team` | Day view + monthly summary, department filter. Route sits under `/attendance`, not `/team` |
| 22 | ~~Attendance admin~~ | `/attendance/admin` | **Not built.** Screen 21 is view-only and the API has no edit endpoint. Shifts CRUD lives at `/organization/shifts` |
| 23 | Regularization form | (drawer) | Date, in/out, reason |
| 24 | Approvals inbox | `/attendance/approvals`, `/leave/approvals` | **Two inboxes, not one.** Unified was specified; each module got its own |

### Leave (5)
| 25 | My leave | `/leave` | Balance cards + request history |
| 26 | Apply leave | (drawer) | Type→dates→days auto-calc (holidays/week-offs excluded), balance preview |
| 27 | Leave calendar | `/leave/calendar` | Month grid of who's out (scope-filtered) |
| 28 | Leave admin | `/leave/settings` | Types CRUD + per-employee balances with an audited adjust dialog. Route is `/leave/settings`, not `/leave/admin` |
| 29 | Leave types config | — | Folded into screen 28 rather than its own route |

### Documents & letters (6)

One sidebar entry, four tabs, each gated by `can(...)` — the same arrangement
payroll uses. "My documents" and "everyone's documents" are visibly different
places rather than one screen that quietly shows you less.

| 30 | My documents | `/documents` | Own files only, every role; upload |
| 30a | My letters | `/documents/letters` | Own issued letters; `letter.read.own` |
| 31 | Document admin | `/documents/admin` | Across every employee, filter by person/folder; `document.read` |
| 32 | Folders | `/documents/folders` | Create and delete only — **rename is not wired**, though the endpoint and client method both exist; `document.manage` |
| 32a | Letter | `/letters/:id` | The issued document — print to PDF, void with a reason |
| 32b | Letter templates | `/settings/letters` | Edit the shipped templates; `letter.template.manage` |

### Exits (4)

One nav entry, three tabs, plus a permalink. Resignations and offboardings are
tabs rather than two sidebar items: the nav is a flat eleven-item list, and
somebody looking for "who is leaving" should not have to know first whether
they resigned or were let go.

| # | Screen | Route | Who |
|---|---|---|---|
| 1 | My resignation — notice owed, file, amend, withdraw | `/resignations` | everyone |
| 2 | Approvals inbox — defaults to "waiting on me" | `/resignations/approvals` | `resignation.approve` / `.approve.team` |
| 3 | Offboarding — everybody leaving, whatever the reason | `/resignations/offboarding` | `employee.offboard` |
| 4 | Resignation detail — stepper, decisions, offboarding, history | `/resignations/[id]` | read scope on the record |

Probation and notice period also appear as a **Lifecycle card** on the employee
record (screen: Employees & profile), with Confirm and Extend behind
`employee.confirm`, and as four tiles on the dashboard.

### Exits (4)

One nav entry, three tabs, plus a permalink. Resignations and offboardings are
tabs rather than two sidebar items: the nav is a flat eleven-item list, and
somebody looking for "who is leaving" should not have to know first whether
they resigned or were let go.

| # | Screen | Route | Who |
|---|---|---|---|
| 1 | My resignation — notice owed, file, amend, withdraw | `/resignations` | everyone |
| 2 | Approvals inbox — defaults to "waiting on me" | `/resignations/approvals` | `resignation.approve` or `.approve.team` |
| 3 | Offboarding — everybody leaving, whatever the reason | `/resignations/offboarding` | `employee.offboard` |
| 4 | Resignation detail — stepper, decisions, offboarding, history | `/resignations/[id]` | read scope on the record |

Probation and notice period also appear as a **Lifecycle card** on the employee
record, with Confirm and Extend behind `employee.confirm`, and as four tiles on
the dashboard.

### Announcements (2)
| 33 | Feed | `/announcements` | Pinned first; unread markers; audience chips |
| 34 | Compose/edit | (dialog on the feed) | Markdown editor, audience picker, schedule, read receipts view. No `/announcements/new` route and no permalink for a single post |

### Reports (1 hub + 4 views)
| 35 | Reports hub | `/reports` | Four tabs: Employees · Attendance · Leave · **Departments**. Each has date-range presets, a department filter, KPIs, chart, paged table and CSV/Excel export behind `report.export`. **Attrition** was specified as the fourth and is folded into the employees report rather than standing alone; the departments rollup took its place |

### Payroll (9)
| # | Screen | Route | Notes |
|---|---|---|---|
| 36 | Runs | `/payroll` | KPI tiles + one row per month; open a month from here |
| 37 | Run detail | `/payroll/[runId]` | Progress rail, state actions (only those legal *and* permitted), preflight warnings, payslip table, bulk payment bar |
| 38 | Salaries | `/payroll/salaries` | Roster with current CTC; assign or revise in a dialog |
| 39 | Salary timeline | `/payroll/salaries/[employeeId]` | Every revision, each with its delta and percentage |
| 40 | Structures | `/payroll/structures` | Reusable earning/deduction templates; create, edit, clone; delete blocked while assigned (deactivate instead) |
| 40a | Structure editor | `/payroll/structures/new` · `/payroll/structures/[id]` | Name, code, active toggle and the ordered component lines; one line absorbs the balance |
| 41 | Payroll reports | `/payroll/reports` | Register · bank transfer · PF · ESI · tax · department, with CSV/Excel export |
| 42 | Payslip | `/payroll/payslips/[id]` | The document — earnings vs deductions, employer cost set apart, print to PDF |
| 43 | My salary | `/payroll/me` | Employee self-service: current CTC, revision history, own published payslips |
| 44 | Payroll preferences | `/settings/preferences` | Currency, pay day, LOP basis, PF/ESI/PT rules (part of the settings screen) |

The run detail screen is the one worth describing precisely: it renders only
the actions legal from the current state **and** permitted to the signed-in
person. That mirrors the server state machine rather than replacing it — the
API is still the authority, the UI simply does not offer a button that would be
refused. Locked and published runs carry a banner saying so and pointing at the
next run as the place to correct a mistake.

### Settings (3)
| 45 | General settings | `/settings` | Org profile, timezone, attendance, leave & payroll policy values |
| 46 | Roles & permissions | `/settings/roles` | Matrix editor; system-role guardrails |
| 47 | Audit log | `/settings/audit` | Filterable trail |

### System states (every screen)
Loading = skeletons (no spinners on full pages) · Empty = illustration + primary action · Error = retry + support hint · Forbidden = 403 page with "request access" hint · Offline banner.

## UX rules applied (from ui-ux-pro-max, priority order)

1. **Accessibility:** all interactive elements keyboard-reachable; focus rings visible; contrast ≥ 4.5:1 in both themes; icon buttons have `aria-label`.
2. **Touch/interaction:** 44×44 min targets (check-in button is a large card); every mutation shows optimistic or pending feedback within 100 ms.
3. **Performance:** tables virtualized past 100 rows; skeletons reserve layout (CLS < 0.1); avatars lazy + WebP.
4. **Forms:** visible labels (no placeholder-as-label); inline errors adjacent to fields; multi-step forms show progress and preserve state on back.
5. **Navigation:** breadcrumb on all nested pages; browser back always works (dialogs/drawers sync to URL query params where stateful).
