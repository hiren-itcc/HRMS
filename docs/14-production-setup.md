# 14 — Production setup

How to stand this system up on a server, from an empty database to a working
sign-in. Follow it in order.

For what the system does, see [12-how-it-works.md](./12-how-it-works.md). For
local development, the root [README.md](../README.md) is shorter and better
suited.

---

## The one thing to know first

**Migrations create tables. They do not create data.**

A freshly migrated database has no company, no roles, no permissions and no
users. Nobody can sign in, and there is no sign-up page. You must run the
bootstrap step below or the system is unusable.

There are two seed commands and they are **not** interchangeable:

| Command | What it does | Use in production? |
|---|---|---|
| `pnpm db:bootstrap` | Creates one company, the roles, and one administrator. Additive, safe to re-run. | **Yes — this is the one** |
| `pnpm db:seed` | Demo data: **wipes the company**, then creates 6 fictional employees with invented attendance, leave, payroll runs and announcements. | **No. Never.** |

`db:seed` refuses to run against `NODE_ENV=production` unless you override it.
Do not override it.

---

## 1. Prerequisites

- Node.js ≥ 22
- pnpm ≥ 11
- PostgreSQL 16+ — this deployment uses **Supabase** (project `zvcgaeoiaywupmzcdkwt`,
  region `ap-northeast-2`, Postgres 17.6). See §2.1 for how to connect to it.

---

## 2. Environment variables

The API **validates these at startup and refuses to boot** if any are invalid,
so a typo fails immediately and loudly rather than at 3am. Defined in
`apps/api/src/config/env.ts`.

### Required — no defaults

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Supabase session-pooler string plus two mandatory SSL parameters — see §2.1. Getting this wrong fails silently rather than loudly. |
| `JWT_ACCESS_SECRET` | **Minimum 32 characters.** Generate a fresh random value per environment — never reuse the development one. Anyone holding it can forge a login for any user. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

### 2.1 Connecting to Supabase

Take the string from the dashboard's **Connect** panel, **Session pooler**
(port 5432), then append the two SSL parameters:

```
postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=./certs/supabase-ca.crt
```

**Why the session pooler and not the alternatives.** The direct connection
(`db.<ref>.supabase.co`) is IPv6-only unless you buy the IPv4 add-on, so it
simply will not resolve from most networks. The transaction pooler (port 6543)
cannot run migrations. Session mode serves both the running app and Prisma
Migrate, which is what lets this project keep a single `DATABASE_URL`.

**Why both SSL parameters are mandatory.** The API talks to Postgres through
the `@prisma/adapter-pg` driver adapter — node-postgres, not Prisma's own query
engine — and its SSL defaults differ in a way that bites:

| `DATABASE_URL` ending | Result |
|---|---|
| *(no `sslmode`)* | **Connects in plaintext.** Salaries and bank details cross the public internet unencrypted, with no warning. |
| `?sslmode=require` | **Fails to connect.** pg v8 treats `require` as `verify-full`, and Supabase's chain is not in the system trust store. |
| `?sslmode=verify-full&sslrootcert=…` | Encrypted **and** verified. This is the one. |

The middle row is the trap: the obvious fix for that error is to delete the
parameter, which lands you silently in the first row.

`certs/supabase-ca.crt` is Supabase's public Root 2021 CA (valid to April 2031),
committed deliberately — it is a public certificate, not a secret. `sslrootcert`
resolves **relative to the process working directory**: `apps/api` when running
locally, `/app` in the container, which is why `docker/api.Dockerfile` copies
`certs/` into the runtime stage. A wrong path fails loudly at connect time
(`ENOENT`), so it will not degrade quietly.

One caveat worth knowing: Prisma Migrate's engine accepts these parameters but
does **not** enforce the pinned CA — a bogus `sslrootcert` path still lets
`prisma migrate` run. Only the application's runtime connection is genuinely
certificate-verified. Migrations carry schema rather than employee data, so this
is a documented limitation rather than a hole to plug.

