# Cimmerian Crane Services — Helpdesk &amp; Job Management

System of record for crane servicing, breakdown repairs, inspections, load testing, parts and compliance
documents. Replaces spreadsheets, WhatsApp threads and paper forms.

- Conventions, stack and rules that must never be violated: [`CLAUDE.md`](CLAUDE.md)
- Architecture, data model, screens and the phase plan: [`docs/PLAN.md`](docs/PLAN.md)
- Assumptions made where the brief was silent: [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md)

**Status:** Slice 1 (authentication, roles and the permission map). See "What works today" below.

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

The full list, including the background worker that arrives in slice 5, is in [`CLAUDE.md`](CLAUDE.md).

---

## What works today

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

## Deployment notes

- Run the app and the background worker as separate processes; they share one database.
- Reports are rendered to PDF by headless Chromium (Playwright), so the runtime image needs Chromium's
  shared libraries. Render happens in the worker, never in a user's request.
- Set `AUTH_SECRET`, and point `STORAGE_DRIVER` at S3 (and `EMAIL_DRIVER` at SMTP) instead of the
  local disk and console defaults.
- The health endpoint is `/api/health` — wire it to your load balancer.

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
address, in 15 minutes. Restart the dev server to clear it. If `DATABASE_URL` points at a hosted
database, the seed skips the demo accounts by design — set `SEED_DEMO_USERS=true` if you really want
them there.

**You were signed out without asking** — an administrator reset your password. That ends every
session opened before the reset, including yours if you did it yourself.
