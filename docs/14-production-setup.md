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
| `pnpm db:seed` | Demo data: **wipes the company**, then creates 28 fictional employees with invented attendance, leave, remote work, payroll runs, assets, exits, settlements and letters. | **No, unless you mean it** |

### The guard on `db:seed`

It used to refuse on `NODE_ENV === 'production'`, which protected nothing: the
checked-in `.env` says `development` while `DATABASE_URL` points at a hosted
database, so the one configuration that most needed stopping sailed through.

It now looks at **where it is connecting, and at whose data is there**. A local
host runs without ceremony; anything else prints the target, the company and the
row counts it is about to delete, then works through four layers
(`src/common/utils/seed-guard.ts`, and docs/10 §destructive):

| Variable | Satisfies | Refuses when |
|---|---|---|
| `SEED_ALLOW_RESET=true` | the host is not local | it is unset on a remote host |
| `SEED_EXPECT_ORG_NAME` | the tenant is not the demo one | the organization is not `Acme Industries` / `default`, or there is more than one |
| `SEED_ALLOW_REAL_TAX_RULES=true` | the tax rules were entered by hand | any CONFIRMED income-tax configuration lacks the seeder's own marker |

**`SEED_ALLOW_RESET` is not a master key.** It answers only the first row; the
identity and evidence checks run whatever else is set. And the whole guard runs
**before the first write** — it used to run after the organization upsert, so a
refused run had already renamed that company's organization row.

**It was run against production once, deliberately, on 6 August 2026**, to
replace a nearly-empty workspace with one that exercises every module. Two
things made that survivable and should accompany any repeat:

1. `prisma/scripts/backup-org.ts` wrote every row of the organization to JSON
   first. It exists because `pg_dump` is a Postgres client install and the
   machine doing this may not have one.
2. `prisma/scripts/drop-org.ts` makes a **rehearsal** possible: the seed is
   org-scoped, so `SEED_ORG_SLUG=seed-rehearsal pnpm db:seed` proves it against
   a throwaway tenant in the same database, and `DROP_ORG_SLUG=seed-rehearsal
   pnpm tsx prisma/scripts/drop-org.ts` clears it away. `drop-org` refuses the
   `default` slug.

Running the demo seed **deletes the accounts people sign in with**. Afterwards
the logins are the seeded ones (`admin@hrms.local` and the rest, on
`SEED_PASSWORD`), and the company is renamed to Acme Industries — rename it
back under Settings → Organization.

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
| `TRUST_PROXY` | `0` | Number of proxies in front of the API — **`3` on Render**, not 1 or 2; see below. Not optional in any hosted deployment: left at `0`, `req.ip` is the proxy, so the audit log records infrastructure instead of people *and* every rate limit becomes a handful of buckets shared by all users rather than a per-client control. Found unset on 2026-08-11; every address in the audit log was a private `10.x`. |
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
Roles: 5 system roles, 54 permissions, 158 grants
Administrator: created admin@yourcompany.com (must change password at first sign-in)

Bootstrap complete. Sign in and change the password immediately.
```

What it creates — and nothing else:

- 1 organization
- 5 roles (Admin, HR, Finance, Manager, Employee) with 54 permissions and 158 grants
- 1 administrator, flagged to change password at first sign-in
- **0** employees, attendance, leave, documents, payslips

The two counts are not constants — bootstrap derives them from `PERMISSIONS` and
`ROLE_PERMISSIONS` in `packages/shared`, so adding a permission moves them. If
the run prints different numbers than this page, trust the run and correct the
page; the grants total is the sum of the per-role lists (54 + 48 + 20 + 22 + 14).

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
- [x] `TRUST_PROXY` matches the actual proxy count — **`3` on Render**. Verify by
      reading `AuditLog.ip`: public addresses mean it is right, `10.x` means it
      is not. **Do not guess this number — count it**, from a real request:

      x-forwarded-for: 110.226.114.232, 172.70.142.73, 10.27.139.2
                       ↑ client          ↑ Cloudflare   ↑ Render internal

      Render fronts services with Cloudflare (`cdn-loop: cloudflare`,
      `cf-connecting-ip`), so there are **three** hops and the socket peer is
      `::1`. Express with `trust proxy = n` counts `n` addresses leftward from
      the socket, so against the chain above: `1` is the Render internal
      address, `2` is **Cloudflare**, and `3` is the client. Set to `1` on
      2026-08-11 and it changed nothing observable — the audit log kept
      recording `10.x`.

      This entry previously said `2` reached the client. It does not, and the
      chain printed above was always the evidence against it — an off-by-one
      read of the doc's own data. Measured on 2026-08-13 against the live
      service: at `2` every sign-in recorded a Cloudflare POP
      (`172.69.87.181`, `172.71.124.179`); at `3` it records the caller.

      `3` is not forgeable, and that was tested rather than argued. A caller
      who sends their own `X-Forwarded-For` only prepends to the chain —
      Cloudflare appends the real address after it — so counting from the right
      cannot be pushed past the true client. One forged hop and three forged
      hops both left the recorded address unchanged at the caller's real one. A
      forged `CF-Connecting-IP` never arrived at all; Cloudflare rejected it at
      its own edge with error 1000.

      The count is a property of the hosting, not of this app: behind a single
      nginx it is `1`, and behind nothing at all it must stay `0`, because
      trusting a forgeable header while directly exposed hands an attacker the
      value the throttle keys on.
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
- [ ] `pnpm db:seed` **not** run — unless a demo workspace is what you want, in
      which case back up first and read the guard section above
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

### Pushing does not deploy

**Auto-deploy is off on both services.** Every deploy on this account is
`trigger: "api"` — somebody or something calls the Render API. `git push` moves
`origin/master` and changes nothing that is running.

This was discovered the slow way: a phase was pushed, both services were
assumed to have picked it up, and neither had. Worth stating plainly here
because the failure is silent — no error anywhere, the site simply keeps
serving the previous build.

**Deploy the API first.** Its build script ends with `pnpm db:deploy`, so the
API deploy is what applies pending migrations. Deploying the web first would
put new screens in front of tables that do not exist yet.

Verifying a deploy needs a probe that can distinguish the new build from the
old one, and picking that probe is not trivial. A path that "only exists in the
new build" is worthless if an existing dynamic segment swallows it —
`/payroll/settlements` returned 200 on the *old* web build because
`/payroll/[runId]` matched it with `runId="settlements"`. Use a two-segment
path under the new route, and always check a control path alongside it:

```bash
# API: the route exists (401) versus does not (404)
curl -o /dev/null -w '%{http_code}\n' $API/api/v1/<new-route>
curl -o /dev/null -w '%{http_code}\n' $API/api/v1/<nonsense>   # control

