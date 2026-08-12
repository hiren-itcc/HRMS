# 10–11 — Design System & Component Library

Generated with the **ui-ux-pro-max** design intelligence (query: *"HRMS SaaS enterprise HR dashboard professional trustworthy"*, density 7, motion 3). Direction: **Trust & Authority** — an enterprise product where clarity and credibility beat decoration. Explicit anti-patterns from the skill: no playful styling, no AI purple/pink gradients, no emoji-as-icons.

## Foundations

Built on **coss UI** (Base UI 1.6) since the design-system migration. coss
supplies a neutral, monochrome chrome; the brand accent is indigo, laid over
it. Everything below is a CSS custom property in
`packages/ui/src/styles/globals.css` — components never carry raw hex.

### Colour tokens

Values are Tailwind v4 ramp references rather than literals, so a ramp change
moves every consumer at once.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | white | `neutral-950` mixed 95% toward white | App canvas |
| `--card` / `--popover` | white | background +2% white | Cards, panels, menus |
| `--foreground` | `neutral-800` | `neutral-100` | Primary text |
| `--muted-foreground` | `neutral-500` → black 10% | `neutral-500` → white 18% | Secondary text |
| `--primary` | `indigo-600` | `indigo-500` | Primary buttons, active nav, links |
| `--ring` | `indigo-600` | `indigo-400` | Focus rings |
| `--border` | black 8% | white 6% | Card edges, dividers |
| `--input` | black 45% | white 35% | Control boundaries — raised off `--border` to clear 3:1 |
| `--destructive` | `red-600` | `red-600` | Destructive actions, errors |
| `--success` / `--warning` / `--info` | `emerald-500` / `amber-500` / `blue-500` | same | Status fills |
| `--*-text` | darker step | lighter step | Text sitting **on** a tint of its own status |

Two things here are deliberate and were arrived at by measurement, not taste:

- **`--input` is not `--border`.** A control boundary must clear 3:1 (WCAG
  1.4.11); coss ships 10% black, which reads 1.25:1. Card edges keep the softer
  `--border`, which is decorative and exempt.
- **The `-text` tokens exist because a status fill is not readable as text.**
  `--success` on a 15% tint of itself fails AA; `--success-text` is the step
  that passes. Status colour is also never the only signal — always paired with
  a label or an icon.

`--primary` stayed indigo when coss's own is near-black: the logo, the sidebar
pill and the stat tiles were already indigo, and leaving buttons neutral made
those read as leftovers rather than as the brand.

### The contrast gate

`packages/ui/scripts/contrast-gate.mjs` measures every text and boundary pair
in every theme and mode, and exits non-zero on a failure. Run it against the
**compiled** stylesheet, not the source — the source is `var()` chains,
`--alpha()` and `color-mix()` that only Tailwind resolves:

```bash
pnpm --filter @hrms/web build
pnpm --filter @hrms/ui contrast apps/web/.next/static/chunks/<hash>.css
```

**336 pairs** — 28 pairs × 6 themes × 2 modes — of which 24 are accepted
deviations. It is a gate rather than a report: a token change that breaks
contrast should fail, not be noticed later.

**It was measuring nothing.** The doc said "56 pairs currently pass"; in fact
every pair was SKIPping and the script exited 0 regardless. Lightning CSS
compiles each `oklch()` twice — a hex fallback at the top level and a `lab()`
version inside `@supports (color: lab(0% 0 0))` — both in a `:root` block. The
collector keeps the last value it sees, `lab()` is not a syntax it parses, and
so every token resolved to null. It now strips `@supports` along with
`@media print` and measures the hex fallbacks, which are the sRGB values WCAG
ratios are defined against.

Two pairs fail on the base theme and are listed in `ACCEPTED` with the reason
and a 3:1 floor, so they cannot silently get worse:

| Pair | Why |
|---|---|
| primary button label | 3.90:1. `globals.css` records the trade: brand fidelity over the darker red that would have reached 4.50:1. Clears 3:1 for large text and UI components |
| active sidebar pill | `--sidebar-primary` is unused by any component |

The destructive button label used to be a third entry, at 3.76:1 in dark mode.
It was fixed rather than accepted: the dark theme's `--destructive` was
darkened from red-500 until white cleared 4.5:1, which also lifted the error
badge and chip. An entry leaving this table is the point of it.

