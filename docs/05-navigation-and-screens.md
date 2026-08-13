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
| Attendance | `/attendance` | module on — includes the Remote work tab |
| Leave | `/leave` | module on |
| Documents | `/documents` | module on |
| Payroll | `/payroll` | any payroll read, incl. `.own` — module on; every employee has a salary page |
| Assets | `/assets` | `asset.read` — module on |
| Expenses | `/expenses` | any expense read, incl. `.own` — module on |
| Performance | `/performance` | any performance read, incl. `.own` — module on |
| Projects | `/projects` | `project.read` \| `project.read.own` — module on |
| Recruitment | `/recruitment` | `recruitment.read` \| `recruitment.read.team` |
| Exits | `/resignations` | any resignation read, incl. `.own` — no module flag |
| Helpdesk | `/helpdesk` | any helpdesk read, incl. `.own` — module on |
| Announcements | `/announcements` | module on |
| Reports | `/reports` | `report.view` \| `report.view.team` — module on |
| Settings | `/settings` | `settings.manage` \| `role.manage` \| `audit.read` \| `org.manage` |

Team and admin views are reached as **tabs inside their section**, not as
separate nav entries: `/attendance/team`, `/attendance/approvals`,
`/leave/approvals`, `/leave/settings`. The tab strip only renders when more than
one tab is permitted, so an employee sees no chrome for views they cannot open.

This differs from the original design in three ways worth recording, because the
routes in it were cited elsewhere:

- **No collapsible groups.** *My Space ▾ / My Team ▾ / People ▾* were specified;
  the list is flat. With 18 items and permission filtering already cutting it to
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
`apps/web/src/app` — 104 page files exist, and they are not the same set.
[15-feature-audit.md](./15-feature-audit.md) is the reconciled view.

### Auth (4)
| # | Screen | Route | Notes |
|---|---|---|---|
| 1 | Login | `/login` | Email+password; error inline; rate-limit message |
| 2 | Forgot password | `/forgot-password` | Always-success messaging |
| 3 | Reset password | `/reset-password?token=` | Strength meter; expiry state |
| 4 | Accept invite | `/invite?token=` | Set password → auto-login |

### Dashboard (3 variants, one route)
| 5 | Employee dashboard | `/dashboard` | Check-in/out card w/ live timer, **Leave days left · Your requests · Present this month**, announcements, upcoming holidays, **celebrations** |
| 6 | Manager add-ons | ″ | + Waiting on you, Present/Remote/Late today, Leaving, On probation |
| 7 | HR/Admin add-ons | ″ | + Total employees; Finance additionally sees Payroll |

The tiles are ordered by **urgency, not by module**: what is waiting on you,
then money that is stuck, then today, then the slower people figures. A tile
earns its place by being something somebody acts on — which is why Departments
and Locations were removed, having never once changed and having cost a list
call each on every load purely to read `meta.total`.

**Your own figures fill the row when nothing organizational does.** Every tile
in rows 6 and 7 is about the organization, so an employee — the largest role in
the product — arrived at an empty row. They now get three tiles of their own:
leave still bookable this year, requests they are waiting on somebody else to
decide, and days present this month. A manager does not get them on top: their
row is already a list of things waiting on them, and their own leave balance is
not the most urgent item on it.

One call feeds them all (`/dashboard/summary`), and every figure comes back
null when the caller may not see it, so a tile checks for null rather than
re-deriving a permission. The page makes three requests, or four for somebody
with no team, whose own month comes from `/attendance/me` — the same key the
attendance page uses, so opening it afterwards costs nothing.

**Celebrations** — birthdays and work anniversaries in the next 30 days — sit
beside the holidays panel and are visible to everyone, because the point of the
panel is that colleagues wish each other well. Birthdays show a day and a month
and **never an age**: the API sends no birth year, so there is nothing on the
client to derive one from.