**Data API.** HRMS reaches Postgres only through Prisma, never PostgREST. The
`anon` and `authenticated` roles have therefore been stripped of all privileges
on `public`, and of the default privileges that would otherwise grant them
access to every future table:

```sql
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
revoke usage on schema public from anon, authenticated;
```

Without this, Supabase's defaults grant `anon` full `arwdDxtm` on every table
Prisma creates — anyone holding the publishable key could read and write
`Employee`, `BankDetail` and `Payslip` over HTTP. Re-run the block above after
any operation that might restore stock grants. Supabase's advisor will still
report "RLS disabled" on these tables; that check assumes the default grants
exist, and with them revoked there is no route in. Verify with:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<ref>.supabase.co/rest/v1/Employee?select=*" \
  -H "apikey: <publishable-key>"   # expect 401, code 42501
```

### Optional — sensible defaults, but review before go-live

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | **Set to `production`.** Also disables the API docs page. |
| `PORT` | `4000` | |
| `WEB_ORIGIN` | `http://localhost:5173` | **Must be your real site URL.** This is the CORS allow-list; leaving it wrong blocks the browser. |
| `JWT_ACCESS_TTL` | `15m` | How long a sign-in lasts before silent refresh |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | How long "stay signed in" lasts |
| `TRUST_PROXY` | `0` | Set to the number of proxies in front of the API (usually `1` behind nginx). Wrong value means wrong client IPs in the audit log. |
| `UPLOAD_DIR` | `./uploads` | **Must be persistent storage.** A container's local disk is wiped on redeploy, taking every uploaded document with it. |
| `MAX_UPLOAD_MB` | `10` | |
| `DEFAULT_USER_PASSWORD` | `Welcome@2026` | Starting password for staff created through the app. **Change it** — the default is public. |

### Web app

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | e.g. `https://api.yourcompany.com/api/v1` |
| `PORT` | The server listens on `5173` (set in `apps/web/package.json` and the Dockerfile). |

**This is baked in at build time.** Changing it means rebuilding the web app —
restarting the container will not pick up a new value.

---

## 3. Create the database schema

```bash
pnpm db:deploy
```

This runs `prisma migrate deploy`, which applies pending migrations and nothing
else.

Do **not** use `pnpm db:migrate` on a server. That is `prisma migrate dev`,
which is interactive and can offer to reset the database.

---

## 4. Bootstrap the first administrator

```bash
BOOTSTRAP_ADMIN_EMAIL="admin@yourcompany.com" \
BOOTSTRAP_ADMIN_PASSWORD="<a long random password>" \
BOOTSTRAP_ORG_NAME="Your Company Ltd" \
pnpm db:bootstrap
```

| Variable | Required | Default |
|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | **Yes** | none |
| `BOOTSTRAP_ADMIN_PASSWORD` | **Yes** | none — minimum 12 characters |
| `BOOTSTRAP_ORG_NAME` | No | `My Company` |
| `BOOTSTRAP_ORG_SLUG` | No | `default` |
| `BOOTSTRAP_ORG_TIMEZONE` | No | `Asia/Kolkata` |

There is deliberately **no default password**. The command fails if you omit
one, so no installation can go live on a password that is written down in this
repository.

Expected output:

```
Organization: created "Your Company Ltd" (default)
Roles: 5 system roles, 48 permissions, 140 grants
Administrator: created admin@yourcompany.com (must change password at first sign-in)

Bootstrap complete. Sign in and change the password immediately.
```

What it creates — and nothing else:

- 1 organization
- 5 roles (Admin, HR, Finance, Manager, Employee) with 48 permissions and 140 grants
- 1 administrator, flagged to change password at first sign-in
- **0** employees, attendance, leave, documents, payslips

It is **additive**: re-running it never deletes anything, never resets an
existing administrator's password, and never renames a company you have since
renamed in Settings. Safe to include in a deploy script.

The administrator has no employee record on purpose. It exists to sign in and
set the company up; real staff are created through the app, where employee
codes and reporting lines get validated.