A `QUANTISATION` allowance of **0.02** absorbs hex rounding in the compiled
output; `globals.css` already noted that solving to exactly 4.50 landed at 4.48
after rounding. It has been ratcheted down twice — from 0.05, where it was wide
enough to hide themed chips genuinely rendering at 4.46:1. Tightening it to
0.01 fails a pair, so it is the floor rather than a comfort margin.

### Colour themes

Six, chosen from the avatar menu and stored per person in `localStorage`:
Terracotta (the default, and `:root` itself), Indigo, Emerald, Violet, Amber
and Slate. Each carries its own radius, and two carry a second font family.

**A theme is a rotation, not a palette.** `scripts/build-themes.mjs` derives
every theme from the audited base by moving hue and chroma, and writes
`src/styles/themes.css` — generated, but committed, because CSS is what a
person debugs at 2am. Hand-picking five more palettes would be ~550 values with
none of the base's reasoning behind them.

**Rotation matches luminance, not lightness**, and that distinction is the
whole feature. OKLCH `L` is *perceptual* lightness; WCAG contrast is *relative
luminance*, and the two diverge with hue. Holding `L` and rotating terracotta
to emerald took white-on-primary from 3.90:1 to 3.48:1 — a real regression on
every primary button. Matching luminance instead preserves every ratio the
token takes part in, and the gate confirms each theme now tracks the base
within 0.02.

Status colours (success/warning/info/destructive) and chart slots 2–5 are
deliberately **not** themed: they are categorical, and a scale that moves with
the chrome stops telling things apart.

Ordering in `apps/web/src/app/globals.css` is load-bearing — `themes.css` is
imported *after* the base, because a theme block and `:root` have equal
specificity and the later one wins.

### Typography

**Inter** (variable) for headings and body, **Geist Mono** for figures that
need to align. Both arrive as webfonts via `@fontsource-variable`, imported in
`globals.css` — not `next/font`, because coss's own stylesheet declares the
families and loading them twice ships a family nothing references.
`tabular-nums` on every table and stat tile.

| Token | Size/line | Weight | Use |
|---|---|---|---|
| `h1` | 30/36 | 700 | Page titles, dashboard greeting |
| `h2` | 24/32 | 700 | Section titles |
| `h3` | 18/28 | 600 | Card titles, sub-sections |
| `body` | 14/20 | 400 | Default app text (dashboards run denser than marketing 16px) |
| `small` | 13/18 | 400 | Meta, helper text |
| `caption` | 12/16 | 500 | Badges, table headers (uppercase, +2% tracking) |

### Spacing, radius, elevation

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Card padding 16–24; table
  row height 44 (touch minimum); page gutter 24.
- **Radius:** `--radius` 0.625rem; `lg` for inputs and buttons, `xl`–`2xl` for
  cards and dialogs, `full` for avatars and pills.
- **Elevation:** borders over shadows. One dialog/popover shadow tier. Never
  stacked heavy shadows.
- **Layout:** sidebar 240px (collapsible to a 64px icon rail); content
  max-width 1152 centred; page gutter 24.
- **Touch targets:** coss controls carry `pointer-coarse:after:min-h-11`, so a
  44px target appears on touch without inflating the pointer layout.

### Motion (subtle)

- Durations 150–250 ms, `ease-out`; page-level reveals ≤ 350 ms, y-offset
  ≤ 16px (reads as a fade, not a slide).
- Motion only where it carries meaning: state changes, dialog enter, the
  sidebar and tab active pills (Framer Motion `layoutId`), stat-tile stagger on
  load.
- Exits faster than entrances. A global `prefers-reduced-motion` block collapses
  every animation to nothing — CSS and Base UI included, not just the Framer
  Motion consumers that branch on `useReducedMotion`. Spinners are exempt: a
  frozen spinner says the app has hung.
- No decorative scroll choreography anywhere in the app shell.

### Iconography

**The webfonts had never loaded.** `globals.css` asked for `"Inter"` and
`"Geist Mono"`, while Fontsource registers the families as `Inter Variable`
and `Geist Mono Variable`. The `@import` shipped the files and no rule could
match them, so every screen rendered in whatever the OS resolves for
`sans-serif`. Both stacks now name the variable family first.

