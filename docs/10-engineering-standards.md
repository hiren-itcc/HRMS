# 15–17 — Coding Standards, Git Strategy, CI/CD

## 15 — Coding standards

### TypeScript
- `strict: true` everywhere; additionally `noUncheckedIndexedAccess`. Shared tsconfig bases in `packages/config/typescript`.
- **No `any`** (Biome error). Unknown input is `unknown` + Zod parse. `as` casts need a comment justifying them.
- Domain enums/types come from `packages/types` (generated from Prisma enums + shared Zod) — never redeclared locally.
- Naming: `PascalCase` types/components, `camelCase` functions/vars, `kebab-case` filenames, `SCREAMING_SNAKE` env keys. Booleans read as predicates (`isActive`, `canApprove`).

### Style & lint — Biome (one tool, no ESLint/Prettier)
- Root `biome.json` extends `packages/config/biome`: recommended rules + `noExplicitAny`, `noUnusedImports`, `useExhaustiveDependencies` as errors; 2-space, 100-col, single quotes, semicolons, organized imports.
- Runs: editor on-save → Husky pre-commit (staged files) → CI (whole repo). Same config in all three, so CI never argues with your editor.

### Code review bar (Karpathy guidelines, enforced in PR template)
1. **Simplicity first** — no speculative abstraction; a helper needs ≥ 2 real call sites.
2. **Surgical diffs** — every changed line traces to the PR's intent; no drive-by refactors/reformatting.
3. **Assumptions stated** — non-obvious decisions written in the PR description or an ADR in `docs/`.
4. **Verifiable goals** — every PR states how it was verified (test, screenshot, curl); bugfixes include the regression test.
5. Comments explain constraints ("why"), never narrate code ("what").

### Cross-cutting rules
- No secrets in code or logs; pino redaction list covers tokens/cookies/password fields.
- All user-visible strings sentence-case; dates rendered in org/location timezone via one shared formatter.
- DB writes that must succeed together are in one `$transaction` — reviewers check this on every approval/balance path.
- **Money is `Decimal`, never `Float`,** and is converted to a number once at
  the API edge. A rounding artefact in payroll is somebody's salary.
- **Business rules that can be pure, are.** Day maths, payroll arithmetic,
  statutory thresholds and state machines live in files with no Prisma, no
  clock and no settings lookup — everything passed in. That is what makes them
  testable at the boundaries where they actually break, and reviewers should
  push back on a rule buried in a service that could have been extracted.
- **A guard answers *who*; some rules also need *when*.** Where an action's
  legality depends on state as well as permission, the state machine is a
  single pure module that owns both — not a condition repeated in the
  controller and the service.

## 16 — Git strategy

**Trunk-based**: `master` is always deployable; short-lived branches; no `develop` branch (a 1–3 person greenfield team gets zero value from GitFlow's ceremony).

- Branches: `feat/<scope>-<desc>` · `fix/...` · `chore/...` · `docs/...` — target lifetime ≤ 3 days.
- **Conventional Commits** enforced by commitlint (Husky `commit-msg`): `feat(leave): add half-day support`. Scopes = module names. Enables changelog + semver later.
- PRs: required CI green + 1 review (self-merge allowed for `docs/` and `chore/` while team < 3); **squash-merge only** → linear history; PR title becomes the commit.
- Hooks (Husky): `pre-commit` biome check on staged + affected typecheck · `commit-msg` commitlint.
- Releases: tags `v0.x.y` cut from `master`; deploy is tag-triggered (below). Rollback = redeploy previous tag.
- Never rewrite `master`; `--force-with-lease` only on own feature branches.

## 17 — CI/CD (GitHub Actions)

### `ci.yml` — every PR and push to `master`

```
check              no database — gates everything below
  ├─ biome ci .
  ├─ turbo run typecheck
  ├─ turbo run build
  ├─ turbo run test           unit only; mocked Prisma, runs on a plane
  └─ pnpm audit --audit-level=high   (advisory)
integration        Postgres → migrate deploy → seed → jest test/*.e2e-spec.ts
migration-drift    Postgres → prisma migrate diff --exit-code
e2e                Postgres → migrate + seed → build → Playwright, 5 flows
                   master only, or a PR labelled "e2e"
```

**Unit and integration are separate suites, not one.** `pnpm test` mocks Prisma
and needs nothing; `pnpm test:integration` builds the real `AppModule` against a
real Postgres. The second is the only layer that can see `PermissionsGuard`
reading actual `RolePermission` rows, and the only one that can inject a failing
mail transport — which is what it took to catch the password-reset enumeration
bug that reached production.

**The rule that bug taught, worth applying generally:** for an endpoint that
promises indistinguishability, assert the **equality of two responses under an
injected failure**, not the success of one. A browser test aimed straight at
that endpoint would have passed, because without a mail key the transport is
`LogTransport` and never throws.

**Anything destructive asserts its target first.** `assertDisposable` in
`apps/api/src/common/utils/database-target.ts` is a positive check — "is this
the throwaway I am allowed to destroy" — rather than a denylist, which rots the
moment another environment appears. Both the seed and the E2E setup go through
it. It matters here specifically because the checked-in `.env` says
`NODE_ENV=development` while `DATABASE_URL` points at a hosted database, so an
environment check protects nothing.

**No coverage gate yet, deliberately.** A global 80% threshold fails on the
commit that introduces it — organization, audit and the payroll services have no
specs — and a gate that must be disabled the day it lands teaches everyone to
disable gates. Ratchet per-path thresholds up instead.

### `deploy.yml` — on tag `v*` (staging auto; production behind GitHub Environment approval)

```
1. docker build web + api  (docker/*.Dockerfile, multi-stage, non-root, distroless runtime)
2. push → GHCR  ghcr.io/<org>/hrms-{web,api}:<tag>
3. ssh deploy → server:  docker compose pull
                         docker compose run api npx prisma migrate deploy
                         docker compose up -d
4. smoke: GET /api/v1/health + web /login 200 → failure = auto-rollback to previous tag
```

### Environments & config

| Env | How | Data |
|---|---|---|
| local | `docker/compose.yaml`: postgres + minio; apps run `pnpm dev` on host | seed data |
| staging | compose on VPS, `:staging` tag, auto-deploy on tag | anonymized seed |
| production | same host pattern, GitHub Environment approval gate | real |

Secrets only in GitHub Environments + server `.env` (never in repo); `.env.example` is the documented contract, validated at boot (doc 07). Dependabot weekly + `pnpm audit` in CI (fail on high). Coverage uploaded per PR; services < 80% fails (doc 08).
