# Cimmerian Crane Services — Helpdesk &amp; Job Management

System of record for crane servicing, breakdown repairs, inspections, load testing, parts and compliance
documents. Replaces spreadsheets, WhatsApp threads and paper forms.

- **Starting a fresh session?** [`KICKOFF.md`](KICKOFF.md) — where the build stands and what is left
- Conventions, stack and rules that must never be violated: [`CLAUDE.md`](CLAUDE.md)
- Architecture, screens and the phase plan: [`docs/PLAN.md`](docs/PLAN.md); the schema: [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)
- Assumptions made where the brief was silent: [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md)

**Status: slices 0–39 are built — all four phases complete** (see [`docs/SLICES.md`](docs/SLICES.md)). Phase 4: slice 29 gives a customer's
**contracts** a screen on its customer page — type, reference, term, renewal, covered cranes and the
response/resolution targets agreed — written as the contract-scoped SLA rows a new job already
resolves; slice 30 makes the **company-wide SLA targets** editable at `/admin/sla` and puts every
contract renewing or overdue in a board on `/customers`; slice 31 opens the **customer portal** —
a `CUSTOMER` login saw nothing before it, and now sees its own jobs, cranes, certificates and issued
reports at `/portal`, read-only; and slice 32 puts **profitability** side by side with the invoices — revenue
against parts cost per customer, contract and job type at `/reports/profitability`; slice 33 adds
**technician utilisation** at `/reports/utilisation` — hours on the tools and on the road against the
working hours available, from the job status history; and slice 34 adds the **calibration register** at
`/calibrations` — the test weights, load cells, vans and tools the schedule books, with the date each
one's calibration runs out and the certificate from the lab; and slice 35 orders the day's visits into a
**round** on `/schedule` — which site is on the way to which; and the WhatsApp/SMS adapters, the
Xero push and the notification inbox close it. What each slice added, and how to try it, is in
[`docs/SLICES.md`](docs/SLICES.md).

---

## Prerequisites

| | |
|---|---|
| **Node.js 20.11+** | Required. Everything else is installed by npm. |
| **PostgreSQL** | Either a hosted Supabase project (what this team uses) or the bundled Docker Compose service. |
| **Docker** | Optional — only if you prefer a local database over Supabase. |

There is nothing else to install. Playwright's Chromium is fetched by npm the first time the end-to-end
tests run.

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
# connection_limit=5, not 1: at 1, the Promise.all blocks every page already uses run one-after-another.
# See README "Round trips, and why they still matter".
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5"

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
| `portal@cimmeriancrane.example` | Customer (portal, first demo customer) |

The password is `cimmerian-dev-2026`, or whatever you set `SEED_PASSWORD` to. The customer login is
created with the demo book, so it exists only when the demo estate does; it signs in at `/portal` and
sees only Jurong Port Engineering's jobs, cranes, certificates and issued reports.

> **These are development accounts.** The password is published in this repository, so the seed only
> creates them when `DATABASE_URL` points at this machine. If you are using a hosted database — the
> Supabase project above, say — it skips them and prints why; set `SEED_DEMO_USERS=true` to say you
> meant it. Before this system is used for real work, change every password or delete the accounts.

### Demo data

The same run builds a small estate to work with, so the app is never empty — and it is skipped
wherever the demo accounts are skipped, for the same reason:

- **8 customers**, active, dormant and one prospect, with 17 sites between them
- **26 cranes** with asset tags, QR values, SWL and a couple flagged *Do Not Operate*
- **Monthly-service and annual-examination schedules**, staggered from overdue to months away
- **30 completed jobs** across the job types, 10 of them with an approved, numbered report on the
  crane's timeline
- **2 open P1 breakdown tickets**, one untriaged and one already triaged, both past their response target
- **40 parts** in the main store with stock movements, 9 of them below reorder level
- the two technicians, six bookable resources and seven on-call shifts from the earlier slices