The stacks live in `--font-sans-stack` / `--font-heading-stack` on `:root`, and
`@theme inline` points at them. That indirection is required, not tidiness:
written as a literal inside `@theme inline`, Tailwind inlines the string into
every `font-sans` utility and a theme overriding `--font-sans` changes nothing.
Mono is deliberately not themed — code, keyboard keys and masked account
numbers all depend on the figures lining up.

**Lucide** exclusively — outline, 20px in nav and buttons, 16px inline,
`stroke-width` 2. Icon-only buttons require `aria-label`; decorative glyphs get
`aria-hidden`. coss's registry pulls `@remixicon/react` as a transitive
dependency; we do not use it — one icon family or none.

**An icon-only button also has to say what it is on hover**, which an
`aria-label` alone does not do — it reaches a screen reader and nobody else,
and a pencil beside a bin beside a power symbol is a guessing game for anyone
who does not already know the screen. `IconAction` takes one `label` and
spends it twice, as the accessible name and as the tooltip, so the two cannot
drift apart the way they do when a tooltip is added separately. The provider
is global (`components/providers.tsx`), because a page that forgets to wrap
itself is a button that silently stops explaining.

Two exceptions, both deliberate. A trigger whose `Button` lives inside a
`render` prop — the theme menu, the notification bell, a dropdown — is wrapped
in `Tooltip`/`TooltipTrigger` by hand rather than converted. And a control that
only exists below `lg`, like the mobile navigation button, gets no tooltip at
all: there is no pointer on those screens to hover with.

Never a native `title` alongside. Two hover labels on one button is one too
many, and the native one is slower and cannot be styled.

### The brand mark

The one icon that is not Lucide. Three figures where the centre one's torso is
a briefcase, drawn for this product rather than taken from a set — the stock
icon it replaced carried a licence barring use "in any trademark, or part of
the same", which is what a logo is.

It lives in exactly one place, `apps/web/src/components/brand-mark.tsx`, and is
drawn by `BrandMark` at two sizes: `sm` in the sidebar, the mobile navigation
sheet and the careers header, `lg` in the two auth panels. Before that it was a
`ShieldCheck` pasted inline into five components, and the fifth had already
drifted — the public careers header rendered the literal text `HR` where every
other place drew the icon. Five copies is four opportunities to miss one.

Three rules the mark exists under, each of them settled by rendering at 16px
rather than by argument:

- **Filled shapes, never strokes.** A 2px stroke at 24 units is a third of a
  pixel in a browser tab.
- **Cut-outs are `fill-rule="evenodd"`, never overpainted in the background
  colour.** The old favicon faked its tick that way, which is exactly why it
  could not share geometry with a component sitting on a *CSS* gradient. Real
  holes let one path serve both.
- **Detail that cannot survive 16px does not ship.** The briefcase had a clasp;
  it rendered as a muddy pixel and was cut.

`app/icon.svg` is a hand-kept twin — Next serves it statically, so it cannot
import `BRAND_PATH`. `brand-mark.test.tsx` fails if the two geometries stop
matching, because the pair it replaced drifted apart under a comment claiming
they agreed. The favicon also hardcodes the terracotta ramp: it reads no CSS
variables, so unlike the in-app mark it cannot follow `--brand-ramp-*` through
the five alternate themes. That is deliberate — a tab icon identifies the
product, not the viewer's colour preference.

## Component library (`packages/ui`)

Built **on coss UI** (Base UI, accessible by default), installed into
`packages/ui` so both the current web app and future consumers read one source.
Two layers:

### Layer 1 — coss primitives (56 files in `packages/ui/src/components`, themed by tokens)

`Button` `Input` `InputGroup` `Select` `Combobox` `Autocomplete` `Calendar`
`Checkbox` `RadioGroup` `Switch` `Textarea` `Field` `Fieldset` `Form` `Dialog`
`AlertDialog` `Drawer` `Sheet` `Menu` `ContextMenu` `Popover` `Tooltip` `Tabs`
`Table` `Badge` `Avatar` `Card` `Frame` `Skeleton` `Spinner` `Progress` `Meter`
`Toast` `Command (⌘K)` `Breadcrumb` `Pagination` `Alert` `Empty` `Separator`
`ScrollArea` `Toolbar` `Toggle` `ToggleGroup` `Sidebar` `Kbd` `Accordion`
`Collapsible` `Slider` `NumberField` `OtpField` `PreviewCard` `Label` `Group`