### Employees & profile (7)
| 8 | Employee list | `/employees` | Table: filter dept/location/status. **Saved views and CSV export are not built.** |
| 9 | Add employee | `/employees/new` | Single form, not a stepper. Creates the record and, by default, a login on the shared default password (doc 07) |
| 10 | Employee detail | `/employees/:id` | Contact, job, role, invite state, bank, documents, letters, direct reports. **No attendance or leave tab** — the endpoint for it exists and nothing calls it |
| 11 | Edit employee | `/employees/:id/edit` | HR fields; audit note on save |
| 12 | Offboard dialog | (modal on screen 10) | On notice / exited / withdraw a resignation, with an exit date and the consequences listed. Distinct from Delete, which archives the record |
| 13 | My profile | `/profile` | Profile photo, plus the self-editable subset: phone, personal email, address, and emergency contacts (add/remove, saved with the rest) |
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
| 16 | Org chart | `/organization/chart` | Top-down boxed cards with connectors from `md` up, the same tree as an indented list below it. Rooted on a card carrying the company name, so several people with no manager hang off one thing instead of being laid out in a row. **One branch open at a time**; opens to the top level only. Per-node count of everybody below; search opens the path down to a hit and steps through the rest |
| 17 | Departments & designations | `/organization/departments`, `/organization/designations` | Separate tabs, one CRUD table each — not two-pane. Employment types and shifts have their own tabs |
| 18 | Locations | `/organization/locations` | Includes the attendance geofence: coordinates and a radius, both optional |
| 19 | Holiday calendar | `/organization/holidays` | Year view, location filter |

**The org chart is a picture, not a canvas.** The connectors are CSS
pseudo-elements on the `<li>`s, so what a screen reader walks is still a nested
list and the chevrons are still buttons in the normal tab order. Below `md` the
connectors switch off and it is the indented list it has always been, which is
the only shape a deep tree has ever had on a phone. It scrolls sideways rather
than squashing — a wide org is wide, and shrinking the cards to fit would make
none of them readable.

**A top-down chart cannot expand everything, and that is structural.** The
width of a level is the sum of every expanded branch in it, so opening the
whole company puts most of it off the side of the screen. One branch is open at
a time: opening a card closes whatever else was, and search opens the way *down
to* a match rather than opening everything to find it. The first version did
expand everything and was unusable at twenty-three people.

**The card has to be centred in its `<li>`, or nothing lines up.** An `li` is
as wide as the subtree beneath it while the card has a fixed width, and the
connectors are drawn at the li's midpoint — so a left-aligned card and a
centred rule never meet. `align-items: center` is the whole geometry; it is one
line and it is load-bearing.

**Photos.** `EmployeeAvatar` is the only thing that renders one, in all twelve
places a face appears. The bytes come through the API with the access token,
because the bucket is private, so the component caches the *blob* under the
photo's own path — somebody in the employee list, the directory and the org
chart costs one request, not three — and creates the object URL per mount so
none of them leak. No photo means no request at all, which matters in a fresh
workspace where that is almost everybody.

On My profile and the employee record the photo **is** the control that changes
it; a separate upload field beside a picture of the current one is two things
saying the same thing. It is squared and shrunk to a 512px WebP in the browser,
with the EXIF rotation applied — otherwise every portrait photo would be stored
on its side, permanently.

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

### Exits (5)

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
| 5 | Exit detail — frozen snapshot, clearance sign-off, exit interview, settlement card, history | `/resignations/offboarding/[id]` | `employee.offboard` |

The **settlement card** on screen 5 gates itself on `payroll.read` and does not
call the API without it — an exit page that shows a colleague's payout to every
HR user is a leak. It is also where a settlement is started, because this is the
screen with the last working day and the clearance in front of it.

Probation and notice period also appear as a **Lifecycle card** on the employee
record (screen: Employees & profile), with Confirm and Extend behind
`employee.confirm`, and as four tiles on the dashboard.

### Work from home (1)
| # | Screen | Route | Notes |
|---|---|---|---|
| 50 | Remote work | `/attendance/remote` | A tab under Attendance carrying both halves: my requests, and — for a manager — the ones waiting on them. One screen rather than two nav entries, because they are the same question from two sides |

The apply dialog previews as soon as both dates are set: how many working days
the range really covers, and which week it would fill. Submit stays disabled
while a breach stands, with the reason in an alert beside it.

Plus **the flag**: an `Unplanned` badge on any `WFH` day with no approved
request behind it, on the month calendar, the team day view and the employee
record's attendance card. Only unapproved days are labelled — badging the
approved ones would put a chip on nearly every remote day, which is how a
signal stops being one.

The per-employee allowance appears on the Lifecycle card beside notice period
and probation, and only when they have one of their own.

### Assets (3 + 2 cards)
| # | Screen | Route | Notes |
|---|---|---|---|
| 47 | Register | `/assets` | Search by tag, serial or name; category and status filters; add dialog. Adding is blocked with a link to Categories when there are none, because an asset must be filed under one |
| 48 | Asset detail | `/assets/[id]` | Its facts, the current holder, every spell somebody held it, and issue / take back / change status. The status dialog offers only what is legal from where the asset is |
| 49 | Categories | `/assets/categories` | One CRUD table with a count per category; removal refused while assets are filed under it |