# Web: 404 -> 200 on a path no dynamic segment can match
curl -o /dev/null -w '%{http_code}\n' $WEB/<section>/<new>/probe
curl -o /dev/null -w '%{http_code}\n' $WEB/<section>/zzz/probe # control
```

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

### Email reaches exactly one address until you verify a domain

Mail is connected. `mail.service.ts` sends through the transport injected at
`MAIL_TRANSPORT`, and `transport.ts` provides a Resend adapter when
`RESEND_API_KEY` is set — password resets and onboarding invites are really
delivered. (This section previously said no adapter existed; that stopped being
true when Resend was wired.)

The remaining constraint is the sender. `MAIL_FROM` defaults to
`onboarding@resend.dev`, Resend's sandbox address, which **delivers only to the
address that owns the Resend account**. An invite to anyone else is refused by
Resend with a 403 — nothing arrives.

**As of 2026-08-20 there is a second way out: SMTP — but not on this
deployment.** `transport.ts` carries an `SmtpTransport` (nodemailer), selected
whenever `SMTP_HOST` is set — it wins over Resend, so switching does not
require unsetting `RESEND_API_KEY`.

**Measured the same day: Render's free instances silently drop outbound SMTP.**
The exact Gmail credentials that sent a real mail from a developer machine
produced `ETIMEDOUT` on `CONN` from the live service, after nodemailer's full
two-minute connection timeout — during which the forgot-password request that
triggered the send hung for 125 seconds. The transport now caps the connection
wait at ten seconds, but the conclusion stands: **on Render's free plan the
SMTP transport cannot work, whatever the provider or credentials.** It works on
a paid instance or any host with SMTP egress. On the free plan, email goes over
HTTPS — which is what the Resend transport is.

For Gmail, where SMTP egress exists:

| Var | Value |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` (default; `587` also works) |
| `SMTP_USER` | the full Gmail address |
| `SMTP_PASS` | a 16-character **App Password** — never the login password |
| `MAIL_FROM` | `HRMS <the-same-gmail@gmail.com>` |

An App Password requires 2-Step Verification on the Google account, then
myaccount.google.com/apppasswords. Two limits worth knowing: Gmail caps free
accounts around 500 recipients/day, and it rewrites the From header to the
authenticated account — which is why `MAIL_FROM` should name that address.
The long-term answer is still a verified domain (in Resend or any provider);
this unblocks invites and resets today.

Otherwise the Resend constraint stands: verify a domain in Resend and set
`MAIL_FROM` to an address on it. Without any of it, the transport logs the
message instead, which is what keeps local development and CI working offline.

The API says which transport it is, once, at boot — `Mail: SMTP` with host and
`from`, or `Mail: Resend` with the `from` address, or a warning that messages
are only being logged, plus a second warning when `MAIL_FROM` is still a
`resend.dev` address. Before that line existed the only way to find out was to
send something and read the failure, which is exactly how the 403 above was
rediscovered.

**Correction to what this section used to say.** It claimed "the API surfaces
the reason in the response rather than reporting success". That was true of the
*invite* path, which catches the failure and returns `inviteSent: false` with
the reason. It was not true of password reset, which let the exception become a
500 — and a 500 for a real account beside a 200 for an unknown one is an
account-enumeration oracle. Fixed: the send failure is now logged and
swallowed, so the response never varies. See doc 07.

~~Two of the four templates in Settings — `leave_approved` and
`leave_rejected` — have no sender behind them~~ — both are wired now, along
with `notification_generic`. `hasSender` reports it.

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