Every row is looked up by a natural key before it is created, so re-running `npm run seed` adds
nothing twice. The seeded historical reports carry a document number but no stored PDF — the seed
cannot render one; approve a report in the app and the real thing appears.

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
| `npm run test:e2e` | Playwright end-to-end (projects: `office`, `technician` at 390px, `tablet` at 800×1280) |
| `npx tsx scripts/make-icons.ts` | Re-render the launcher PNGs from the two SVGs (once, then commit) |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run seed` | Seed data (idempotent) |
| `npm run db:up` / `npm run db:down` | Start / stop the bundled local Postgres |

Scheduled work runs from Vercel Cron against `/api/cron/daily` (see `vercel.json`) — there is no
separate worker process. The full command list is in [`CLAUDE.md`](CLAUDE.md).

---

## Round trips, and why they still matter

The hosted database is Supabase in **`ap-southeast-1` (Singapore)**, the same region as the office,
so a query is a few tens of milliseconds rather than the ~400–500 ms it used to be when the project
sat in Seoul. Round-trip *count* still matters — nothing is cached, because every page is
`force-dynamic` on purpose — just less than it did. Three things keep navigation quick, in order of
effect:

1. **`connection_limit=5` on `DATABASE_URL`** (not `1`). The pages fetch their independent data with
   `Promise.all`; at a limit of 1 those queries queue up and run one after another, so a page that
   issues six queries pays for six in series. Measured against the old Seoul project: six parallel
   queries took 2517 ms at `connection_limit=1` and 1319 ms at `4`+.
2. **Loading skeletons** — `src/app/(office)/loading.tsx` and `src/app/(tech)/loading.tsx`. Without a
   `loading.tsx`, Next keeps the old screen up until the server answers, so a click looks like it did
   nothing. With one, the skeleton appears immediately and the wait is visible rather than confusing.
3. **Fetch in one wave.** A page must `Promise.all` everything it needs after `requireAuth()`.
   `getAuthContext` is already memoised per request via React `cache`, so a layout and the page share
   one lookup — but two *sequential* `await`s still cost two round trips.

If it is still too slow for day-to-day work, the real fix is a local Postgres (`npm run db:up`) for
development and keeping Supabase for deployment; the app does not care which one it talks to.


---

## The technician app on a tablet

The field side (`/m/…`) is installable — the **Install on this tablet** card on My Jobs, or Chrome's
**Add to Home screen** if the card was dismissed. It opens standalone (no browser bars), works with no
signal, and any screen width up to a 10-inch tablet.

**Updates are a tap.** A new deploy shows "A newer version of the app is ready" at the top of the
field app; until it is tapped the old build keeps serving, and the report draft is saved before the
reload. An app that is closed updates on its next launch by itself. To check it by hand: `npm run
build && npm start`, change a visible string, rebuild, reload — the banner should appear, the draft
should survive the tap.

**Plain HTTP is not supported.** The service worker, `getUserMedia` and `crypto.randomUUID` all need a
secure context, so test against the deployed HTTPS URL, or `npm run build && npm start` on
`localhost`. `npm run dev:lan` is for checking the layout on a real device over the LAN — it gives you
the screens, not offline mode.

**Launcher icons** are committed PNGs rendered from the two SVGs in `public/icons/`. If the mark
changes, re-run once and commit the result — it is not part of any build:

```bash
npx tsx scripts/make-icons.ts
```

**Offline QA** (production build only — the worker is off under `npm run dev` by design): sign in, open
My Jobs, `npm run build && npm start`, then Chrome DevTools → Application → Service Workers. Cut the
network, reload, confirm the last job still opens and a report can be filled and submitted; restore the
network and confirm it uploads once. Signing out must clear IndexedDB **and** Cache Storage — check
both, because a shared tablet is the normal case.

---

## Play Store (slice 45)

The tablet app can be shipped as an Android App Bundle with a Trusted Web Activity — the same
codebase, wrapped. **No app code changes are needed:** the only server-side piece is
`/.well-known/assetlinks.json` (rendered by `src/app/api/assetlinks/route.ts`, rewritten in
`next.config.ts`), which tells Android the wrapper may open this origin without Chrome's address bar.

Everything else is console and signing work, deliberately outside the repo. **Never commit the
keystore or Bubblewrap's generated `android/` project.**

1. **Set the env** in Vercel: `ANDROID_PACKAGE_NAME` (the `packageId` in `twa-manifest.json`) and
   `ANDROID_SHA256_FINGERPRINTS` — comma-separated. Without them the route 404s and the site works
   as before.
2. **Create the upload key** (Bubblewrap asks for this and writes `android.keystore`, which is
   gitignored):

   ```bash
   npx @bubblewrap/cli init --manifest https://<host>/m/manifest --manifest <path-to-twa-manifest.json>
   ```

   Copy the manifest URL and `host` into `twa-manifest.json` first — the committed file has
   placeholders. Get the fingerprint with:

   ```bash
   keytool -list -v -keystore android.keystore --alias android
   ```

3. **Build:** `npx @bubblewrap/cli build` produces `app-release-bundle.aab`. Upload that in Play
   Console → Internal testing.
4. **Add the Play App Signing fingerprint.** Play re-signs the bundle, so the certificate your
   deployed app actually runs with is *not* the upload key. After the first upload, Play Console →
   App integrity → App signing key certificate shows its SHA-256; append it to
   `ANDROID_SHA256_FINGERPRINTS` and redeploy. Until then the internal-test build runs with the URL
   bar visible.
5. **Verify:** `curl https://<host>/.well-known/assetlinks.json` returns the package and both
   fingerprints. Google's [Statement List Tester](https://developers.google.com/digital-asset-links/tools/generator)
   should say "verified". Install the build from internal testing and confirm there is no URL bar.

A TWA is still the web app: day-to-day changes ship as web deploys, and only the wrapper version
itself needs a Play update. Google rejects apps that are "just a wrapped website" with no offline or
native value — the offline mode, push and QR scanner are what answer that, so ship the wrapper only
after the internal testing build has been used in the field.

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
SMS_DRIVER, WHATSAPP_DRIVER, DEFAULT_TIMEZONE, DEFAULT_CURRENCY, DEFAULT_GST_RATE
```

Then:

1. `npm run db:deploy` from your machine once, to apply migrations to the production database. The
   build does not migrate; keep it that way, so a deploy cannot half-apply a schema change.
2. `npm run seed` against the same database, for the settings, job types, templates and SLA policies.
   It skips the demo accounts and demo book wherever the database is not on this machine — that is
   the guard working, not a failure.
3. `npm run admin:create` — there is no other way in. `/admin/users` needs an admin to sign in first,
   and the seed will not create one on a hosted database. Change the password at `/account/password`
   once you are in.
4. Keep the Supabase project's PITR or daily backup on before real data goes in.
5. The health endpoint is `/api/health` — point an uptime check at it.

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

## What each slice added

Every slice from 0 to 38, with how to try it, is in [`docs/SLICES.md`](docs/SLICES.md).
Slices 39+ are recorded in [`KICKOFF.md`](KICKOFF.md) and [`docs/HISTORY.md`](docs/HISTORY.md); the
tablet app (40–45) is planned in [`docs/PLAN-TABLET-APP.md`](docs/PLAN-TABLET-APP.md).