Plus **"Issued to me"** on `/profile` (`asset.read.own`, read-only, and
deliberately *not* linked to the register — an employee holds no `asset.read`,
so a link would land them on a refusal), and a **Company assets** card on the
employee record (`asset.read`, and it does not call the API without it).

On the exit page, a clearance item with `kind: ASSET_RETURN` renders the
outstanding items **by tag** instead of a checkbox, each linking to the asset.
"2 outstanding" would send somebody hunting for which two. Its *Clear* button is
not rendered at all — the API refuses a hand-tick — while *Not applicable*
stays, because waiving with a reason is the honest escape hatch.

### Expenses (4)

Absent from this document until Performance shipped, which is its own small
lesson: the module landed with a sidebar row added to the table above and no
screen list underneath.

| # | Screen | Route | Notes |
|---|---|---|---|
| 49a | My claims | `/expenses` | Own claims, newest first. A claim is a batch of lines, because that is how people spend — one trip is a flight, two taxis and three meals, agreed or declined as one thing |
| 49b | Claim detail | `/expenses/[id]` | The lines, the receipts, and the decision trail. "Approved" and "paid" are separate badges: the second is whether the payroll run carrying it was published |
| 49c | Approvals | `/expenses/approvals` | Finance sees everything, a manager sees their own reports. Reviewing opens a panel below the table rather than navigating — which is why its row action is an eye labelled *Review*, not *View* |
| 49d | Categories | `/expenses/categories` | `expense.manage` only. A category names the payslip line a claim pays out on, so this is choosing where company money leaves from |

### Performance (4)
| # | Screen | Route | Notes |
|---|---|---|---|
| 49e | My performance | `/performance` | The open cycle, my goals with their weights and progress, and what the cycle wants from me right now. The weight ledger stays silent when nothing is weighted — an unweighted goal set is a legitimate choice |
| 49f | Team | `/performance/team` | Defaults to *waiting on me*, because the inbox exists to answer "what needs me". An unassigned review says **Not assigned** in words rather than showing a blank: it is stuck, not merely empty |
| 49g | Review | `/performance/reviews/[id]` | The two-sided screen. Write controls come from payload flags, not from `can()` — and the manager half is absent from the payload entirely until it is shared, so it cannot be leaked by a component that renders it and hides it |
| 49h | Cycles | `/performance/cycles` | `performance.manage`. Opening enrols everybody eligible and is safe to repeat — running it again picks up whoever joined since, which is also how a late joiner gets in |

### Helpdesk (4)
| # | Screen | Route | Notes |
|---|---|---|---|
| 49i | My tickets | `/helpdesk` | Newest first — your own list is read from the top. Raising one asks for a desk, a subject and what you need, and **not a priority**: a priority the person asking controls is one that is always urgent |
| 49j | One ticket | `/helpdesk/[id]` | Every control comes from a `can*` flag on the payload, never from the status, so a button that renders cannot be one the API would refuse. Internal notes carry a badge saying in words that the requester cannot see them — the requester never receives one, so the label is for the agent, who needs to know which entries the other person can read |
| 49k | The desk | `/helpdesk/queue` | Oldest first, which is why this module has no SLA: a queue is worked from the bottom. Yours plus unassigned; **Everyone's tickets** appears only with `helpdesk.read`, because working the desk and reading every grievance in the company are different grants |
| 49l | Categories | `/helpdesk/categories` | `helpdesk.manage`. A desk with tickets against it is deactivated, not deleted. The default assignee must hold `helpdesk.respond` — the API refuses otherwise, because a desk routing to somebody who cannot answer goes quiet without anybody noticing |

### Screens the tables above missed

Eleven pages existed without a row anywhere in this document. Recorded here
rather than threaded into the numbered sections, because the numbering is
historical and renumbering it would break every citation.

| Screen | Route | Notes |
|---|---|---|
| Root redirect | `/` | Sends an unauthenticated visitor to `/login`. Not a screen, but it is a page file |
| Careers | `/careers` | **Public, no token.** Published openings only |
| One opening | `/careers/[slug]` | Public. Apply form accepting a CV. 404 for closed and unpublished alike, and the same success is reported to a repeat applicant |
| Announcement permalink | `/announcements/[id]` | A single post, linkable. Composing is still a dialog on the feed, and `/announcements/new` still does not exist |
| Bulk employee import | `/employees/import` | `employee.import`. Download a template, upload, preview what would happen, then commit |
| Employment types | `/organization/employment-types` | `org.manage`. A tab beside Shifts |
| Pay components | `/payroll/components` | `payroll.structure.manage`. The catalogue every salary structure line points at |
| Attendance report | `/reports/attendance` | A tab of the Reports hub, and its own page file |
| Leave report | `/reports/leave` | idem |
| Department report | `/reports/departments` | idem. Its "Head" column is permanently `—` until `Department.headId` becomes writable |
| Email templates | `/settings/email` | `settings.manage`. Per-template subject and body, plus the switch that turns a notification email off |

