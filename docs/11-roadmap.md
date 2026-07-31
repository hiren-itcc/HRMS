# 18–20 — Development Roadmap, Sprint Planning, Future Expansion

## 18 — Roadmap (Phase 1 ≈ 12 weeks, 6 × 2-week sprints)

```
M0  Foundation ready        (end S1)  repo, CI, DB, auth skeleton runs in Docker
M1  People core             (end S3)  auth + org + employees usable end-to-end
M2  Time & leave            (end S5)  attendance + leave with approvals
M3  Phase-1 complete        (end S6)  docs, announcements, reports, settings, hardening → v1.0.0
```

Ordering rationale: every module depends on Employees; Attendance/Leave carry the most business-rule risk, so they get the middle sprints with slack; Reports come last because they read everything else.

## 19 — Sprint planning

### Sprint 1 — Foundation (M0)
Monorepo scaffold (Turbo/pnpm/Biome/Husky/tsconfig bases) · docker compose (postgres, minio) · Prisma schema + initial migration + seed (roles, permissions, admin) · Nest bootstrap (config, pino, Swagger, guards pipeline) · Next bootstrap (shell, theme tokens, `packages/ui` primitives) · CI green.
**Exit:** `docker compose up` + seeded login via Swagger; deploy pipeline dry-run to staging.

### Sprint 2 — Auth & RBAC (M1 start)
Login/refresh-rotation/logout/sessions · invite + reset flows (MailService) · PermissionsGuard + matrix seeds + 403 tests · web: (auth) screens, SessionProvider, api-client refresh, route guarding · Storybook/Ladle for `packages/ui`.
**Exit:** all four roles log in and see role-correct nav; golden E2E #1 (login→dashboard) green.

### Sprint 3 — Organization & Employees (M1)
Org profile/departments/designations/locations/holidays CRUD · employee CRUD + multi-step create + invite + offboard · directory + org chart · my profile + sessions screen · audit interceptor live.
**Exit:** HR creates employee → invite → new user sees Employee dashboard (E2E #4).

### Sprint 4 — Attendance (M2 start)
Check-in/out (idempotent) + today card · my-attendance calendar · shifts · day-close job · regularization request→approve flow · team/admin views · Lighthouse CI job.
**Exit:** E2E #2 (check-in/out) green; day-close verified against fixture TZs.

### Sprint 5 — Leave (M2)
Types + balances + seed defaults · apply flow with day-calc (holidays/week-offs/half-days) + balance preview · approve/reject (transactional balance update) · leave calendar · admin screens + manual adjustment (audited) · unified approvals inbox · notifications fan-out.
**Exit:** E2E #3 (apply→approve) green; balance math unit suite ≥ 95% branch coverage.

### Sprint 6 — Docs, Announcements, Reports, Settings, Hardening (M3)
Documents (upload/download signed URLs, categories, visibility) · announcements (audience, pinned, read receipts) + E2E #5 · 4 reports + CSV export (dataviz-compliant charts) · settings + roles editor + audit viewer · security pass (rate limits, headers, dependency audit), a11y pass (pre-delivery checklist on all 38 screens), perf budgets · **v1.0.0 tag → production**.

**Team assumption:** 1–2 full-stack + this agent; each sprint keeps ~20% slack. Sprints 4–5 carry the domain risk — if timezone/leave-math complexity bites, Reports (S6) is the designated scope buffer.

## 20 — Future expansion plan

The architecture reserves an explicit seam for each planned module — adding one never restructures existing code (doc 01 §4, doc 04 §adding-a-module).

| Module | Lands as | Touches existing schema | New infra |
|---|---|---|---|
| **Payroll** | `modules/payroll` + `features/payroll`; consumes Attendance/Leave via exported services | none — new tables (SalaryStructure, PayrollRun, Payslip) FK to Employee | **BullMQ + Redis** (replaces EventEmitter seam, doc 08); payslip PDFs into existing Document storage |
| **Recruitment** | own module; Candidate is *not* Employee — a hire *converts* into the existing create-employee flow | none | public careers endpoints (unauthenticated segment already exists in web) |
| **Performance** | own module (cycles, goals, reviews) reusing ApprovalStatus machine + notifications | none | none |
| **Assets** | own module (Asset, AssetAssignment FK Employee); joins offboarding checklist via `employee.offboarded` event | none | none |
| **AI features** | `modules/ai` behind AI Gateway (leave-policy Q&A over docs, attrition signals from Reports read-models) | none | LLM provider key; pgvector if RAG |
| **Mobile app** | new consumer of `/api/v1` — contract already Swagger-frozen; auth variant designed (doc 07) | none | push notifications (FCM) behind existing NotificationsModule |
| **Multi-tenant SaaS** | activate the dormant `organizationId` scoping: org signup flow + Postgres RLS + per-org subdomain | none (already scoped) | RLS policies, billing |

**Platform upgrades, triggered not scheduled:** SSE/WebSocket notifications when polling chafes · RS256 + JWKS when a second service consumes JWTs · read replicas when reports strain OLTP · Redis cache when p95 > 300 ms on hot lists.

**Rule for every future module:** new folder + new tables + permission seeds + nav entry. If a design requires editing an existing module's internals, the design is wrong — write an ADR first.
