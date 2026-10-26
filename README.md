# Cimmerian Crane Services — Helpdesk &amp; Job Management

System of record for crane servicing, breakdown repairs, inspections, load testing, parts and compliance
documents. Replaces spreadsheets, WhatsApp threads and paper forms.

- Conventions, stack and rules that must never be violated: [`CLAUDE.md`](CLAUDE.md)
- Architecture, data model, screens and the phase plan: [`docs/PLAN.md`](docs/PLAN.md)
- Assumptions made where the brief was silent: [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md)

**Status:** Slice 3 (sites and cranes). See "What works today" below.

---

## Prerequisites

| | |
|---|---|
| **Node.js 20.11+** | Required. Everything else is installed by npm. |
| **PostgreSQL** | Either a hosted Supabase project (what this team uses) or the bundled Docker Compose service. |
| **Docker** | Optional — only if you prefer a local database over Supabase. |

There is nothing else to install. Playwright's browser is fetched by npm when the end-to-end tests
first run (slice 9).

---

## Setting up against Supabase

Supabase is Postgres, so Prisma talks to it directly — but it needs **two** connection strings, because
the transaction pooler cannot run the DDL that migrations need.

> **Use the pooler for both, not `db.<project-ref>.supabase.co`.** Newer Supabase projects expose that
> direct hostname over IPv6 only, so it fails to resolve on most IPv4 networks. The pooler hosts work
> over IPv4 and are what Supabase now recommends.

1. In the Supabase dashboard go to **Connect** (or Project Settings → Database).
2. Copy these two strings into `.env`:

| `.env` variable | Which string | Port | Used for |
|---|---|---|---|
| `DATABASE_URL` | **Transaction pooler** | 6543 | The app at runtime |
| `DIRECT_URL` | **Session pooler** | 5432 | Migrations and `pg_dump` |

```bash
cp .env.example .env
```

```dotenv
# Transaction pooler. ?pgbouncer=true is required: it does not support prepared statements.
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Session pooler, used only by migrations.
DIRECT_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Note the username is `postgres.<project-ref>`, **not** plain `postgres`.

If connecting fails with `Tenant or user not found`, the region in the hostname is wrong — copy the
hostname verbatim from your dashboard's Connect panel.

3. Generate a session secret and paste it in as `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

4. Create the schema and seed the settings and demo accounts:

```bash
npm install
npm run db:migrate
npm run seed
npm run dev
```

Open <http://localhost:3000> and sign in at `/login`.

### Demo accounts

`npm run seed` creates one account per role, plus two technicians so that "a technician cannot see
another technician's jobs" is something you can check by signing in and looking.

| Email | Role |
|---|---|
| `admin@cimmeriancrane.example` | Administrator |
| `dispatch@cimmeriancrane.example` | Dispatcher |
| `ahmad@cimmeriancrane.example` | Technician |
| `raj@cimmeriancrane.example` | Technician |
| `store@cimmeriancrane.example` | Storekeeper |
| `finance@cimmeriancrane.example` | Finance |

The password is `cimmerian-dev-2026`, or whatever you set `SEED_PASSWORD` to.

> **These are development accounts.** The password is published in this repository, so the seed only
> creates them when `DATABASE_URL` points at this machine. If you are using a hosted database — the
> Supabase project above, say — it skips them and prints why; set `SEED_DEMO_USERS=true` to say you
> meant it. Before this system is used for real work, change every password or delete the accounts.

### Using a local database instead

