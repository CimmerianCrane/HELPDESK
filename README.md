# Cimmerian Crane Services — Helpdesk &amp; Job Management

System of record for crane servicing, breakdown repairs, inspections, load testing, parts and compliance
documents. Replaces spreadsheets, WhatsApp threads and paper forms.

- **Starting a fresh session, or want the original brief?** [`KICKOFF.md`](KICKOFF.md) — the brief
  verbatim, the phase plan, the slice table, and where the build stands
- Conventions, stack and rules that must never be violated: [`CLAUDE.md`](CLAUDE.md)
- Architecture, data model, screens and the phase plan: [`docs/PLAN.md`](docs/PLAN.md)
- Assumptions made where the brief was silent: [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md)

**Status:** Slice 8 (offline report completion, queued and synced exactly once). See "What works
today" below.

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

### Slice 8 — completing a report on the phone

- **Fill report** on a job's crane opens `/m/jobs/<id>/report?crane=<craneId>`. The form is built from
  the job type's report template: fields, repeated table rows (findings, parts), the checklist with
  measurements, photos, both signatures, and the "is it safe to operate?" question every report ends
  with. It is the company's inspection, never an AE's statutory certificate.
- **Nothing is lost between taps.** The draft is written to IndexedDB every couple of seconds, and a
  photo or signature is kept on the phone until the office has the report. Closing the tab, losing
  signal or reloading reopens the same draft.
- **Submitting queues before it sends.** The report goes into an outbox with ids generated on the
  phone. The sync endpoint uploads each photo and signature to storage, then writes the report,
  findings, stock movements and audit entries in one transaction with a `SyncReceipt` keyed by the
  phone's id — so a retry after a dropped connection returns the first result instead of creating a
  second report. A second report for the same job and crane is recorded in `ConflictLog` and the
  technician's data wins.
- **The header says what is happening:** "N reports waiting to upload" with Retry, which is also the
  pending badge. A report already on the server shows as submitted rather than offering a second one.
- **Parts are stock movements.** Choosing a part in the form writes an `ISSUE` `StockMovement` when
  the report lands, never a JSON list. Photos are compressed to 1600px JPEG on the phone and the size
  and type are checked again on the server.
- **To try it:** sign in as `ahmad@cimmeriancrane.example` / `cimmerian-dev-2026`, open his breakdown
  job, tap **Fill report**, answer the checklist, sign, then DevTools → Network → **Offline** and
  submit. Turn the network back on and the header flushes the queue.
- **Tests** — 20 unit tests for report validation and upload-token signing, 8 integration tests
  (template drift refused, another technician's job is a 404, replay creates one report, conflicts
  logged, parts become movements) and one end-to-end test that submits offline and asserts exactly one
  report with an audit entry once the signal returns.

### Slice 7 — the technician's phone

- **`/m/jobs`** is a phone screen: today's work first, then tomorrow, then the rest of the week by day,
  then anything still waiting for a date. Each job opens **`/m/jobs/<id>`** — when and where, who to
  ask for with a tap-to-call number, access and induction notes, the cranes with their recent reports
  and certificates, a red **Do Not Operate** block for a restricted crane, and the job type's
  checklist.
- **It is offline-first.** A service worker (Serwist) caches the pages you have visited, and a sync
  call downloads the technician's next jobs, cranes, checklist items, parts and site contacts into
  IndexedDB (Dexie). With the network cut, the list still loads, and a deep link to a job you never
  opened before renders from the cache behind a "No signal — showing what was saved on this phone"
  panel. It re-syncs when the signal returns.
- **It is installable.** `/m/manifest` declares the app with `start_url` and `scope` under `/m/`, so an
  installed shortcut opens the phone screen rather than the office app. There is a theme colour, an
  SVG icon, and the iOS-specific metadata Safari needs.
- **Office logins are turned away.** `/m/jobs` is for somebody with a technician record; a dispatcher
  who lands there is redirected to `/dashboard`, because an empty job list reads as "no work today".
- **Signing out clears the cache first.** Site phones are shared, so the next person must not open the
  app onto the previous technician's jobs.
