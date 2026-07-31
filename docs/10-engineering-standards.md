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
setup (pnpm cache + turbo remote cache)
├─ lint        turbo run lint      (biome, affected-only on PRs)
├─ typecheck   turbo run typecheck
├─ test        turbo run test      (unit + integration; Postgres service container)
├─ build       turbo run build     (web + api + packages)
└─ e2e         Playwright golden flows — master only, or PR label "e2e"
    prisma migrate diff --exit-code   → blocks drift between schema and migrations
```

Turborepo's affected-graph keeps PR CI < 5 min; `master` runs the full matrix.

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
