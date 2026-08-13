# 12 — Authentication Architecture

Passport JWT (access) + opaque rotating refresh tokens (sessions in DB). Designed so a non-browser client could reuse the same endpoints with a different token transport (ADR §1.4). No such client is planned — see the header-token variant below.

## Token model

| | Access token | Refresh token |
|---|---|---|
| Format | JWT (HS256 Phase 1; RS256 when a second consumer service exists) | Opaque 256-bit random |
| Lifetime | **15 min** | **30 days** (sliding via rotation) |
| Storage (web) | Memory only (never localStorage/cookie) | **httpOnly Secure SameSite=Lax cookie**, `Path=/api/v1/auth` |
| Storage (server) | none (stateless) | `RefreshSession` row — **SHA-256 hash only** |
| Claims | `sub` (userId), `orgId`, `employeeId?`, `roleCode`, `perms[]` | n/a |
| Revocation | expiry only (15 min bound) | immediate: revoke session row |

Passwords: **Argon2id** (memory 64 MB, iterations 3). Reset/invite tokens: single-use, hashed at rest, 1 h / 7 d expiry.

## Flows

### Login
```
POST /auth/login {email, password}
 ├─ throttle 5/min/IP → argon2.verify → user ACTIVE?
 ├─ create RefreshSession (hash, ua, ip, exp 30d)
 ├─ Set-Cookie: refresh (httpOnly) 
 └─ 200 { accessToken, user {id, role, perms, employee summary} }
```

### Refresh with rotation + reuse detection
```
POST /auth/refresh  (cookie)
 ├─ hash token → find session
 ├─ not found/expired ............... 401 (client → login)
 ├─ session.revokedAt set already ──► REUSE DETECTED:
 │      revoke ALL sessions for user, audit 'auth.reuse_detected' → 401
 └─ valid: revoke old (replacedById=new), issue new pair → 200
```
A stolen-then-reused refresh token kills the whole chain — attacker and victim both log out, victim re-authenticates, attacker is locked out.

### Logout / revoke
`POST /auth/logout` revokes current session + clears cookie. `/auth/sessions` lists devices (ua, ip, createdAt); user can revoke any — powers screen 14.

### Invite & reset
- **Invite:** HR creates employee → optional user with `INVITED` status → email link `/invite?token=` → set password → status `ACTIVE`, auto-login. Re-invite regenerates (old token dies).
- **Forgot password:** always returns 200 (no account enumeration); on success revokes all sessions.
  - A failed send is **logged and swallowed**, and that is load-bearing rather
    than tidy. The mail transport throws so each caller can decide whether a
    failure is fatal; this one did not decide, so a refused send became a 500
    while an address with no active account still returned 200. The status code
    was an answer to "does this account exist" — on an unauthenticated endpoint,
    with the property it was breaking written in its own summary. Swallowing is
    safe here because the reset token is written *before* the send, so the link
    is valid and the request can be repeated. Reporting the failure to the
    caller instead would re-open the same oracle from the other side.

## Frontend integration (web)

- **Api client:** single fetch wrapper attaches in-memory access token; on 401 it queues concurrent requests, calls `/auth/refresh` **once**, replays queue; refresh failure → hard redirect to `/login?next=`.
- **Bootstrap:** app shell calls `/auth/refresh` on first load (cookie present?) → access token + `GET /auth/me` into a `SessionProvider` (React context — session identity is not Zustand state).
- **`middleware.ts`** only checks cookie *presence* for authed segments (fast redirect UX). It is not a security boundary — the API is (doc 04 §enforcement).
- Permission-aware UI via `can('leave.approve.team')` from `useSession()`, reading `/auth/me` perms. There is no `useCan` hook — this line claimed one for months and anybody who believed it wrote an import that does not resolve.

## Header-token variant (designed-in, not built, and not planned)

A non-browser client cannot use the httpOnly refresh cookie, so the design allows for one: same endpoints, refresh token returned in the body when the client sends `X-Client: mobile`, stored in device secure storage (Keychain/Keystore), sent in the body to `/auth/refresh`. Session rows already track per-device metadata — no schema change.

This is a property of the token design, not a scheduled piece of work. **The mobile app it was drawn for has been dropped from the roadmap** (doc 11 §20); the variant is recorded because it is what constrains the cookie decision in ADR A2, and it is what any future non-browser consumer would use.

## Security hardening checklist (Phase 1 scope)