- **Offline is a production-only behaviour.** The service worker is deliberately disabled under
  `npm run dev` — a worker that survives the dev server serves an hour-old page while you edit, and
  the dev overlay cannot tell you that. To try it:
  ```bash
  npm run build
  npm start            # http://localhost:3000
  ```
  Sign in as `ahmad@cimmeriancrane.example`, open `/m/jobs`, then in DevTools → Network choose
  **Offline** and reload. `npm run test:e2e` includes this reload test and skips it against the dev
  server, saying why.
- **Tests** — 10 integration tests for the phone's read layer (own work only, finished work excluded,
  another technician's job is a 404 rather than a 403, restricted cranes surfaced as warnings, the
  sync bundle scoped to the technician's sites) and 4 end-to-end tests for the phone shell, the
  office-login redirect, the manifest and the offline reload.

### Slice 6 — scheduling, dispatch and the on-call roster

- **The board** at `/schedule` shows a day or a week: technicians down the side, days across the top,
  visits in the cells. Drag a visit onto another technician or another day and it moves — the
  assignment and the date change in one transaction, so a refused competency also leaves the date
  alone. The clock time travels with the card: Tuesday 08:00 dropped on Wednesday is Wednesday 08:00.
- **Conflicts are shown where they happen.** A card already double-booked, or falling in somebody's
  leave, is marked, and the warning is computed by the same pure function the assignment service
  refuses with — a board that warns differently from the service would be worse than one that does
  not warn at all.
- **Assignment** from the job screen: a missing competency blocks (when the setting says so) and is
  never overridable; a double-booking or a leave clash warns and needs an explicit override **and** a
  written reason, which gets its own audit row. Assigning a dated job moves `TRIAGED`/`APPROVED` to
  `SCHEDULED` through the normal status machine.
- **Leave** and the **on-call roster** are at `/schedule/roster`. On-call is a list of shifts, so
  overlapping handovers are fine and the page names the hours nobody is covering. Leave is recorded
  even when it clashes with booked work; the clash is named in the audit entry and marked on the board.
- **Resources** — vans, test weights, load cells, tools — can be booked onto a job for the visit's own
  span or a span of its own. An overdue calibration or a maintenance status warns; a retired item is
  refused; two jobs wanting the same weight at once is flagged on the board.
- **Priority bumps** send a scheduled visit back to `APPROVED` with its dates cleared, recording a
  `ScheduleBump` row (with the old dates, so it can be undone) and an audit entry naming who decided,
  what took the slot, and why. The reason is mandatory. The bump frees the slot; it does not place the
  incoming job.
- **Dispatch** from the job screen builds the message from rows: address, who to ask for, access and
  induction notes, the cranes with their recent approved reports and certificates (restricted ones
  flagged Do Not Operate), and the job type's checklist. It writes an in-app and an email notification
  per technician, each with its own send state, and moves `SCHEDULED` to `DISPATCHED` through
  `JobStatusHistory`.
- **Wall-clock time is explicit.** A `datetime-local` value means wall time in the operating timezone,
  converted in `src/lib/time.ts` and never read as UTC. It is unit-tested across a daylight-saving
  change, where a week is 169 hours rather than 168.
- **Tests** — 27 unit tests for the scheduling rules (overlap arithmetic, conflict detection,
  competency matching, on-call gaps, wall-clock conversion) and 37 integration tests for the board,
  assignment, override auditing, leave, the roster, resources, bumps, dispatch and the drag gesture.

Next: **slice 7 — the technician PWA.**

### Slice 5 — tickets become jobs, and the job lifecycle

- **Jobs** at `/jobs`, `/jobs/new` and `/jobs/[id]`. Work can be raised directly by the office or
  made from a triaged ticket — one ticket can become several jobs, and each job covers one or more
  cranes. Numbers are allocated atomically on save (`JOB-2026-0001`).
- **The site is resolved, never guessed.** A job needs a site because somebody has to drive there;
  when none is given it comes from the crane, and cranes at two sites are refused rather than filed
  at the first one. Cranes must belong to the job's customer.
