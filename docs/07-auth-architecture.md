# 12 — Authentication Architecture

Passport JWT (access) + opaque rotating refresh tokens (sessions in DB). Designed so the future mobile app reuses the same endpoints with a different token transport (ADR §1.4).

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

## Frontend integration (web)

- **Api client:** single fetch wrapper attaches in-memory access token; on 401 it queues concurrent requests, calls `/auth/refresh` **once**, replays queue; refresh failure → hard redirect to `/login?next=`.
- **Bootstrap:** app shell calls `/auth/refresh` on first load (cookie present?) → access token + `GET /auth/me` into a `SessionProvider` (React context — session identity is not Zustand state).
- **`middleware.ts`** only checks cookie *presence* for authed segments (fast redirect UX). It is not a security boundary — the API is (doc 04 §enforcement).
- Permission-aware UI via `useCan('leave.approve.team')` reading `/auth/me` perms.

## Future mobile app (designed-in, not built)

Same endpoints; refresh token returned in body when client sends `X-Client: mobile`, stored in device secure storage (Keychain/Keystore), sent in body to `/auth/refresh`. Session rows already track per-device metadata — no schema change.

## Security hardening checklist (Phase 1 scope)

- [x] helmet, CORS allowlist (web origin only, `credentials: true`)
- [x] Global rate limits + strict auth throttle (doc 03)
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