- [x] helmet, CORS allowlist (web origin only, `credentials: true`)
- [x] Global rate limits + auth throttle (doc 03), **two limits rather than
      one**: `login`, `forgot-password`, `reset-password` and the invite routes
      at 5/min; `refresh` at 60/min.

      They were never one *bucket* — `@nestjs/throttler` keys storage per
      handler, so each route has always had its own counter. They shared the
      number, and 5/min is a figure calibrated for a person typing a password.
      `/auth/refresh` is fired by the client on every app bootstrap
      (`session-provider.tsx`) and again on any 401 (`api-client.ts`), so at
      five a minute a signed-in person who reloaded a few times or opened a few
      tabs got a 429 — and the bootstrap reads any failure as "not signed in"
      and bounces them to the login screen. A spurious sign-out rather than lost
      data: the 429 comes from the guard, so the handler never runs and the
      cookie survives.

      What guards that route is the token — httpOnly, Secure, SameSite=Lax,
      scoped to `/auth`, rotated with reuse detection. The limit is not zero
      because the route is `@Public()` and its reuse branch does three writes,
      so a ceiling on how fast one source can trigger them is worth keeping.

      The sign-in limit is `AUTH_THROTTLE_LIMIT`, default 5, capped at 100 by
      the env schema so a misconfiguration cannot switch it off. Only the
      end-to-end job raises it; `auth.e2e-spec.ts` proves the limit refuses at
      whatever it is set to, and runs at the default. It had no test at all
      until the browser suite ran into it.
- [x] **`TRUST_PROXY=2` is set on the API service.** `main.ts` only calls
      `set('trust proxy')` when the value is above zero, and it defaults to `0`
      — deliberately, because `X-Forwarded-For` is forgeable and trusting it
      while directly exposed hands an attacker control of the value the
      throttle keys on. It is a deployment fact, so it comes from configuration.

      Before it was set, Render terminated TLS at its edge and `req.ip` was
      Render's proxy — confirmed from the live audit log, where every recorded
      address was a private `10.x` with three distinct values across all rows.
      That made the rate limits a handful of buckets shared by every user in
      the world rather than per-client limits, and made the addresses on
      sign-in rows and the session list Render's infrastructure rather than who
      did what.

      The value is `2`, not `1`, matching
      [14-production-setup.md](./14-production-setup.md) — Render's edge puts
      two hops in front of the app, and a count set too high is worse than one
      set too low, because it starts believing a header the client can write.

      Worth re-reading the live table to confirm real addresses now arrive; the
      count is the sort of thing that is right in the docs and wrong in the
      deployment.
- [x] Validation on every DTO (`ValidationPipe` whitelist+transform → unknown fields rejected)
- [x] Audit log on: login success/fail, refresh reuse, password change, role/permission change, employee delete, balance adjust
- [x] No secrets in code — env validated at boot with Zod (`config/` module); app refuses to start on missing/invalid env
- [ ] 2FA (TOTP) — future expansion (doc 11), `User` table extends cleanly
- [ ] SSO (OIDC/SAML) — future; Passport strategy slot already isolated in `auth/strategies/`

## How an employee gets a sign-in

There are **three** ways, and which one runs is a choice HR makes on screen.
They differ in who sets the first password, so mixing them up is the difference
between a password read out over the phone and one nobody ever knows.

Whichever path is used, the sign-in is created in the same transaction as the
employee. Half of that succeeding is the failure mode the transaction exists to
prevent: an employee row nobody can log in as.

### 1. No login at all

`POST /employees` with `createLogin: false`
(`packages/shared/src/schemas/employee.ts:112`).

An employee record and nothing else — for someone who will never use the
product, or whose access comes later. `employee.invite` can grant it afterwards.

### 2. Shared default password — for staff who already work here

`POST /employees` with `createLogin: true`, the default.

The account is created **ACTIVE** on `DEFAULT_USER_PASSWORD` carrying
`User.mustChangePassword`. That flag is what makes a shared default acceptable:
sign-in succeeds, but the app sends them to change it before anything else, and
any password change clears it. It is not a lockout — the guard is in the
dashboard layout, so the API is unchanged and a client that ignores the flag
simply keeps a guessable password, which is the user's own risk rather than a
hole.

This path assumes **somebody tells them the password**. It suits backfilling
existing staff, where HR is in the room. It is the wrong path for a hire who has
not started, because the work mailbox usually does not exist yet.

### 3. Emailed invite — for a new hire (`POST /employees/onboard`)

The path added with the onboarding module, and the one to use for anybody
joining.

The employee is created with status `ONBOARDING` and the user with status
`INVITED`, holding a **deliberately unusable password hash** — argon2 over 32
random bytes that nothing can reproduce (`invite.service.ts:47`). There is no
default password to leak, because there is no password. `login()` refuses
anything but `ACTIVE`, so the account gates itself until onboarding is approved.

An `EmployeeInvite` token is minted in the same transaction and emailed to the
hire's **personal** address — they have no access to the work mailbox yet. The
mail names the work email as the login ID and carries a single-use link; no
password is ever put in it. Re-inviting revokes the outstanding token, so only
one live link exists at a time.

Mail is sent **after** the transaction commits, and a send failure is returned
in the response rather than thrown — the hire exists and the invite can be
resent, so losing the record to a mail outage would be worse.

### Which permission

Creating a sign-in needs `employee.invite`, separately from `employee.create` —
issuing credentials is not the same act as recording a person. `/employees/onboard`
checks both.