---

## 5. First sign-in

1. Sign in with the bootstrap credentials.
2. **Change the password immediately** — the system will require it.
3. Set up the company: departments, job titles, locations, shifts, holidays.
4. Create real users and give them roles.
5. Once a second administrator exists and works, consider retiring the bootstrap
   account.

---

## 6. Docker

`docker/compose.yaml` defines four services:

| Service | Profile | Notes |
|---|---|---|
| `postgres` | default | PostgreSQL 16. Credentials in the file are `hrms`/`hrms` — **development values, change them.** |
| `minio` | default | Object storage. **Not connected to the application** — see Known gaps. |
| `api` | `full` | Requires `JWT_ACCESS_SECRET`; compose fails without it |
| `web` | `full` | Build-time `NEXT_PUBLIC_API_URL` |

Day-to-day development runs only postgres and minio, with the apps on the host.
The full stack:

```bash
docker compose --profile full up
```

Migrations do **not** run inside the container. Apply them as a separate step:

```bash
docker compose run api npx prisma migrate deploy
```

---

## 7. Go-live checklist

- [ ] `JWT_ACCESS_SECRET` freshly generated for this environment, ≥ 32 chars
- [ ] `NODE_ENV=production`
- [ ] `WEB_ORIGIN` set to the real site URL
- [ ] `DEFAULT_USER_PASSWORD` changed from `Welcome@2026`
- [ ] `UPLOAD_DIR` on persistent storage that survives redeploys
- [ ] Database credentials changed from `hrms`/`hrms`
- [ ] `TRUST_PROXY` matches the actual proxy count
- [ ] **HTTPS terminates in front of the web app.** This repo ships no reverse
      proxy — `docker/compose.yaml` serves plain HTTP. Two things break without
      TLS: the refresh cookie is set `secure` in production and so is never
      sent, and `navigator.geolocation` refuses to run outside a secure
      context. Attendance still works in that state — every punch falls back to
      an unconfirmed office day rather than blocking anyone — but the position
      is never read, so the office/remote split stays empty and every day looks
      the same. The feature is inert, not broken, and nothing on screen says so.
- [ ] **At least one location has coordinates** (Organization › Locations).
      Until then attendance cannot tell an office day from a remote one and
      records every punch as an unconfirmed office day. The locations table
      flags the ones that are not on the map.
- [ ] `NEXT_PUBLIC_API_URL` correct **and the web app rebuilt** after setting it
- [ ] `pnpm db:deploy` run
- [ ] `pnpm db:bootstrap` run, sign-in confirmed, password changed
- [ ] `pnpm db:seed` **not** run
- [ ] Database backups configured
- [ ] `/health` and `/health/ready` wired to your monitoring

---

## 8. The live deployment (Render)

Both applications run on Render, in `singapore` — the region closest to the
Supabase project in `ap-northeast-2`, which every request touches.

| | Service | URL |
|---|---|---|
| API | `hrms-api-prod` (`srv-d9oo5jbl550s73f2omig`) | `https://hrms-api-prod-jrul.onrender.com` |
| Web | `hrms-web-prod` (`srv-d9oo61flk1mc739lcdh0`) | `https://hrms-web-prod-cwy3.onrender.com` |

Neither uses the Dockerfiles in `docker/`; both use Render's Node runtime with
the build scripts in `render/`. That directory exists because **Render's API
cannot edit a service's Build Command after creation** — a one-character fix
there means recreating the service and losing its URL and environment. As
scripts, build changes are an ordinary commit.

### The two hosts are cross-site, and that is not a Render detail

`onrender.com` is on the Public Suffix List, exactly as `vercel.app` is, so one
customer cannot set cookies for another. The consequence is that
`hrms-web-prod-…` and `hrms-api-prod-…` are cross-site to each other even
though both end in `onrender.com`.

So the refresh cookie is `SameSite=None; Secure` in production
(`auth.controller.ts`). A `Lax` cookie is withheld from cross-site XHR, and
`POST /auth/refresh` is one — login would work and every session would then end
silently at the 15-minute access-token expiry.