### Income tax (4)

Inside the Payroll tab bar at `/payroll/tax`, not a top-level entry — it is a
payroll surface, and the employee half belongs beside "My salary".

| # | Screen | Route | Notes |
|---|---|---|---|
| 49r | My income tax | `/payroll/tax` | Regime radio, then the six figures that answer "why is this much coming out of my pay" — projected income, taxable income, annual tax, deducted, remaining, this month. The remaining-months divisor is **stated**, because a monthly figure without it reads as arbitrary. New regime shows "no declaration required" and stops there |
| 49s | Everyone's tax | `/payroll/tax/employees` | `payroll.tax.view`. Filters by year, regime, declaration status and department. A **dash rather than a zero** wherever the year has no confirmed slabs: "no rules entered" and "no tax due" must not render the same |
| 49t | One person's tax | `/payroll/tax/employees/[id]` | The working, slab by slab, plus the declaration with declared/eligible/approved side by side and the month-by-month TDS history. `payroll.tax.manage` also gets the override panel, which says in words that it is an exception rather than the workflow |
| 49v | Tax rules | `/payroll/tax/rules` | `payroll.tax.manage`. The year's bands, allowances and source. Contiguity is warned about while typing and refused on save — a gap between two bands silently under-taxes and nothing downstream notices. Editing a year with published payroll asks first, naming the runs and the amount already deducted |
| 49u | Declarations to review | `/payroll/tax/approvals` | `payroll.tax.declaration.approve`. Declared beside eligible on every line, because the gap is what HR is agreeing. **Send back is disabled until a note is typed** — the API refuses it anyway |

### Projects and timesheets (5)

One nav entry rather than two, with the tabs gating themselves. The paths do
not mirror the API — timesheets live at `/timesheets` there, because a week
spans projects and must not be nested under one, but they belong behind the
Projects entry on screen.

| # | Screen | Route | Notes |
|---|---|---|---|
| 49m | Projects | `/projects` | The register. `project.read` sees every project; everybody else sees the ones they are on or run — the API decides that, and asking for `all` without the permission quietly returns `own` rather than failing |
| 49n | One project | `/projects/[id]` | Dates, status, owner, and the member table. The staffing buttons appear for HR **and** for the project's own manager, because the API grants the second without `project.manage` — hiding them from somebody the API would let through is the mismatch this screen has to avoid |
| 49o | My timesheet | `/projects/timesheet` | Projects down, days across. A cell outside the membership window is **disabled rather than merely refused on submit**, which explains the window without a paragraph about it, and a day totalling over 24 turns red in the footer before anybody presses Submit. An empty cell is not zero: zero hours is a claim that somebody worked none, and the API refuses it |
| 49p | Approvals | `/projects/approvals` | Submitted weeks from my reports. Reviewing opens a panel below the table rather than navigating. **Send back is disabled until a note is typed** — the API refuses it anyway, and a refusal you could have been shown first is a wasted round trip |
| 49q | Utilisation | `/projects/utilisation` | `project.read`. Hours per person and per project over a range, against a 40-hour week. Drafts and sent-back weeks are excluded and the page says so — a figure built from hours nobody has stood behind changes the moment somebody opens their timesheet. Over 100% is shown rather than capped, because over-allocation is the thing worth seeing |

### Recruitment (5)
| # | Screen | Route | Notes |
|---|---|---|---|
| 50 | Openings | `/recruitment` | Search by title, status filter, and a live-application count against the headcount — how many people are in this pipeline *now*, not how many ever applied. Raising one is a dialog; it starts as a draft |
| 51 | Opening pipeline | `/recruitment/openings/[id]` | The four live stages as columns, candidates as cards. Per card: expected pay, notice, interviews so far, and the offer if there is one. Actions are explicit buttons rather than drag-and-drop, so each one is reachable from a keyboard and says what it does |
| 52 | Candidates | `/recruitment/candidates` | The pool. One record per person, not per application — the email is unique per organization, which is what makes a re-applicant the same human |
| 53 | Candidate | `/recruitment/candidates/[id]` | Their details, every application, every interview and what was said. Feedback is written here, and says on its face that submitting freezes it |
| 54 | Offer | `/recruitment/offers/[id]` | The agreed job and pay, mark-as-sent, record-their-answer, and **Hire** |

