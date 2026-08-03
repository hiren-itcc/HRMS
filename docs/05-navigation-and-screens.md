# 6 & 9 — Navigation Structure & UI Screen List

Navigation is **role-aware**: one shell, items filtered by permissions from `GET /auth/me`. Per ui-ux-pro-max nav rules: sidebar groups ≤ 7 top-level items per role, predictable back behavior, every screen deep-linkable (URL is the state).

## Navigation structure

```
┌────────────────────────────────────────────────────────────────┐
│ Topbar:  [Org logo]  [Global search ⌘K]   [🔔 Notifications]   │
│                                            [Avatar ▾ menu]     │
├──────────────┬─────────────────────────────────────────────────┤
│ Sidebar      │  Content area (breadcrumb + page)               │
└──────────────┴─────────────────────────────────────────────────┘
```

### Sidebar by role

Finance sees the Employee column plus Payroll (org-wide) and Reports.

| Item | Route | EMPLOYEE | MANAGER | HR | ADMIN |
|---|---|:-:|:-:|:-:|:-:|
| Dashboard | `/dashboard` | ✅ | ✅ | ✅ | ✅ |
| My Space ▾ | | ✅ | ✅ | ✅ | ✅ |
| — Attendance | `/attendance` | ✅ | ✅ | ✅ | ✅ |
| — Leave | `/leave` | ✅ | ✅ | ✅ | ✅ |
| — Documents | `/documents` | ✅ | ✅ | ✅ | ✅ |
| My Team ▾ | | — | ✅ | — | — |
| — Team attendance | `/team/attendance` | — | ✅ | — | — |
| — Approvals | `/team/approvals` | — | ✅ | — | — |
| People ▾ | | — | — | ✅ | ✅ |
| — Employees | `/employees` | — | — | ✅ | ✅ |
| — Attendance admin | `/attendance/admin` | — | — | ✅ | ✅ |
| — Leave admin | `/leave/admin` | — | — | ✅ | ✅ |
| Directory | `/directory` | ✅ | ✅ | ✅ | ✅ |
| Announcements | `/announcements` | ✅ | ✅ | ✅ | ✅ |
| Organization | `/organization` | — | — | ✅ | ✅ |
| Payroll | `/payroll` | ✅ (own) | ✅ (team) | ✅ | ✅ |
| Reports | `/reports` | — | ✅ (team) | ✅ | ✅ |
| Settings | `/settings` | — | — | ⚠ partial | ✅ |

Avatar menu: My profile · My sessions · Theme (light/dark/system) · Logout.
Global search (⌘K): employees, announcements, quick actions ("Apply leave", "Check in").

## UI screen list (47 screens)

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
| 8 | Employee list | `/employees` | Table: filter dept/location/status, saved views, CSV export |
| 9 | Add employee | `/employees/new` | Multi-step form: personal → job → invite |
| 10 | Employee detail | `/employees/:id` | Tabs: Overview · Job · Attendance · Leave · Documents |
| 11 | Edit employee | `/employees/:id/edit` | HR fields; audit note on save |
| 12 | Offboard dialog | (modal) | Status, exit date, confirmation with consequences listed |
| 13 | My profile | `/profile` | Self-editable subset; emergency contacts |
| 14 | My sessions | `/profile/sessions` | Device list; revoke |

### Directory & org (5)
| 15 | Directory | `/directory` | Card grid, search-first; every role. Work contact details only — the HR record stays on screen 10 behind `employee.read` |
| 15a | Colleague profile | `/directory/:id` | Name, job title, department, work email/phone, location, who they report to |
| 16 | Org chart | `/organization/chart` | Collapsible tree |
| 17 | Departments & designations | `/organization/departments` | Two-pane CRUD |
| 18 | Locations | `/organization/locations` | |
| 19 | Holiday calendar | `/organization/holidays` | Year view, location filter |

### Attendance (5)
| 20 | My attendance | `/attendance` | Month calendar + day drawer listing that day's sessions; regularize action; open sessions on a past day flagged |
| 21 | Team attendance | `/team/attendance` | Day/week matrix of reports |
| 22 | Attendance admin | `/attendance/admin` | Org day view; edit (audited); shifts CRUD |
| 23 | Regularization form | (drawer) | Date, in/out, reason |
| 24 | Approvals inbox | `/team/approvals` | Unified: leave + regularization; approve/reject with note |

### Leave (5)
| 25 | My leave | `/leave` | Balance cards + request history |
| 26 | Apply leave | (drawer) | Type→dates→days auto-calc (holidays/week-offs excluded), balance preview |
| 27 | Leave calendar | `/leave/calendar` | Month grid of who's out (scope-filtered) |
| 28 | Leave admin | `/leave/admin` | All requests, types CRUD, balance adjust (audited) |
| 29 | Leave types config | `/leave/admin/types` | |

### Documents (3)
| 30 | My documents | `/documents` | Own + org-visible; upload |
| 31 | Document admin | `/documents/admin` | By employee/category; bulk upload |
| 32 | Categories config | (modal) | |

### Announcements (2)
| 33 | Feed | `/announcements` | Pinned first; unread markers; audience chips |
| 34 | Compose/edit | `/announcements/new` | Markdown editor, audience picker, schedule, read receipts view |

### Reports (1 hub + 4 views)
| 35 | Reports hub | `/reports` | Headcount · Attendance summary · Leave summary · Attrition; each: filters, chart + table, CSV export |

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
