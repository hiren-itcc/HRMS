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
| Reports | `/reports` | — | ✅ (team) | ✅ | ✅ |
| Settings | `/settings` | — | — | ⚠ partial | ✅ |

Avatar menu: My profile · My sessions · Theme (light/dark/system) · Logout.
Global search (⌘K): employees, announcements, quick actions ("Apply leave", "Check in").

## UI screen list (Phase 1 — 38 screens)

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
| 15 | Directory | `/directory` | Card grid, search-first |
| 16 | Org chart | `/organization/chart` | Collapsible tree |
| 17 | Departments & designations | `/organization/departments` | Two-pane CRUD |
| 18 | Locations | `/organization/locations` | |
| 19 | Holiday calendar | `/organization/holidays` | Year view, location filter |

### Attendance (5)
| 20 | My attendance | `/attendance` | Month calendar + day drawer; regularize action |
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

### Settings (3)
| 36 | General settings | `/settings` | Org profile, timezone, attendance & leave policy values |
| 37 | Roles & permissions | `/settings/roles` | Matrix editor; system-role guardrails |
| 38 | Audit log | `/settings/audit` | Filterable trail |

### System states (every screen)
Loading = skeletons (no spinners on full pages) · Empty = illustration + primary action · Error = retry + support hint · Forbidden = 403 page with "request access" hint · Offline banner.

## UX rules applied (from ui-ux-pro-max, priority order)

1. **Accessibility:** all interactive elements keyboard-reachable; focus rings visible; contrast ≥ 4.5:1 in both themes; icon buttons have `aria-label`.
2. **Touch/interaction:** 44×44 min targets (check-in button is a large card); every mutation shows optimistic or pending feedback within 100 ms.
3. **Performance:** tables virtualized past 100 rows; skeletons reserve layout (CLS < 0.1); avatars lazy + WebP.
4. **Forms:** visible labels (no placeholder-as-label); inline errors adjacent to fields; multi-step forms show progress and preserve state on back.
5. **Navigation:** breadcrumb on all nested pages; browser back always works (dialogs/drawers sync to URL query params where stateful).