**The endings are not columns.** REJECTED, WITHDRAWN and HIRED get a *Closed
out* list below the board with the reason beside each name, rather than a card
still sitting in the pipeline pretending to be in play.

**The move dialog does not offer HIRED.** Hiring is not something you choose
there; it is what converting an accepted offer produces. Listing it would put a
control on screen whose only outcome is a refusal.

**The hire dialog asks for one thing** — the work email — and prints the start
date and the pay it is about to use underneath, because everything else comes
off the offer and the candidate. It says the invite is going to the *personal*
address, since the work mailbox is created by this very act. Afterwards it
reports whether the mail actually went: `onboard()` deliberately does not fail
the hire when it does not, and "done" and "done, now go and chase this" are
different sentences.

**An opening with no band advertised shows "Not advertised", never ₹0.** The
API sends `null` rather than zero for exactly this reason, and the seed carries
one such opening so the case is always on screen.

### Announcements (2)
| 33 | Feed | `/announcements` | Pinned first; unread markers; audience chips |
| 34 | Compose/edit | (dialog on the feed) | Markdown editor, audience picker, schedule, read receipts view. No `/announcements/new` route — composing is a dialog on the feed. A permalink **does** exist, at `/announcements/[id]` (screen 34a) |

### Reports (1 hub + 4 views)
| 35 | Reports hub | `/reports` | Four tabs: Employees · Attendance · Leave · **Departments**. Each has date-range presets, a department filter, KPIs, chart, paged table and CSV/Excel export behind `report.export`. **Attrition** was specified as the fourth and is folded into the employees report rather than standing alone; the departments rollup took its place |

### Payroll (13)
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
| 44 | Payroll preferences | `/settings/preferences` | Currency, pay day, LOP basis, PF/ESI/PT rules, and the settlement basis, gratuity rate and ceiling (part of the settings screen) |
| 45 | Settlements | `/payroll/settlements` | Finance’s queue: employee, last working day, earnings, deductions, net payable, status. Defaults to Draft — the only state anybody is waiting on |
| 46 | Settlement statement | `/payroll/settlements/[id]` | The document — earnings vs deductions with the working printed under each figure, editable while draft, approve/pay/recompute, print to PDF |
| 47 | TDS challans | `/payroll/filings/challans` | Register of deposits, one per payroll month; sits inside the Returns tab (`/payroll/filings`) alongside Monthly and Form 24Q rather than as a top-level entry |
| 48 | Form 24Q | `/payroll/filings/24q` | Financial-year and quarter pickers, readiness/reconciliation warnings, and a download of the FVU input file once generated and frozen; also inside the Returns tab |

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

### Notifications

Not a screen. A bell in the header beside the theme toggle, with an unread
badge, a popover list and mark-read. The badge polls every 30 seconds; the list
is only fetched while the popover is open, so a session that never opens it
costs one count query per poll and nothing else.

Senders so far: a resignation submitted (to the routed manager, or to everyone
who can approve when it was routed to nobody), a decision (to the employee), an
offboarding started (to the employee), and an offboarding completed (to HR —
the employee's sign-in has just been suspended).

### System states (every screen)
Loading = skeletons (no spinners on full pages) · Empty = illustration + primary action · Error = retry + support hint · Forbidden = 403 page with "request access" hint · Offline banner.

## UX rules applied (from ui-ux-pro-max, priority order)

1. **Accessibility:** all interactive elements keyboard-reachable; focus rings visible; contrast ≥ 4.5:1 in both themes; icon buttons have `aria-label`.
2. **Touch/interaction:** 44×44 min targets (check-in button is a large card); every mutation shows optimistic or pending feedback within 100 ms.
3. **Performance:** tables virtualized past 100 rows; skeletons reserve layout (CLS < 0.1); avatars lazy + WebP.
4. **Forms:** visible labels (no placeholder-as-label); inline errors adjacent
   to fields; multi-step forms show progress and preserve state on back.
   **Required fields are marked from the schema, not by hand** — `useZodForm`
   carries the schema on the form's control and `FormField` asks it, so an
   asterisk cannot disagree with the rule that rejects the submit. A `required`
   prop still overrides, for the few controls a static schema cannot describe
   (a field required only when another says "Other"). Nullable counts as
   optional: "no manager" is an answer.
   **Error messages come from one map** in `packages/shared/validation-messages.ts`
   rather than from zod's defaults, which are written for whoever is holding
   the stack trace. A message written on the schema still wins, so anything
   sharper belongs on the field.
5. **Navigation:** breadcrumb on all nested pages; browser back always works (dialogs/drawers sync to URL query params where stateful).