Splitting the front end onto Vercel instead would change nothing here. The
boundary is the suffix list, not the vendor. What *would* remove it is serving
both from one hostname — either two custom subdomains of a domain you own, or
proxying `/api/v1` through Next. The proxy costs real client IPs, which the
login rate limit and the audit log both record, so it is the worse trade unless
something else forces it.

### Things about the free plan that are not bugs

- **Services sleep after ~15 minutes idle.** The first request afterwards takes
  roughly 50 seconds while the instance wakes. Both services sleep
  independently, so a cold web app and a cold API can stack.
- The Supabase project pauses after about a week of inactivity too, and the
  database is on it. Same constraint, not an additional one.
- Instances have 512 MB RAM; builds run on a larger builder.

### Deploying a change

Auto-deploy is off — see *Deploys are triggered by hand* under Known gaps.
Push to `master`, then Manual Deploy in the dashboard.

`NEXT_PUBLIC_API_URL` is a **build-time** value: Next inlines `NEXT_PUBLIC_*`
into the client bundle, so changing it requires rebuilding the web service, not
restarting it. `render/build-web.sh` fails the build when it is unset rather
than letting a deployment come up calling `localhost:4000`.

---

## Known gaps

Verified against the code at the time of writing. Each of these will surprise
someone during a deployment, so they are recorded rather than left to be
discovered.

### Password reset does not work

`apps/api/src/modules/mail/mail.service.ts` has no SMTP adapter — it logs the
message instead of sending it. The "forgot password" screen appears to work and
the user is told to check their email, but **no email is ever delivered.**

Until a mail provider is connected, an administrator must reset passwords
manually. Plan for that, or connect SMTP before go-live.

### Deploys are triggered by hand

`.github/workflows/deploy.yml` builds and pushes images correctly, but the
deploy job itself is a placeholder that prints a message.

The live deployment (§8) does not use it. Render is set to **auto-deploy off**,
because Render reports no GitHub authorisation for this repository — it can
clone it, since the repository is public, but it receives no push webhook, so
"auto-deploy on" would be a setting that quietly never fires. Connecting the
GitHub account in Render's dashboard is what turns that into a real option.

Until then a deploy is: push to `master`, then Manual Deploy in the dashboard.

### File storage — resolved, and how to configure it

Uploaded documents used to go to local disk only, which meant `UPLOAD_DIR` had
to be persistent or every document vanished on redeploy. That is fixed: the
storage port now has two adapters and picks between them from configuration
(`apps/api/src/modules/storage/`).

| | when | notes |
|---|---|---|
| Supabase Storage | `SUPABASE_URL` **and** `SUPABASE_SERVICE_ROLE_KEY` are both set | the production path — the API is stateless, so no persistent disk |
| Local disk | otherwise | development and CI, which have no credentials and no network |

Two rules for the Supabase side:

- **The bucket must be private.** Files are streamed through the API so
  `ensureEmployeeAccess` still decides who may read a document. A public or
  signed URL handed to the browser would route around it.
- **It is the `service_role` key, not the anon key**, and it bypasses row-level
  security — so it belongs to the API's environment only and must never be
  built into the web app.

MinIO in `docker/compose.yaml` is now genuinely unused and can be removed from
the compose file whenever someone is tidying.

### `.env.example` is inaccurate

- It documents `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. **No code reads
  either.** They are left over from an earlier design; the working variables are
  the `BOOTSTRAP_*` ones in section 4.

### No `docker/.env.example`

`compose.yaml` fails with a message pointing at `docker/.env` when
`JWT_ACCESS_SECRET` is unset, but no example file exists to copy. Create the
file with `JWT_ACCESS_SECRET` in it.

### Rotate the development secret

The development `JWT_ACCESS_SECRET` in `apps/api/.env` is not committed to git
(`.env` is ignored), but it is shared among developers. Never deploy with it —
generate a fresh one per environment.
