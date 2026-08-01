# @hrms/web

Next.js 16 (App Router) front end for the HRMS. A **pure API consumer** — it
holds no database connection and no business rules; everything comes from
`/api/v1`.

Run it from the repo root (`pnpm dev` starts this and the API together) — these
notes cover working on the web app specifically.

## Layout

```
src/
  app/
    (auth)/            Sign-in, forgot/reset password — its own shell
    (dashboard)/       Everything authenticated; one folder per module
  components/          App-wide: DataTable, CrudShell, Field, PageHeader,
                       SectionTabs, CommandPalette, EmptyState, ErrorState…
  features/            One folder per module: api.ts, types.ts, components/
  hooks/               useListParams (URL state), useCrud
  lib/                 api-client (token refresh, blob download)
  stores/              Zustand — UI state only, never server data
  proxy.ts             Edge auth redirect (Next 16's middleware)
```

The split that matters: **`features/` fetches, `components/` and `packages/ui`
do not.** A component in `packages/ui` never knows about an endpoint; a feature
never re-implements a table.

## State, and where it lives

| Kind | Home |
|---|---|
| Server data | TanStack Query — the cache *is* the state |
| List filters, sort, page | The **URL**, via `useListParams`. Every table view is deep-linkable and browser back works |
| Session identity + `can()` | `SessionProvider` |
| UI preferences (sidebar collapsed, table density) | Zustand, persisted |

Nothing else holds server data. If a component needs it, it queries for it.

## Permissions in the UI

`can('payroll.approve')` mirrors the API — it decides what to *show*, never
what is *allowed*. The API is the boundary; hiding a button is a courtesy so
people are not offered actions that would be refused. Payroll's run screen is
the clearest example: it renders only the transitions legal from the current
state and permitted to the signed-in person, mirroring the server state machine
rather than duplicating it.

## Design system

Components come from `@hrms/ui` (coss UI on Base UI) — see
[`docs/06-design-system.md`](../../docs/06-design-system.md). Points that bite
if you have Radix habits:

- `asChild` → `render`, `DialogContent` → `DialogPopup`, `onSelect` → `onClick`,
  `delayDuration` → `delay`.
- A `Select` with nothing chosen takes `value={null}`, not `undefined` — Base UI
  decides controlled-ness on the first render.
- Dialog bodies belong in `DialogPanel`, which carries the padding and the
  scroll area. `DialogHeader` stays outside the `<form>`, which is `contents`.

**None of these are type errors.** They only show up in the browser, which is
also the argument for opening a screen after changing it.

## Conventions

- **Every form** uses `Field` (label, hint, error, required marker, and the
  aria wiring) + React Hook Form + a Zod schema from `@hrms/shared`. The same
  schema validates on the server.
- **Every table** uses `DataTable` — sticky header, density toggle, column
  visibility, numbered pagination, and skeleton/empty/error states built in.
- **Every list page** uses `CrudShell` for the header, debounced search and
  filter row.
- **Money and dates are formatted at the edge**, never inside a shared
  component. Dates render as `1 Aug 2026` rather than a locale format, because
  `01/08/2026` means two different days depending on where you are — and a
  locale-dependent format causes hydration mismatches.

## Scripts

```bash
pnpm dev              # localhost:3000
pnpm build
pnpm typecheck
pnpm lint
```