- **A status machine, not a free-text status.** `src/server/jobs/status.ts` holds every legal
  transition (`NEW → TRIAGED → SCHEDULED → … → CLOSED`, with quote optional, on-hold and cancel as
  branches, and rework from completed). The service refuses anything absent from the map; the form
  only offers what will be accepted, but the map is the rule.
- **Every move is recorded.** Each transition writes a `JobStatusHistory` row (from, to, who, when,
  note, hold reason) and an audit entry. Status stamps (`respondedAt`, `onSiteAt`, `completedAt`,
  `reviewedAt`, `invoicedAt`, `closedAt`) are written once — rework keeps the first arrival time.
- **On hold requires a reason**: a Zod rule, a service rule, and the database CHECK constraint
  already in the schema. Coming off hold clears the reason; the history keeps it.
- **SLA deadlines are snapshotted at creation** from the SLA policy (contract override first), so a
  later policy edit cannot rewrite whether a job met its target. Job screens show response and
  resolution state from those stored deadlines.
- **P1 job alerts** reuse the ticket fan-out: an in-app row and an email row per dispatcher. A ticket
  that becomes jobs does not alert a second time — the call already did.
- **Conversion** marks the ticket `CONVERTED` and stamps `closedAt`, which stops the ticket's clocks:
  from then on the jobs carry the work and the history stays linked to the call.
- **The job board** filters by search text, status and priority, and counts open jobs, jobs past an
  SLA target, and jobs on hold. Lists are capped at 500 rows; pagination arrives with the fuller
  job list in slice 10.
- **Tests** — 16 unit tests for the transition map, hold rules, timestamp fields and job validation;
  17 integration tests for numbering, SLA snapshots, history and audit rows, one-way stamps,
  cross-customer and two-site refusal, conversion, capability checks and soft-deleted visibility.

### Slice 4 — job types, templates and tickets

- **Fourteen job types** are seeded as editable records: scheduled servicing, breakdown, visual
  inspection, load test, statutory exam support, installation, re-certification, repair, wire rope /
  hook, survey and quote, follow-up, warranty, rental / supply-only, and training. Each carries a
  default priority and, for the first four, a default checklist and report template.
- **Four templates**, also seeded: a 39-item servicing checklist, a 9-item breakdown checklist, plus
  visual inspection and load test. Each has a versioned report schema declaring its sections and
  fields as data, because a report has to be validated on submit, re-rendered years later and
  superseded without being edited. The seed validates every definition before storing it and never
  overwrites a template that already exists — a new copy is version 2.
- **Tickets** at `/tickets`, `/tickets/new` and `/tickets/[id]`: record a call against a customer,
  optionally a site and crane, with the source, a description and a first-guess priority. The
  customer → site → crane choice is a cascade, so the person taking the call does not wait on a
  round trip. Numbers are allocated atomically (`TKT-2026-0001`) when the ticket is saved.
- **Triage** is a separate step from recording, because the two happen at different moments. It sets
  the priority, records the decision and stamps `respondedAt` the first time — a later re-triage
  never improves a missed target.
- **SLA timers** run from `reportedAt`, not from triage: the customer was promised a response when
  they phoned. Tickets show response and resolution targets, due times, time remaining and breach
  state. The minutes are seeded in `SlaPolicy` and are placeholders for the real contractual ones;
  contract overrides are already resolved preferentially.
- **P1 alerts** go to every dispatcher and administrator in the same transaction that creates the
  ticket: an in-app notification and an email through the adapter (console implementation in Phase
  1). The two channels are separate rows, so a failed send is visible rather than swallowed.
- **Close, cancel and reopen**: both outcomes stamp `closedAt` and append the note to the ticket
  rather than replacing the triage decision. Reopening returns it to NEW with the clock running
  again — raising a duplicate instead would split the history.
- **Technician tickets**: a technician can raise a ticket and see the ones they raised, but not the
  intake board. `ticket.triage` stays with the office.
- **Tests** — SLA boundary arithmetic, ticket validation and transitions, the template catalogue, and
  integration coverage for numbering, audit rows, the one-way stamps, cross-customer crane checks,
  P1 fan-out and technician isolation.

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
