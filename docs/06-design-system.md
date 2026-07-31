# 10–11 — Design System & Component Library

Generated with the **ui-ux-pro-max** design intelligence (query: *"HRMS SaaS enterprise HR dashboard professional trustworthy"*, density 7, motion 3). Direction: **Trust & Authority** — an enterprise product where clarity and credibility beat decoration. Explicit anti-patterns from the skill: no playful styling, no AI purple/pink gradients, no emoji-as-icons.

## Foundations

### Color tokens (Tailwind v4 `@theme` — semantic, never raw hex in components)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#F8FAFC` | `#020617` | App canvas |
| `--surface` | `#FFFFFF` | `#0F172A` | Cards, panels, table rows |
| `--surface-muted` | `#F1F5F9` | `#1A1E2F` | Table headers, wells, hover |
| `--border` | `#E2E8F0` | `#334155` | Hairlines, inputs |
| `--foreground` | `#0F172A` | `#F8FAFC` | Primary text |
| `--muted-foreground` | `#64748B` | `#94A3B8` | Secondary text (AA on its surface) |
| `--primary` | `#0F172A` | `#F8FAFC` | Primary buttons, active nav |
| `--primary-foreground` | `#FFFFFF` | `#0F172A` | Text on primary |
| `--accent` | `#16A34A` | `#22C55E` | Success/positive: present, approved, check-in |
| `--warning` | `#D97706` | `#F59E0B` | Late, pending, expiring |
| `--destructive` | `#DC2626` | `#EF4444` | Absent, rejected, destructive actions |
| `--info` | `#2563EB` | `#3B82F6` | WFH, informational, links |
| `--ring` | `#2563EB` | `#3B82F6` | Focus rings (always visible) |

Status colors are **never the only signal** — always paired with a label or icon (dataviz/accessibility rule).

### Typography

**Plus Jakarta Sans** (Google Fonts, variable) for headings *and* body — one family keeps the enterprise tone coherent; weights do the hierarchy work. `tabular-nums` for all tables and stat tiles.

| Token | Size/line | Weight | Use |
|---|---|---|---|
| `display` | 30/36 | 800 | Dashboard greeting, empty states |
| `h1` | 24/32 | 700 | Page titles |
| `h2` | 18/28 | 700 | Section/card titles |
| `h3` | 16/24 | 600 | Sub-sections, table groups |
| `body` | 14/20 | 400 | Default app text (dashboards run denser than marketing 16px) |
| `small` | 13/18 | 400 | Meta, helper text |
| `caption` | 12/16 | 500 | Badges, table headers (uppercase, +2% tracking) |

### Spacing, radius, elevation (density 7/10)

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Card padding 16–24; table row height 44 (touch minimum); page gutter 24.
- **Radius:** `sm` 6 (inputs, badges) · `md` 10 (cards, dialogs) · `full` (avatars, pills).
- **Elevation:** borders over shadows. `shadow-sm` on cards; one dialog/popover shadow tier. Never stacked heavy shadows.
- **Layout:** sidebar 264px (collapsible to 64px icon rail); content max-width 1440 centered; 12-col grid, 24px gutters.

### Motion (3/10 — subtle)

- Durations 150–250 ms, `ease-out`; page-level reveals ≤ 350 ms, y-offset ≤ 12px (reads as fade, not slide).
- Motion only where it carries meaning: state changes, drawer/dialog enter (Framer Motion `AnimatePresence`), check-in success pulse, count-up on stat tiles (once, on load).
- Exits faster than entrances. `prefers-reduced-motion` collapses everything to opacity.
- No decorative scroll choreography anywhere in the app shell.

### Iconography

**Lucide** exclusively (shadcn default) — outline style, 20px in nav/buttons, 16px inline, `stroke-width` 2. Icon-only buttons require `aria-label` + tooltip.

## Component library (`packages/ui`)

Built **on shadcn/ui primitives** (Radix-based, accessible by default), re-exported from `packages/ui` so both current web and future apps consume one source. Two layers:

### Layer 1 — shadcn primitives (installed into `packages/ui`, themed by tokens)

`Button` `Input` `Select` `Combobox` `DatePicker` `Calendar` `Checkbox` `RadioGroup` `Switch` `Textarea` `Form` (RHF+Zod wired) `Dialog` `Drawer/Sheet` `DropdownMenu` `Popover` `Tooltip` `Tabs` `Table` `Badge` `Avatar` `Card` `Skeleton` `Toast (sonner)` `Command (⌘K)` `Breadcrumb` `Pagination` `Alert` `Separator` `ScrollArea`

### Layer 2 — HRMS composites (the product's vocabulary)

| Component | Composes | Used by |
|---|---|---|
| `AppShell` | Sidebar + Topbar + Breadcrumb slot | every authed page |
| `PageHeader` | title, description, actions slot | every page |
| `DataTable` | Table + TanStack Table: server pagination/sort/filter, column visibility, row selection, virtualization, URL-synced state | employees, requests, audit… |
| `StatTile` | Card + count-up + delta indicator | dashboards, reports |
| `StatusBadge` | Badge + status→token map (single source for all status colors) | everywhere |
| `EmployeeCell` | Avatar + name + designation | tables, lists |
| `CheckInCard` | live clock, big check-in/out action, today's timeline | dashboard |
| `BalanceCard` | leave type, used/total, progress ring | leave |
| `ApprovalCard` | requester, range, reason, approve/reject w/ note | approvals inbox |
| `AttendanceCalendar` | month grid + status dots + day drawer trigger | my attendance |
| `WhosOutList` | grouped by day | dashboard, leave calendar |
| `AnnouncementCard` | pinned state, unread dot, audience chip | feed |
| `FileUpload` | dropzone + progress + type/size validation | documents |
| `OrgChartNode` | collapsible tree node | org chart |
| `EmptyState` / `ErrorState` / `ForbiddenState` | illustration + action | all screens |
| `ConfirmDialog` | typed-confirmation variant for destructive actions | offboard, delete |
| `MultiStepForm` | stepper + per-step Zod validation + state preservation | add employee |
| `ReportChart` | Recharts wrapped with dataviz rules (legends, tooltips, a11y palette) | reports |

**Rules:** composites accept data via props — no fetching inside `packages/ui` (fetch hooks live in `apps/web/features`). Every component ships light+dark and disabled/loading/error states. Storybook (or Ladle) added in Sprint 2 as the visual contract.

## Pre-delivery checklist (from skill — applies to every screen PR)

- [ ] No emoji as icons; Lucide SVG only
- [ ] `cursor-pointer` + hover state (150–300 ms) on all clickable elements
- [ ] Text contrast ≥ 4.5:1 verified in **both** themes
- [ ] Focus visible for keyboard nav; logical tab order
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375 / 768 / 1024 / 1440 (sidebar → drawer on mobile; tables → card lists or horizontal scroll within container)
- [ ] Skeletons reserve space (CLS < 0.1)