If you have Docker, `npm run db:up` starts a Postgres on port 5432 and the commented block in
`.env.example` gives you the matching URLs. Everything else is identical — no code knows which
database it is talking to.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on <http://localhost:3000> |
| `npm run verify` | `typecheck && lint && test` — the gate before every commit |
| `npm run test` | Vitest unit tests — fast, no database needed |
| `npm run test:integration` | Vitest against the real database (needs `DATABASE_URL`) |
| `npm run test:e2e` | Playwright end-to-end |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run seed` | Seed data (idempotent) |
| `npm run db:up` / `npm run db:down` | Start / stop the bundled local Postgres |

Scheduled work runs from Vercel Cron against `/api/cron/daily` (see `vercel.json`) — there is no
separate worker process. The full command list is in [`CLAUDE.md`](CLAUDE.md).

---

## What works today

### Slice 3 — sites and cranes

- **Sites** belong to a customer and can be added from its record; each one carries the two things
  that are useless once a technician is already at the gate — the address and the access notes — plus
  induction requirements, operating hours and coordinates. A site never moves to another customer:
  that would silently move every crane, job and ticket on it to another company. A site cannot be
  archived while cranes are still on it, because they would vanish from the register while staying
  attached to something invisible.
- **The crane register** at `/cranes`: search by asset tag, serial number, brand, model, statutory
  registration number, site or customer; filter by status and type. These are the fields a
  certificate or statutory examination actually cites, which is why they are the ones recorded.
- **Crane detail** at `/cranes/[id]`: the record, its site, its restriction state, and the add/edit
  forms. From there a crane can be restricted, unrestricted or archived.
- **Restriction is a safety action**, so it cannot happen without a reason: the schema requires one,
  a database CHECK constraint enforces it, and the reason is stored on the crane itself — the
  technician at the machine needs to read it there, not in an audit log they cannot open.
- **A crane is never deleted.** One with job or report history cannot be archived at all; retiring it
  is a status (decommissioned), because a report that cites a crane which no longer exists is
  worthless.
- **QR labels** at `/cranes/[id]/label`: a printable sticker carrying the asset tag, the site and a QR
  code encoding a URL to the crane record. Scanning it with any phone camera opens the record; a
  signed-out scanner is sent to sign in rather than shown the register. The token is random, fixed and
  separate from the asset tag, so correcting a mis-typed tag does not orphan the sticker already on
  the machine. The alphabet omits I, L, O and U so a damaged label cannot be misread.
- **CSV import** at `/cranes/import`, on the same preview-then-apply footing as customers, resolving
  each row's site name against that customer's sites.
- **Tests** — 115 unit tests, and 80 integration tests against the real database, including 18 for
  sites and cranes: duplicate site names, cross-customer ids, archive rules, restricted-reason
  enforcement, and isolation (a technician with no job sees no cranes and gets nothing back from a
  scanned token; finance can read sites but not write them).

Next: **slice 4 — job types, templates and tickets.**

### Slice 2 — customers and contacts

- **Customers** at `/customers`: search by name, trading name or UEN, filter by status, and add a
  new customer. Creating one takes you straight to its record, because the next thing anyone does is
  add its contacts.
- **Customer detail** at `/customers/[id]`: overview, billing address, payment terms, notes, and the
  contact list. The tabs for sites, cranes, jobs and invoices are visible but disabled — they fill in
  as each slice lands.
- **Contacts** belong to a customer, optionally to one of its sites. There is exactly one primary
  contact per customer: marking another primary clears the previous one, because the invoice and the
  dispatch sheet both need one unambiguous person to call.
- **Archive, never delete.** Archiving a customer or contact hides it from lists and leaves its job
  and crane history readable. Every create, update and archive is written to the audit log with only
  the fields that changed.
- **Permissions** are enforced in the service, not the page: a technician cannot list or open a
  customer at all, a finance user can read but not write, and a mis-typed id belonging to another
  customer is indistinguishable from one that does not exist.
- **CSV import** at `/customers/import`. Choose a file, press **Preview**, and you see row by row
  what would be created and what would be skipped, before anything is saved. Only then does the
  **Import** button appear. Re-importing the same file is harmless: a name that already exists is a
  skip, not a duplicate. One bad row blocks the whole file — importing half a spreadsheet and leaving
  someone to work out which half is worse than fixing the file. The apply step re-validates the file
  from scratch rather than trusting the preview, and writes the whole thing in one transaction.
- **Tests** — 96 unit tests, and two integration suites (customers, and the importer) running against
  the real database: duplicate names, the single-primary rule, cross-customer site ids, archive
  behaviour, audit diffs, preview-writes-nothing, and run-twice-changes-nothing.
- Slice 3 finished the customer record: its Sites tab now lists real sites and links to each one, and
  the jobs and invoices tabs are still waiting on their slices.

### Slice 1 — authentication, roles and permissions

- **Sign in** at `/login`. Sessions are JWT cookies carrying only the user id; the role is read from
  the database on every request, so deactivating someone or changing their role takes effect on their
  next page load rather than whenever a token expires.
- **Passwords** are hashed with scrypt from Node's standard library — memory-hard, no native build
  step, and the stored hash records its own parameters so they can be raised later without
  invalidating existing logins.
- **Rate limiting** on sign-in, by email *and* by client IP. The email bucket cannot be forged, so
  guessing one account's password is bounded no matter how many addresses an attacker uses.
- **The permission map** (`src/server/auth/permissions.ts`) is the only place a role maps to what it
  may do. A technician signing in sees no Users link, and typing `/admin/users` gets a refusal from
  the server, not a hidden button.
- **Row-level scoping** (`src/server/auth/scope.ts`) is the second half: the permission map says
  whether a role may read jobs, the scope filters say *which rows*. It fails closed — a role with no
  read capability gets a filter matching nothing, so forgetting to add a role denies access rather
  than opening it.
- **User administration** at `/admin/users`: create, edit, change role, deactivate, reset password.
  Every change is audit-logged, and the audit log records that a password changed without ever
  recording the password or its hash. A technician login creates the linked technician record that
  job scoping depends on, and the last active administrator cannot be demoted or deactivated — by
  anyone, including themselves.
- **Tests** — 49 unit tests, 24 integration tests against the real database, and end-to-end coverage
  of signing in, being refused, and being locked out.

### Slice 0 — foundations

- **`/api/health`** — reports application and database status, for load balancers and smoke checks.
- **`/`** — public landing page: a sign-in link when signed out, a link to the dashboard when in.
- **Settings** — timezone, currency, GST rate, reminder offsets and the compliance notice live in the
  database, seeded by `npm run seed` and editable later in Admin. They are not constants in code.
- **Document numbering** — `JOB-2026-0001`, `RPT-2026-0001` and friends, issued from a single atomic
  database operation so two concurrent requests can never receive the same number. The year is
  computed in the operating timezone, not UTC.
- **Audit service** — `withAudit()` runs a mutation and its audit row in one transaction, recording
  only the fields that actually changed. Every business write goes through it.
- **Database-enforced rules** — a job cannot be `ON_HOLD` without a reason, and a crane cannot be
  `RESTRICTED` without one. Both are Postgres CHECK constraints *and* service-layer validation, so no
  future code path can create a violating row. `npm run test:integration` proves the database itself
  refuses them.
- **Error handling** — structured JSON logging, route and global error boundaries.
- **Tests** — unit tests run with no database; integration tests run against the real database, each
  wrapped in a transaction that is rolled back, so the suite leaves no rows behind. Playwright covers
  the browser.

Next: **slice 2 — customers and contacts.**

---

## Database backups

The brief requires automated backups to be documented rather than implemented, because the mechanism
belongs to whichever Postgres you run.

- **Supabase** — enable **Point in Time Recovery** under Project Settings → Database → Backups. The
  free tier takes daily logical backups; PITR is a paid add-on and is what you want in production.
  Take a manual backup before any schema migration that is not purely additive:

  ```bash
  pg_dump "$DIRECT_URL" --format=custom --file="backup-$(date +%Y-%m-%d).dump"
  ```

- **Self-hosted Postgres** — a nightly `pg_dump` to off-machine storage, plus a tested restore. An
  untested backup is not a backup; restore into a scratch database quarterly and confirm the row
  counts.

Migrations should be reversible where possible. Never edit an applied migration — add a new one.

---

## Deployment — Vercel + Supabase

The app is built for Vercel, which shapes the architecture in ways worth knowing before you deploy:

| | |
|---|---|
| **Runtime** | Node, never Edge. Anything reaching Prisma must not be on the Edge runtime. |
| **Prisma** | Generated by `postinstall`; the client is cached between function invocations. |
| **No worker** | There is no background process. Scheduled work is Vercel Cron (`vercel.json`) calling `/api/cron/daily`. Immediate work — rendering a report PDF on approval — runs inside that request. |
| **No durable disk** | Uploaded files go to Supabase Storage, in a private bucket, served by signed URL. Uploads go **from the browser directly to Supabase** with a short-lived signed upload URL, because a Vercel function request body is capped at 4.5 MB. |
| **PDF** | `@react-pdf/renderer` — pure JavaScript. No Chromium, no runtime image. |
| **Rate limiting** | The `RateLimitBucket` table, so every function instance shares one limit. |

Environment variables to set in Vercel (Project → Settings → Environment Variables):

```
DATABASE_URL, DIRECT_URL, AUTH_SECRET, APP_BASE_URL (your https URL),
STORAGE_DRIVER=supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
SUPABASE_STORAGE_BUCKET=cimmerian-files, CRON_SECRET, EMAIL_DRIVER, EMAIL_FROM,
DEFAULT_TIMEZONE, DEFAULT_CURRENCY, DEFAULT_GST_RATE
```

Then:

1. `npm run db:deploy` from your machine once, to apply migrations to the production database. The
   build does not migrate; keep it that way, so a deploy cannot half-apply a schema change.
2. Keep the Supabase project's PITR or daily backup on before real data goes in.
3. The health endpoint is `/api/health` — point an uptime check at it.

`/api/cron/daily` requires `Authorization: Bearer $CRON_SECRET` in production. If `CRON_SECRET` is
unset in a production deployment, the endpoint refuses every request rather than running open.

---

## Troubleshooting

**`Invalid environment configuration`** — `.env` is missing or incomplete. Compare it against
`.env.example`; `DATABASE_URL` is the usual culprit.

**Home page says database `down`** — the connection string is wrong, or on Supabase the project is
paused. Confirm `DATABASE_URL` uses port `6543` with `?pgbouncer=true` for the app, and that
`DIRECT_URL` uses port `5432`.

**`Tenant or user not found`** — the region in the pooler hostname is wrong. It is not related to
your password or project ref. Take the hostname verbatim from your dashboard's Connect panel; do not
guess the region from where the company is located.

**`db.<project-ref>.supabase.co` does not resolve** — expected on IPv4-only networks. Newer Supabase
projects expose that direct hostname over IPv6 only. Use the session pooler (port 5432) instead, as
described above.

**Migrations fail with a prepared-statement error** — `DATABASE_URL` is being used for migrations
instead of `DIRECT_URL`. Check the `directUrl` line in `prisma/schema.prisma`.

**`@prisma/client did not initialize yet`** — run `npx prisma generate` (or `npm run db:migrate`,
which does it for you).

**Sign-in always fails with "Email or password is incorrect"** — either the seed has not run, so no
accounts exist, or you have hit the rate limit: 10 failed attempts for one email, or 30 from one
address, in 15 minutes. The counters live in the `RateLimitBucket` table, so restarting the dev
server no longer clears them; delete the rows instead (`DELETE FROM "RateLimitBucket";` in the
Supabase SQL editor, or wait out the window). If `DATABASE_URL` points at a hosted database, the seed
skips the demo accounts by design — set `SEED_DEMO_USERS=true` if you really want them there.

**You were signed out without asking** — an administrator reset your password. That ends every
session opened before the reset, including yours if you did it yourself.