Two files in that directory are ours rather than coss's, and say why in their
own comments:

- **`date-picker.tsx`** — coss ships `Calendar` but no date *field*, so this is
  the documented Popover + Calendar composition packaged as one control. It
  speaks ISO `yyyy-mm-dd` strings rather than `Date`, because every form, zod
  schema and API payload already does; and it never touches
  `new Date(string)` or `toISOString()`, both of which are UTC and would render
  a picked date as the day before anywhere west of Greenwich.
- **`dropdown-menu.tsx`** — an alias layer over coss `Menu`, so ~15 screens did
  not need renaming. `DropdownMenuLabel` is a real component rather than an
  alias: Base UI's `GroupLabel` throws outside a `Menu.Group`, and Radix's
  label was standalone.

**Migrating from Radix idioms:** `asChild` → `render`, `DialogContent` →
`DialogPopup`, `onSelect` → `onClick`, `delayDuration` → `delay`. Two
differences are invisible to TypeScript and cost us runtime errors before they
were understood — `Select` decides controlled-ness from `value !== undefined`
on the *first* render (so "nothing selected" is `null`, not `undefined`), and
`SelectValue` renders the raw value unless the root is given an `items` map.
Both are now handled inside the `Select` wrapper.

### Layer 2 — HRMS composites (the product's vocabulary)

| Component | Composes | Used by |
|---|---|---|
| `AppShell` | Sidebar + Topbar + Breadcrumb slot | every authed page |
| `PageHeader` | title, description, actions slot | every page |
| `DataTable` | Table + sticky header, density toggle, column visibility, numbered pagination, URL-synced sort/page | employees, requests, audit, payroll… |
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
| `IconAction` | icon-only `Button` + `Tooltip`, one `label` serving both the accessible name and the hover text | every icon button in the app |
| `CardColumns` | two vertical stacks rather than a two-column grid — a grid levels its rows, so a short card beside a tall one leaves a hole beneath it. Deals evens left and odds right, which is exactly where the grid put them | employee record, profile, dashboard |
| `EmptyState` / `ErrorState` / `ForbiddenState` | illustration + action | all screens |
| `ConfirmDialog` | typed-confirmation variant for destructive actions | offboard, delete |
| `MultiStepForm` | stepper + per-step Zod validation + state preservation | add employee |
| `ReportChart` | Recharts wrapped with dataviz rules (legends, tooltips, a11y palette) | reports |
| `SectionTabs` | `<nav>` of links with a spring active pill — deliberately **not** coss `Tabs`, which emits `role="tab"` and would promise a panel swap where these navigate | every module with sub-routes |
| `CommandPalette` | coss `Command` over the same `NAV_ITEMS` and permission checks the sidebar uses, so it cannot offer a route you would be bounced out of | ⌘K anywhere |
| `TimezoneField` | coss `Combobox` over 418 IANA zones with their current offsets | organization, locations |
| `StatusBadge` (payroll) | run status and payment status share a component but never a scale — two axes, so colouring them alike would imply a progression that does not exist | payroll |

**Rules:** composites accept data via props — no fetching inside `packages/ui` (fetch hooks live in `apps/web/features`). Every component ships light+dark and disabled/loading/error states. Storybook (or Ladle) added in Sprint 2 as the visual contract.

## Pre-delivery checklist (from skill — applies to every screen PR)

- [ ] No emoji as icons; Lucide SVG only
- [ ] `cursor-pointer` + hover state (150–300 ms) on all clickable elements
- [ ] Text contrast ≥ 4.5:1 verified in **both** themes
- [ ] Focus visible for keyboard nav; logical tab order
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375 / 768 / 1024 / 1440 (sidebar → drawer on mobile; tables → card lists or horizontal scroll within container)
- [ ] Skeletons reserve space (CLS < 0.1)
