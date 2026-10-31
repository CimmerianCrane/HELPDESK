# PLAN.md — Cimmerian Crane Services Helpdesk

Architecture, data model, screens and build plan. Conventions and non-negotiables live in `../CLAUDE.md`.
Assumptions where the brief was silent live in `ASSUMPTIONS.md`.
Each slice's fixed decisions as built live in `PLAN-SLICES.md`; this file is the plan, that one is the record.

**Status: Phase 1 complete — slices 0–11 built against the live database, on Vercel hosting, with the
Phase 1 acceptance path (slice 11's path (a)) passing end to end. Phase 2 is sliced in §7 and **starts at
slice 12**. Phases 3–4 are outline only.**

---

## 1. Architecture

Single Next.js (App Router) application, not a monorepo. One deployable, one database, one language.

```
Browser (office, desktop-first)          Phone/tablet (technician PWA, mobile-first, offline)
        │                                          │
        │  server actions / RSC                    │  Dexie (IndexedDB) ── outbox queue ──┐
        ▼                                          ▼                                      │
┌──────────────────────── Vercel — Next.js, Node runtime ──────────────────────────────┐ │
│  route handlers + server actions                                                     │◄┘
│    validate (Zod) → authorize (permission map) → service → audit → respond           │
│                                                                                      │
│  src/server/*   services: customers cranes tickets jobs schedule reports             │
│                 documents inventory audit sla                                        │
│  adapters       storage (supabase│disk)  email (console│smtp)  notify (in-app│email) │
│  cron           /api/cron/daily (Vercel Cron): reminders, retries, cleanup           │
└──────────────────────────────────────────────────────────────────────────────────────┘
        │                                     │                          │
   Supabase Postgres (Prisma)          Supabase Storage          @react-pdf/renderer
   business data + rate limits         photos, PDFs, certs       in the approving request
```

**Deployment shape changed this plan.** The original design assumed one always-on host, so it could
run a pg-boss worker, headless Chromium and a local disk. The application is hosted on **Vercel**,
which forbids all three: functions are short-lived, the filesystem is read-only apart from `/tmp`,
and there is no background process. The substitutions are:

| Original assumption | On Vercel | Consequence |
|---|---|---|
| pg-boss worker (`npm run worker`) | Vercel Cron hitting a protected route, plus work done inline in the request that causes it | No queue process to operate. A report PDF renders when it is approved (~1–2s); the daily cron retries anything that failed and evaluates reminders. |
| Chromium (Playwright) HTML→PDF | `@react-pdf/renderer` — pure JavaScript, no browser binary | Templates become versioned React components rather than HTML+CSS. Reproducibility is kept: the render function is selected by `Report.templateVersion` and the stored `data`, never by the current template. |
| Local disk / S3 for files | Supabase Storage, private bucket, signed URLs | Uploads go **directly from the browser to Supabase** with a short-lived signed upload URL, because a Vercel function request body is capped at 4.5 MB — smaller than a phone photo. The server never proxies the bytes. |
| In-process login rate limit | `RateLimitBucket` table | Shared by every function instance. One atomic statement increments and resets the window. |
| `npm run worker` in `package.json` | `/api/cron/daily` in `vercel.json` | The cron endpoint requires `CRON_SECRET` in production. |

**Request path rule.** A route handler or server action does exactly four things: parse input with Zod, ask the
permission map whether this user may do this, call one service function, return a typed result. No business logic in
`src/app/`. Services are plain functions taking `(ctx: Context, input)`, where `Context` carries the authenticated user,
role, and request metadata for the audit log. Every service test calls the same entry point the UI calls.

**Why this shape.** It keeps the single hardest requirement — server-side authorization on everything, audit-logged —
in one place that can be tested without a browser or a network.

---

## 2. Decisions and justifications

The brief's defaults are kept except for the four deviations listed in `../CLAUDE.md`. Why:

| Decision | Choice | Why | Rejected alternative |
|---|---|---|---|
| PDF generation | **`@react-pdf/renderer`** | Reversed from the original plan when hosting moved to Vercel. Chromium cannot be bundled reliably in a Vercel Function (size, cold start, `maxDuration`), and the alternative — an external render vendor — adds a credential and a network hop to every report. `@react-pdf/renderer` is pure JavaScript, runs inside the approving request, and needs no runtime image. **Versioning is preserved:** each `ReportTemplate` version has its own render function, selected by `Report.templateVersion`, so an old report still re-renders exactly as issued. **Cost accepted:** report layout is written in a component DSL, not CSS; more work for photo grids and signature blocks. | Playwright/Chromium (the original choice) — operationally wrong on Vercel. A hosted render API (Browserless, PDFShift) — a vendor and credential we do not need for this volume. |
| Background jobs | **Vercel Cron + inline work** | There is no always-on process on Vercel, so a queue worker cannot exist. Work that must be immediate (rendering a PDF on approval) happens in that request; work that is time-based (reminder scan, retry of failed renders/emails, pruning rate-limit rows) runs from `/api/cron/daily`, declared in `vercel.json` and protected by `CRON_SECRET`. | pg-boss (the original choice) needs a long-lived worker and would not run. Redis/BullMQ adds a second datastore and still needs a worker. |
| Auth sessions | **JWT sessions, no `Account`/`Session` tables** | Credentials-only login. Fewer tables, no session cleanup job. Instant role change is handled by reading the user's role from the DB per request in the `Context` factory. | Database sessions add tables and a sweep job for no benefit here. |
| Money | **`Decimal(12,2)`** | Invoices, GST and job costing; binary floats are wrong for money. | `Float` is disqualifying; integer cents add conversion noise everywhere for no gain given Postgres `numeric`. |
| Offline sync | **Dexie + client-generated UUIDs + idempotency** | Client mints the id before going offline, so a retried upload upserts rather than duplicates. | Server-assigned ids cannot survive an offline create. |
| Scheduling board DnD | **`dnd-kit`** | Actively maintained, accessible (keyboard-operable), works with React 19 / App Router. | `react-beautiful-dnd` is unmaintained. |
| Tables/forms | **shadcn/ui + TanStack Table + react-hook-form** | shadcn is copy-in components we own; TanStack Table gives server-side pagination and saved filters; react-hook-form pairs with the same Zod schema the server uses. | Hand-rolled tables re-solve pagination, sorting and filter state three times. |

**Dependency discipline.** The list above is the whole "new dependency" budget. Anything else needs a line in the PR
saying why the standard library or an existing dependency could not do it.

---

## 3. Data model

The Prisma schema — every model for all four phases, with the conventions and the index set — is in
[`DATA-MODEL.md`](DATA-MODEL.md). It is a reference: the models Phase 1 does not touch yet are marked
in its headings, and `../prisma/schema.prisma` is the live schema.


## 4. Permission map

One file, `src/server/auth/permissions.ts`. Roles → capabilities. Everything else reads from it.

```ts
export const CAPABILITIES = [
  'user.manage', 'settings.manage', 'audit.read',
  'customer.read', 'customer.write', 'customer.import',
  'site.read', 'site.write',
  'crane.read', 'crane.write', 'crane.restrict', 'crane.import',
  'ticket.read', 'ticket.create', 'ticket.triage', 'ticket.assign',
  'job.read.all', 'job.read.own', 'job.create', 'job.schedule', 'job.assign',
  'job.transition', 'job.complete', 'job.approve', 'job.bump',      // bump = priority displacement, reasoned + audited
  'report.read.all', 'report.read.own', 'report.draft', 'report.submit', 'report.approve', 'report.amend',
  'finding.write', 'finding.followUpJob',
  'certificate.read', 'certificate.write',
  'schedule.manage', 'compliancerule.manage', 'sla.manage',
  'part.read', 'part.write', 'stock.move', 'stocktake.approve', 'supplier.write', 'purchaseorder.write',
  'quote.write', 'invoice.read', 'invoice.write', 'pricing.approve', 'writeoff.approve',
  'report.financial', 'dashboard.office',
] as const

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  ADMIN:       ['*'],
  DISPATCHER:  [ /* customers, sites, cranes, tickets, jobs, schedule, reports:read+approve, quotes */ ],
  TECHNICIAN:  [ 'job.read.own', 'report.read.own', 'report.draft', 'report.submit',
                 'finding.write', 'crane.read', 'part.read', 'stock.move', 'certificate.read' ],
  STOREKEEPER: [ 'part.read', 'part.write', 'stock.move', 'stocktake.approve',
                 'supplier.write', 'crane.read', 'job.read.all', 'report.read.all' ],
  FINANCE:     [ 'job.read.all', 'report.read.all', 'invoice.read', 'invoice.write',
                 'pricing.approve', 'writeoff.approve', 'report.financial', 'customer.read', 'dashboard.office' ],
  CUSTOMER:    [ /* Phase 4: own-tenant read-only, scoped by customerId claim */ ],
}
```

**Two layers, both required:**

1. **Capability check** — does this role hold the capability at all?
2. **Row-level scope** — a `job.read.own` user additionally gets a `WHERE` clause restricting to jobs they are
   assigned to; a `CUSTOMER` user is restricted to their own `customerId`. This lives in the service as a mandatory
   scope filter, not as an optional argument — services take a `scope` derived from `Context` and never accept a
   caller-supplied scope.

The tests the brief demands (technician cannot read another technician's job; cannot read another customer's data) are
written once against the service layer and reused: `tests/unit/permissions.test.ts` plus one integration test per
service that reads tenant data. This is the highest-value test in the codebase — it runs on every slice that touches
job, crane, report or customer reads.

---

## 5. Screens

**Phase 1 (built):**

*Auth* — Login, Forgot password (Phase 1: admin-triggered reset link).

*Office (desktop-first)*
- Dashboard — open P1s, SLA breaches, overdue jobs, jobs on hold by reason, awaiting invoicing, certificates expiring (Phase 2 data, tile present), next 30 days due
- Customers list (filter by status, search, CSV import) → Customer detail: Overview · Sites · Cranes · Jobs · Contacts · Contracts · Documents · Invoices
- Sites list / detail
- **Crane detail** (the most important screen) — status + restricted flag + SWL + registration header; timeline of every service, inspection, load test and breakdown; certificates; parts used; open findings; recurring-fault indicator; next-due dates; printable QR label
- Cranes list (search by tag, serial, customer, type, status)
- Tickets list / detail (triage, priority, SLA timer, convert to one or more jobs)
- Jobs list (filters: status, customer, type, technician, priority, date range, SLA state; saved filters; sortable; CSV export; list + calendar views)
- Job detail — header with SLA timers, cranes, technicians, status timeline, reports, parts, DOs, files, audit trail ("who changed what")
- Schedule board — day/week per technician, drag-and-drop, conflict warnings, competences, leave, on-call roster, resource rows
- Reports queue — submitted reports awaiting approval; approve / return; amendment flow
- Admin — users & roles, job types, checklist & report templates, SLA policy, compliance rules (with the MOM notice), settings, audit log viewer

*Technician PWA (mobile-first, `(tech)/m/`)*
- My Jobs — today / upcoming, offline indicator, pending-upload badge
- Job detail — site contact, access/induction notes, crane history summary, checklist
- Report form — checklist with measurements, work done, parts used, findings, photos
- Signatures — technician, then customer (name, designation, timestamp, or declined-with-reason)
- Parts issue, photo capture, check-in/out (GPS optional), QR/barcode scan
- On-device customer summary (offline-viewable before sync)

*Customer (Phase 4)* — portal: own cranes, reports, certificates, due dates, raise ticket.

---

## 6. Phase 1 — vertical slices

Each slice runs **database → service → API/action → UI → tests**, ends with `npm run verify`, a commit, and a
3–5 line summary. Each is independently demoable.

**Progress:** Slices 0–11 are **done**; Phase 1 is complete. Slice 11 (the end-to-end happy path and the §13 demo
estate) is summarised in `KICKOFF.md`. **The next work is Phase 2 — see §7.** The rest of this section is the plan
as written, so the slice paragraphs are a record rather than instructions.

*Slice 7* — installable phone shell with a real offline story, split in three so that each part can be
tested on its own: a **read layer** (`src/server/tech/my-jobs.ts`) that scopes every query through
`jobReadWhere` and refuses anyone without a technician record; a **sync endpoint** (`/api/tech/sync`)
that returns one bundle — jobs with their site details, crane history and checklist, plus the crane,
checklist-item, part and contact reference rows — so the phone makes one round trip, not eight; and the
**client** (Dexie cache, `SyncProvider`, `JobList`/`JobSheet`, Serwist worker with an `/offline`
fallback). The server pages and the offline shell render the same two components, so the cached screen
cannot drift from the live one. Offline is proved against a production build, not the dev server; see
`docs/ASSUMPTIONS.md` items 46–50.

*Slice 8* — the phone's report form: checklist with measurements, photos, parts used, findings, both
signatures, autosave, and an outbox that survives a dropped connection. Set out before it was written;
the four decisions that constrain everything after it:

1. **`Report.data` is the answer map the template already declares** (`src/lib/templates/schema.ts`), not a
   bag of prose. A `fields` section contributes keys to one flat answer map; a `layout: 'table'` section
   stores an array of row objects under its own section key, so table columns may reuse a name without
   colliding with a form field. The report stores the **template version** it was filled under, and
   submission validates against that version, not against whatever the template says today. This is what
   makes slice 9 able to re-render an old report exactly as issued.
2. **The outbox is a client table, and the server deduplicates by the client's id.** Every queued item
   carries a client-generated uuid; the sync endpoint writes a `SyncReceipt` keyed by that id inside the
   same transaction as the data it applied. A replay is therefore a no-op, not a second report. The test
   for this is a payload posted twice asserting a single report.
3. **Parts used on a job are `StockMovement` rows**, written when the report is submitted, and the
   report's parts list is read back from them. A JSON array of part numbers on the report would be a
   second source of truth for stock, which CLAUDE.md rule 10 exists to prevent.
4. **Photos and signatures are `File` rows behind a storage adapter**, uploaded directly from the browser
   to Supabase Storage with a signed URL, compressed on the phone first and re-validated on the server.
   The adapter interface is `disk | supabase` because the tests and the dev machine must not need the
   bucket.

Build order: `reportReadWhere` → report service + validation tests → storage adapter and file service →
the form with Dexie autosave → the outbox endpoint with the replay test → Playwright offline completion.
`KICKOFF.md` carries the same list with the file paths, as the entry point for the next session.

*Slice 8 as built* — the four decisions above held, with five details worth recording because slice 9 inherits
them. **No server-side drafts:** a draft is a Dexie row until submit, so the phone is the only place one exists
and the server never holds a report the technician has not signed. **Files attach to the job, not the report:**
photos and signatures are uploaded before the report exists (`File.entity = 'Job'`, `jobId` set), and the report
refers to them by id; a client-generated file id makes a retried upload an upsert. **Checklist answers live in a
reserved `Report.data.checklist` key** keyed by `ChecklistItem.code`, validated against the checklist template
the job type points at, because the checklist and report templates are versioned independently. **The outbox
item id is the report id**, so re-queuing after a failed upload replaces the item rather than adding a second;
the server's `SyncReceipt` uses the same id inside the submission transaction. **Disk uploads are signed with an
HMAC token** (`/api/files/store?key=…&token=…`) because the disk driver has no bucket to issue its own URL, and
`verifyUploadToken` is unit-tested for tampering and expiry. A template version mismatch is refused rather than
migrated; the phone detects the drift when it loads the draft and starts the form again with a notice.

*Slice 9* — approval, the lock and the PDF. Set out before it was written as "a submitted report becomes a
document with a number, an approval trail and an amendment path". Five decisions carry it, and each is recorded
in `ASSUMPTIONS.md` items 62–71:

1. **The renderer is data-driven, not a component per template** — reversing the plan's own assumption.
   `renderReportPdf` takes the template schema **stored on the report** and the stored answers; a component per
   template would be a third copy of a shape the office edits as data. Reproducibility is then a property of the
   inputs, which is what the slice-9 test checks: approve a report, add a version-2 template, repoint the job
   type at it, re-render through the same loader, and diff the bytes.
2. **PDF timestamps are pinned to the approval time.** react-pdf writes `new Date()` into the info dictionary, so
   the "re-render and diff" test cannot pass without `Document.creationDate`/`modificationDate`. This was found
   experimentally, not from documentation.
3. **`RETURNED` is a new status.** Approve / return / correct are three decisions, and a return has to be
   distinguishable from "not looked at" without giving the report a number it never earned.
4. **The email is outside the transaction, the PDF inside it.** A dead mail server must not undo an issued
   document; an issued document must not exist without its PDF. `emailedToCustomerAt` null after `approvedAt` is
   the retry signal `/api/cron/daily` sweeps.
5. **Photos are snapshotted as `Report.data.photoFileIds`.** Slice 8 validated them and dropped them; without
   this the issued document could not embed the photographs that were attached when it was signed.

Two gaps in slice 8 surfaced here and were fixed rather than worked around: the dropped photo ids, and the disk
driver's `signedDownloadUrl`, which threw. Download tokens now carry a signed purpose so an upload grant cannot
be replayed as a download grant — one line in `signUploadToken` that turns a read capability into a different
capability, which a test pins in both directions.

One bug reached the end-to-end suite and not the integration suite: `getSettings()` read through the global
Prisma client from inside an open `withAudit` transaction. The integration tests run against a local-shaped pool
and passed; the app runs against the Supabase transaction pooler with `connection_limit=1`, so the read waited
for a connection the transaction itself was holding and every approval died on `P2024`. `getSettings` now takes
the caller's `Tx`, and the same latent deadlock in seven scheduling service calls is closed with it
(`ASSUMPTIONS.md` 70). The lesson for slice 10 and later: a service helper that reads a table is a function of
the client, not of the module.

The same end-to-end run then found a second, older bug in slice 8's code. `SyncProvider` allows one sync at a
time, and its guard returned early when one was already running. Against the Seoul database the mount sync took
25 seconds, the browser's `online` event landed inside that window, and the flush of a just-completed report was
dropped — the report stayed in IndexedDB until the next page load, and the screen said nothing was wrong. A
technician would have finished a job and gone home with it unsent. The overlapping request is now queued and the
loop runs once more, so the report goes out (`ASSUMPTIONS.md` 71). Neither test suite could have caught it alone:
the integration suite never loads the provider, and the unit suite has no network to cut.

*Slice 10* — the job list, the dashboard and the audit viewer. Four decisions carry it (`ASSUMPTIONS.md` 72–80):

1. **A saved filter is its own table, keyed `(userId, name)`** — not a `Setting` row. A setting is one value
   under one key; saved filters are a list the user adds to, renames and deletes, and they are personal. The row
   stores the address-bar query string, so a saved view replays exactly what was on screen and cannot drift when
   the list gains a filter. Every read is filtered by `userId` directly: the owner is the row scope.
2. **The SLA state is filtered in JavaScript, over a capped row set.** "Breached" is a function of a snapshotted
   deadline and the clock, so a SQL predicate would be a second implementation of `slaState`. `listJobs` applies
   every other filter in SQL, takes at most 2,000 rows, and drops the non-matching states after. That is also why
   the page slices in memory: one list, one rule, and at ASSUMPTIONS-5 scale the cap is the whole book of work.
3. **The export runs the same function as the screen.** `jobsCsv` calls `listJobs` with the query string the page
   is showing, so a download cannot say something the table does not. A route handler, because a download is a
   GET the browser navigates to; permissions are checked in both the route and the service.
4. **The audit viewer gates on `audit.read`, not on the admin layout, and labels records in batches.** The layout
   checks `user.manage`, which is not the same question, so a signed-in role without `audit.read` gets a sentence
   rather than a 404. One query per entity type present turns a 100-row page into at most seven lookups, and the
   same `AuditTrailPanel` renders on the viewer and on a record's own page, so the two cannot describe a change
   differently. Jobs and cranes gained that panel this slice; it is the screen `auditTrail` was built for in
   slice 9.

*Slice 0* — typecheck, lint, unit, integration and end-to-end tests all pass. Two deviations from the plan as
written, both recorded in the schema and migration rather than left implicit: the CHECK constraints live in their
own migration (`20261026103300_reason_required_constraints`) instead of being appended to the init migration,
because the init migration had already been applied; and there is a separate `npm run test:integration` suite,
kept out of `npm run test` so the default gate needs no database.

*Slice 1* — authentication, the permission map, row-level scoping, user administration and the isolation tests.
Five decisions worth recording, because later slices depend on them:

1. **The session token carries only the user id.** Role and technician link are read from the database in
   `getAuthContext()` on every request. This costs one primary-key lookup per request and buys the absence of a
   stale-permission window: revoking a role or deactivating an account takes effect on the next page load. For an
   application this size that is the right side of the trade.
2. **Row-level scoping is a separate module from the capability map** (`scope.ts` beside `permissions.ts`), and it
   fails closed. A role with no read capability gets a filter matching nothing rather than no filter, so *adding a
   role and forgetting to scope it* denies access instead of granting it.
3. **Permission checks live inside the service, not in the action.** Every service takes an `AuthContext` as its
   first argument and asserts the capability itself, so a service cannot be called without an identity and a
   caller cannot forget the check. Actions stay thin: validate, call the service, revalidate.
4. **Services accept an optional transaction client.** `withAudit(context, fn, client?)` joins a caller's open
   transaction instead of always opening its own. Without this no service that writes could be tested inside
   `inRolledBackTx`, and the integration suite would have to leave rows behind in the shared database.
5. **A password reset ends the sessions that were already open.** The sign-in time travels in the token
   (`token.signedInAt`) and `getAuthContext()` refuses a token older than `User.passwordChangedAt`. Without it a
   JWT stays valid for its full twelve hours after the reset, so the reset would not do the one thing it is
   clicked for. A token carrying no sign-in time is refused, which costs one extra sign-in per session that
   predates this and keeps an undateable session from being trusted.

Passwords use scrypt from Node's standard library rather than bcrypt: memory-hard, no native build step, and it
removes a dependency from a project that has to install cleanly on Windows, macOS and Linux. The stored hash
records its own parameters, so they can be raised later without invalidating existing logins.

Not done in slice 1, and deliberately so: there is no middleware. The `(office)` layout performs the real,
database-backed check and every server action re-checks independently. A middleware layer would read only the
JWT, could not consult the database, and would give a false sense of a second line of defence.

The seed creates the demo accounts only when `DATABASE_URL` points at the machine running it, unless
`SEED_DEMO_USERS=true` says otherwise. They all share a password that is written in `prisma/seed.ts` and
`README.md`, so the question is not what `NODE_ENV` says — `prisma db seed` never sets it — but where the data
would land. Demo *data* added by later slices (customers, cranes, jobs) is not a credential and needs no such
guard; demo *accounts* do.

*Slice 2* — customers, contacts, and the preview-then-apply CSV importer shared by every later import.

*Slice 3* — sites, the crane register, restriction with a mandatory reason, and printable QR labels. Two
decisions worth carrying forward:

1. **The QR token is separate from the asset tag, and immutable.** A sticker is already on the machine, so a
   corrected asset tag must not orphan it; the token is random, excludes I/L/O/U, and encodes a URL that any
   phone camera resolves. The label word lists therefore had to leave `server/` — a client component renders the
   crane-type list, and `node:crypto` cannot be bundled for the browser, so display copy is in `lib/cranes/labels.ts`
   and the token in `server/cranes/qr.ts`.
2. **A crane with history is never archived, only decommissioned.** Job and report history is the reason the
   register exists; deleting the row would leave reports citing a crane that no longer exists. Archiving is for
   one entered by mistake, and a site cannot be archived while cranes remain on it for the same reason.

*Slice 4* — job types, templates and tickets.

1. **Job types and templates are seed data, not code.** Fourteen job types are editable rows; four
   checklist/report templates are validated against `src/lib/templates/schema.ts` before storage and
   are never overwritten by a re-seed — a change is a new version. Reports must re-render years
   later, so the template and its data have to outlive the code that produced them.
2. **Tickets separate recording from triage.** Recording happens on the phone call; triage is a
   decision made afterwards. `respondedAt` is stamped once at the first triage and never improved by
   a later one, which is what makes the response target mean anything.
3. **Cardinality stayed simple where the schema allowed it.** A ticket optionally names one crane;
   the site follows the crane when both are given. The multi-crane case lives on the job side, where
   a `JobCrane` join already models it.
4. **There is no migration in this slice.** Every table, enum and CHECK constraint it needs was
   designed in slice 0; slice 4 adds rows and services, not schema.

*Slice 5* — tickets become jobs, and the job lifecycle.

1. **The lifecycle is a map and a set of pure functions** (`src/server/jobs/status.ts`), not
   conditionals spread across screens. The service refuses a move the map does not allow; the form
   reads the same map, so the UI cannot drift from the rule.
2. **History and audit are part of the transition, not a follow-up.** `JobStatusHistory` carries
   from, to, who, when, the note and the hold reason; the audit entry records the same change. Both
   are written in the caller's transaction, so neither can exist without the status change.
3. **Timestamps are written once.** Rework sends a completed job back to in-progress; the first
   `onSiteAt` survives. This is the difference between a duration and a record.
4. **SLA deadlines are snapshotted onto the job at creation** from the policy in force (contract
   override first). Job screens read the snapshot, so editing `SlaPolicy` later cannot restate
   history. Tickets keep computing live, because a ticket's clock has not been converted into a
   commitment yet.
5. **A job requires a site; a ticket does not.** A job is a visit, so the address is resolved from
   the ticket or the crane and cranes at two sites are refused. Conversion marks the ticket
   `CONVERTED` and stops its clocks — the jobs now carry the work.

| # | Slice | Delivers | Brief § |
|---|---|---|---|
| **0** | **Foundations** | Next.js + TS + Tailwind + shadcn scaffold; Docker Compose Postgres; Prisma init with the §3 schema for Phase 1 models; all npm scripts; `/api/health`; structured logging + error boundary; `Setting` table and `DocumentSequence`; `audit()` service; Vitest + Playwright wired; `.env.example` | §12.1 |
| **1** | **Auth, roles, users** | Auth.js credentials login; password hashing; `permissions.ts` capability map + scope helpers; rate limiting on login; Admin user management; **tests proving technician isolation and cross-customer isolation** | §12.2, §12.9 |
| **2** | **Customers & contacts** | CRUD, search, status filter, CSV import, audit-logged; empty/loading/error states | §12.3 |
| **3** | **Sites & cranes** | CRUD, search, CSV import, QR value + printable label, crane detail page shell (timeline populated in slice 9), restriction flag with reason | §12.3 |
| **4** | **Job types, templates, tickets** | Seed 14 job types; seed checklist + report templates for servicing, breakdown, visual inspection, load test; ticket CRUD, triage, priority, SLA timer display | §12.4 |
| **5** | **Ticket → Job, lifecycle, SLA** | Ticket spawns 1..n jobs, job covers 1..n cranes; status machine + `JobStatusHistory`; `ON_HOLD` reason required (DB check + service); `SlaPolicy` → SLA due timestamps + live timer/breach state; P1 alert to dispatchers (in-app + email adapter) | §12.4, §4.3 |
| **6** | **Scheduling & dispatch** | Schedule board (day/week, dnd-kit, conflict warnings); technician assignment with competency warnings + configurable block; leave/unavailability; on-call roster; resource booking + conflict flags; priority bump with reason (audited); dispatch notification with site contact, access notes, crane history, checklist | §12.5 |
| **7** | **Technician PWA shell** | Installable PWA (Serwist); Dexie cache of upcoming jobs, crane histories, templates, parts, contacts; My Jobs; Job detail; offline indicator | §12.6 |
| **8** | **Offline report completion** | Checklist form with measurements; photos with client-side compression; parts used; findings; technician + customer signatures with declined-with-reason; autosave every few seconds; outbox sync queue with pending badge, retry, idempotency via `SyncReceipt`, conflicts logged | §12.6, §10 |
| **9** | **Approval, lock, PDF** (done) | Report approval flow; locked reports + amendment with reason linked to original; document numbering; `@react-pdf/renderer` PDF with embedded signatures and photos; email to customer on close with copy stored against job and crane; crane timeline now populated | §12.7 |
| **10** | **Job list, dashboard, audit views** | Company-wide job list with every filter + saved filters + CSV export + calendar view; office dashboard; audit log viewer and "who changed what" on key records | §12.8, §12.9 |
| **11** | **E2E happy paths** (done) | Playwright: (a) P1 breakdown ticket → assign nearest qualified technician → offline report with photos and both signatures → sync → approve → customer PDF; (b) offline report completion and later sync | §12.10 |

`npm run seed` grows with each slice and must stay runnable. Slice 4 seeds the templates; slice 6 seeds technicians,
competencies (one expired) and the roster; slice 11 completes the §13 demo dataset (8 customers, 25–40 cranes, 30
historical jobs, 2 open P1 tickets, 40 parts with some below reorder level, demo logins per role).

**Phase 1 acceptance** (from the brief) is exactly slice 11's path (a). If that test passes end to end, Phase 1 is done.

---

## 7. Phase 2 — vertical slices; Phase 3–4 (outline)

**Phase 2 is Compliance & recurring work, then the paperwork.** It is sliced below the same way Phase 1 was: one
vertical slice per session, database → service → API/action → UI → tests, `npm run verify:full` and a commit before the
summary. **Slices 12–38 are built and verified — all four phases are complete.** The per-slice
write-ups are in `PLAN-SLICES.md`; §7.2, §7.13 and §7.14 below are the tables.
Do not start a second slice in the same session. Slice 11's e2e path
(`tests/e2e/happy-path.spec.ts`) is the Phase 1 regression guard: it must still pass, and it must not be edited to make a
Phase 2 change fit.

### 7.1 What Phase 1 actually left behind

Verified in the code, not inferred from the brief. This is the gap list Phase 2 closes. **It is the state as Phase 1
left it, kept as the record of why Phase 2 is sliced the way it is — slice 12 has since closed the first two rows and the
dashboard row of the fourth, and slice 13 has closed the `Certificate` row.** For the live state of the tree, read
`KICKOFF.md` "Where the build stands".

| Item | State today | What is missing |
|---|---|---|
| `CraneSchedule` | Rows exist only because `seedDemoBook()` writes two per demo crane ([prisma/seed.ts:1009](../prisma/seed.ts)) | No write path, no screen. Its **only** reader is the dashboard count ([dashboard.ts:118](../src/server/dashboard/dashboard.ts)) |
| Next-due recompute | Nothing writes `lastDoneDate`/`nextDueDate` after a job fires | Completing a PM or a load test does not roll the schedule on. The crane page has no next-due block |
| `/api/cron/daily` | Prunes `RateLimitBucket`, retries failed report emails | No reminder evaluation, no due-date scan |
| `Certificate` | Model only | No service, no upload (`FileKind.CERTIFICATE` unused), no screen. `certificatesExpiring` counts a table nothing writes, so the tile is honestly 0 |
| `ComplianceRule` | Model + `compliancerule.manage` capability granted | No screen; rule 2 (compliance is data, with the MOM notice) is currently unprovable in the UI |
| `Finding` | Written on report submit, rendered on the report page | No status flow, no follow-up job, no list on the crane page. `finding.followUpJob` is granted and unused |
| Calibration | **Closed in slice 17** — the load test warns when an instrument was out of date at the test date | — |
| `Quote` `Invoice` `Payment` `DeliveryOrder` | Models only | No service, no screen, no numbering (`DocumentSequence` keys unused) |
| Admin | `/admin/users` and `/admin/audit` only | No job types, templates, SLA policy, compliance rules or settings screens |
| Permissions | `certificate.read/write`, `schedule.manage`, `compliancerule.manage`, `finding.followUpJob` already declared and granted per role | Nothing enforces them yet — each slice must consume them, not add new ones |

### 7.2 The Phase 2 slice table

| # | Slice | Delivers | Where the work lands | Brief § |
|---|---|---|---|---|
| **12** | **Schedules on the crane page** (**built** — finish per §7.3) | The "next due" block on crane detail (type, interval, last done, next due, overdue state, source); create / edit / archive a schedule under `schedule.manage`, audited; a `/office/schedules` list (overdue, then due in 30/60/90) that the dashboard tile links to; **completing a job offers "mark schedule done" for that journey's cranes**, which writes `lastDoneDate` and recomputes `nextDueDate` | `src/server/schedules/` (new), `src/app/(office)/cranes/[id]/page.tsx`, `src/app/(office)/schedules/` (new), `src/app/(office)/dashboard/page.tsx`, `src/server/jobs/status.ts` or the completion action | §8, §12 |
| **13** | **Certificates & compliance dashboard** (**built** — see §7.4) | Certificate register per crane: type, number, issuer, issue/expiry/next-due, stated SWL, linked job, file upload through the existing storage adapter (`CERTIFICATE`), soft-delete only; `/office/certificates` with **expiring in 90/60/30 and overdue**; the dashboard tile becomes a real count and links to it. Company inspection vs AE statutory certificate kept visually distinct | `src/server/certificates/` (new), `src/app/(office)/certificates/` (new), crane detail section, `src/server/dashboard/dashboard.ts` | §6.6, §7.2 |
| **14** | **ComplianceRule admin** (**built** — see §7.5) | Admin screen to maintain rules (`craneType × scheduleType`, interval, `requiresAE`, effective dates, **required `sourceReference` and `reviewedAt`**), carrying `Setting.complianceNotice` verbatim; a schedule can adopt a rule (`source = RULE`, interval copied); "re-registration may be required" reminder when a crane's `ownerEntity`/customer UEN changes or it is re-assembled at another site | `src/app/(office)/admin/compliance/` (new), `src/server/compliance/` (new), `src/server/cranes/cranes.ts` (change detection) | §7 |
| **15** | **Reminder engine in the daily cron** (**built** — see §7.6) | `/api/cron/daily` evaluates every `CraneSchedule.nextDueDate` at `reminderOffsetsDays` (default 90/60/30) then overdue, notifies the account owner in-app + email via the existing `notify` fan-out, and honours `autoCreateDraftJobs`; at-most-once per (schedule, offset, period) so a re-run sends nothing twice — needs an additive migration for the dispatch key | `src/app/api/cron/daily/route.ts`, `src/server/reminders/` (new), migration | §8 |
| **16** | **Findings & one-click follow-up jobs** (**built** — see §7.7) | Finding status flow (open → quoted → scheduled → rectified / declined), open findings on the crane page, **one click creates a follow-up job** pre-filled from the finding (job type, crane, description, priority from severity) linked by `followUpJobId`/`parentJobId`; customer-declined critical repair captured with name, signature and date | `src/server/findings/` (new), report page, crane page, `src/server/jobs/jobs.ts` | §4.2, §6.4 |
| **17** | **Load test & visual inspection templates built out** (**built** — see §7.8) | The two templates completed against §6.3 (test load / radii / SWL per radius / instruments / pre- and post-test exam / AE attendance; structure, safety devices, markings, wire rope and hook), with **calibration-expiry validation against `Resource.calibrationDueDate` at the test date — warn, never block** | `src/server/templates/definitions.ts`, `src/lib/templates/schema.ts`, the report form, `prisma/seed.ts` (new versions) | §6.3 |
| **18** | **Delivery orders** (**built** — see §7.9) | DO generated from the parts already issued on a job (no second source of truth — read from `StockMovement`), lines with serial/batch, `chargeable \| warranty \| loan` + expected return, partial delivery, receiver name/signature/timestamp, numbered `DO-YYYY-NNNN`, printable PDF via the existing renderer | `src/server/delivery-orders/` (new), `src/app/(office)/jobs/[id]/page.tsx`, `src/server/documents/` | §6.5 |
| **19** | **Quotes & variations** (**built** — see §7.10) | Quote from a job or a set of findings, lines with qty/unit price, `variation` flag, GST computed, send/accept/decline/expire, numbered `QTE-YYYY-NNNN`, PDF; accepting a quote moves the job into `QUOTED → APPROVED` through the existing status machine | `src/server/quotes/` (new), `src/app/(office)/quotes/` (new), `src/server/jobs/status.ts` | §4.2, §12 |
| **20** | **Invoicing, GST and payments** (**built** — see §7.11) | Invoice from a reviewed job (job costing from `StockMovement` + labour lines), `gstRate` snapshot at issue, `INV-YYYY-NNNN`, PDF, payments recorded, `amountPaid` derived, statuses `DRAFT/ISSUED/PART_PAID/PAID/VOID`, dashboard "awaiting invoicing" gains a screen | `src/server/invoices/` (new), `src/app/(office)/invoices/` (new) | §12, §5 |
| **21** | **Accounting CSV export + Phase 2 acceptance** (**built** — see §7.12) | An export adapter (CSV first, Xero/QuickBooks later per §12/§14) for invoices and payments, and one Playwright path proving Phase 2 end to end: a PM job completed → schedule rolls forward → certificate uploaded → compliance screen shows it → reminder email queued → finding becomes a follow-up job → quote → invoice | `src/server/accounting/` (new), `tests/e2e/` | §12, §14 |

Each slice also carries the Definition of done from `../CLAUDE.md` (server-side permission test, audit entries, empty /
loading / error states, seed still runnable, README + this file updated in the same commit).

**Phase 2 is complete.** Slice 21 built the accounting export and the acceptance path, and took carry-over 1
(the `/admin/compliance` Playwright path) into that spec, so §7.5's queue is down to its last two items: a state
filter on the rules table and re-pointing schedules that cite a superseded rule if asked — neither wanted yet.
The ended-schedules filter noted in §7.3 is likewise still open. They are deliberately not slices of their own —
take the first one whenever the slice in flight edits the same screen or service.

**Where the next session starts: Phase 3 — Inventory (the first slice of it, still to be written into this
section).**

### 7.3–7.25 The slices as built

Each slice's fixed decisions as built — what was done, what was refused, the migration and the
known limits — are in [`PLAN-SLICES.md`](PLAN-SLICES.md), in slice order. §7.2 above is the
Phase 2 table; §7.13 and §7.14 below are the Phase 3 and 4 tables, kept here. Read the entry for the
slice you are touching.

### 7.13 Phase 3 — Inventory (slice table and the first slice as built)

Phase 3 is where the parts the app has been *recording* since Phase 1 become a stock system: a catalogue you
can browse, a ledger that moves when stock moves, and the store's own screens. The schema for all of it was
designed up front (§3.8) and is already migrated — **no migration is expected for the first three slices.**

| # | Slice | Delivers | Where the work lands | Brief § |
|---|---|---|---|---|
| **22** | **The parts book and the stock ledger** (**built** — see below) | `/parts` (search by number, description or crane model; brand filter; below-reorder filter and count) and `/parts/[id]` (on-hand, per-location levels, the part's own last 20 movements, add/edit behind `part.write`); a store form that posts `RECEIVE`, `RETURN` and `ADJUST`; **one writer** for `StockMovement` + `StockLevel`, which the report path now uses too, so issuing a part on a report finally moves the shelf | `src/server/inventory/` (new), `src/lib/validation/parts.ts` (new), `src/app/(office)/parts/` (new), `src/server/reports/reports.ts` (re-pointed) | §9 |
| **23** | **Locations and transfers** (**built** — see §7.13.1) | `/parts/locations` (every location with what it holds; add and edit behind `part.write`; retired, never deleted), and a transfer form on the part page posting the `TRANSFER` the ledger always had a type for. The receiving form now offers **every active location**, not only the ones the part already sits in | `src/server/inventory/locations.ts` (new), `src/lib/validation/locations.ts` (new), `src/app/(office)/parts/locations/` (new), `/parts/[id]` | §9 |
| **24** | **Serial and batch traceability** (**built** — see §7.13.2) | Record and trace a serial on `trackSerialOrBatch` parts: which crane received which rope or hook, and where the rest of the batch is. The issue path already stores `serialOrBatch`; this is the report and the lookup | `/parts/[id]`, the report form | §9 |
| **25** | **Reorder alerts and a suggested purchase order** (**built** — see §7.13.3) | Group what is below reorder by preferred supplier, suggest the reorder quantity, and raise a `PurchaseOrder` from the group. Receiving a PO posts `RECEIVE` | `/parts/reorder` (new), `src/server/inventory/` | §9 |
| 26 | Stock take (**built** — see §7.13.4) | Session → blind count → variance → recount → approve, posting one `ADJUST`/`WRITEOFF` per line difference, and flagging a part/location that keeps disagreeing | `/stock-takes` (new), `src/server/inventory/` | §9 |
| 27 | Suppliers (**built** — see §7.13.5) | `/suppliers`: every supplier with the parts that prefer it and the orders raised from it (the price history), add/edit behind `supplier.write`, retired rather than deleted and refused while a part still prefers it; the part form finally gains the preferred-supplier select, which the reorder grouping had and no screen could set | `/suppliers` (new), `src/server/inventory/suppliers.ts` (new), the part form | §9 |
| 28 | Back-orders linked to jobs on hold (**built** — see §7.13.6) | A part on order appears against the jobs held awaiting it, so "awaiting parts" says **which** part and when it lands | job page, `/parts` | §4.2, §9 |

Slice 22 was taken first because a catalogue without a correct on-hand figure is a list of part numbers, and the
figure was wrong: `StockLevel` was written only by the seed while every report's `ISSUE` bypassed it. Slices 23
onward build on the ledger it introduced.

#### Slice 22 — the parts book and the stock ledger (**built**)

**Goal:** the store can answer its three questions — what is this part, do we have it, and what is running out —
and the number it reads is the ledger's own.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 135–141):

1. **`postMovement` in `src/server/inventory/stock.ts` is the only function that writes `StockMovement` or
   `StockLevel`.** The movement and the level were already written together by the seed; every other path wrote
   only the movement. Now one function does both in the caller's transaction, decides the sign from the type
   (never from a signed number on a form), and audits the row. The report path was re-pointed at it, which is
   the actual bug closed by this slice.
2. **Stock is allowed to go negative.** A signed field report is not going to be refused because the shelf count
   is one short. A negative level is shown in red on both screens as "more issued than received", and the next
   count corrects it — which is a stock take's job (slice 26).
3. **An `ADJUST` carries the counted quantity, not a difference.** The person counting says what is on the
   shelf. Upward differences post as `ADJUST`, downward ones as `WRITEOFF`, because `WRITEOFF` already means
   "stock left without a sale" and reusing `ADJUST` in both directions would need a second sign rule for one case.
4. **The store's screen posts `RECEIVE`, `RETURN` and `ADJUST` only.** `ISSUE` belongs to the job that consumed
   the part, and `TRANSFER` needs a second location to mean anything (slice 23).
5. **On-hand is computed, never stored.** It is the sum of `StockLevel` rows read with the part, so it cannot
   disagree with the ledger — the same rule the product applies to overdue dates and quote expiry.
6. **The catalogue is not tenant data, so there is no `partReadWhere`.** A wire rope is the same wire rope on
   whichever customer's crane it hangs; `part.read` is the whole check and the split that matters is read vs
   write. Finance gained `part.read` — it reads the book for the value held and writes nothing.

**As built.** `src/lib/validation/parts.ts` holds the pure rules: `movementSigns` (which side a type pushes),
`needsReorder`, the part and stock-entry schemas, `MOVEMENT_TYPE_LABELS`. `src/server/inventory/stock.ts` holds
`postMovement`, `defaultLocation` (the store, created if a fresh database has none) and `issueLocationFor`
(the location holding the most). `src/server/inventory/parts.ts` holds `listParts`, `getPart`, `createPart`,
`updatePart`, `postStockEntry` and `issuePartForReport`. `/parts` and `/parts/[id]` are the screens; the nav
gains **Parts**; the audit viewer labels a `Part` and links a `StockMovement` to `/parts`. The job page's
delivery orders and the invoice prefilling are untouched — they read the same ledger rows they always did.

**Migration:** none. `Part`, `Location`, `StockLevel`, `StockMovement` and their enums were designed in Phase 1.
The seed's opening balances now go through `postMovement` too, so the demo book and the receiving screen open
stock the same way; it gained an optional `movedAt` on the input for that, so an opening balance stays dated
where it was.

**Known limits.** No transfer form and no location admin yet (slice 23) — a movement into a second location can
only come from the seed. Serial numbers are stored on the issue but there is no traceability report (slice 24).
There is no purchase order, supplier screen, reorder suggestion or stock take yet (25–27). The below-reorder
filter reads the whole catalogue and filters in memory; at a few hundred parts that is cheaper than the
subquery, and it is the first thing to change if a customer's catalogue passes a few thousand lines.

#### 7.13.1 Slice 23 — locations and transfers (**built**)

**Goal:** the store can say where the stock is, not just how much of it there is, and can move it
without writing a movement by hand in a database console.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 142–146):

1. **A location is retired, never deleted.** `isActive` is the soft delete, because every movement
   that ever touched a location keeps naming it — the same reasoning as reports and certificates
   (rule 4). A location that still holds stock **cannot** be retired; the form says to transfer it out
   first, which is also the moment somebody finds out the shelf and the figure disagree.
2. **A transfer needs both ends named**, unlike a receipt (which falls back to the store) or an
   adjustment. A movement with no destination is a write-off and one with no source is a receipt, so
   an unnamed end is a form that meant a different movement.
3. **A transfer larger than the source holds is refused**, naming what it holds. An **issue** may take
   a level negative (rule 11 — a signed field document is never refused); a transfer is a store action
   with the shelf in front of the person, so refusing it names the discrepancy where it is cheapest.
   The total on hand does not change, and the ledger gains exactly one `TRANSFER` row.
4. **`Location.parentId` is not a foreign key** (it was never one), so a bin's parent is checked in the
   service: it must exist, and it must be a warehouse. A bin inside a van is not modelled.
5. **Locations are not tenant data**, like the catalogue: `part.read` is the whole read check and
   `part.write` maintains them, so there is no `locationReadWhere`.
6. **`stock.move` gates a transfer**, the same capability every other stock write uses — a technician
   holds it because issuing and returning parts is the job, and a van-to-bin move is the same act.
   Finance reads the book and moves nothing.

**As built.** `src/lib/validation/locations.ts` holds the four kinds, their labels, the location
schema and the transfer schema (both ends required, and different). `src/server/inventory/locations.ts`
holds `listLocations` (with lines and quantity per location), `locationOptions`, `createLocation`,
`updateLocation`, `assertLocationsExist` and the name/parent/retire rules.
`transferStock` in `parts.ts` posts through `postMovement` exactly like every other movement.
`/parts/locations` is the screen; `/parts/[id]` gains the transfer form; the nav is unchanged (the
location screen is reached from **Parts**) and the audit viewer is unchanged — `Location` is audited
but is not yet a labelled entity in the viewer.

**Two bugs the slice found and fixed.** The receiving form on the part page offered only the
locations the part *already sat in* — `part.levels` — so stock could never be received into a new bin,
and a part that had never been received had an empty location list whose only option was "Main store".
It now offers every active location. The same form's `locationId` was never checked to exist; it now
says so rather than letting a foreign-key violation reach the screen.

**Migration:** none. `Location`, `LocationType`, `StockLevel` and `StockMovement` were designed in
Phase 1.

**Known limits.** The transfer form lives on a part page and moves one part; there is no "stock by
location" screen that lists every part in a van at once — the location list shows counts, and the
per-part breakdown is on the part. A location cannot be deleted, only retired. `Location.siteId` is
unused by any screen: a customer-site location is named, not linked to the Site record, so a parts
transfer form does not need `customer.read`.

#### 7.13.2 Slice 24 — serial and batch traceability (**built**)

**Goal:** answer the question a recall asks — which crane did this rope go on, and where is the rest
of the batch? — from the ledger, without a new table.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 147–150):

1. **The trace is the movements, read one way.** A serial's position is `locationBalances` applied to
   the rows carrying that serial — the same direction table `postMovement` uses to move `StockLevel`.
   Nothing stores "where serial X is", so it cannot disagree with the shelf.
2. **Only parts flagged `trackSerialOrBatch` have to carry a serial.** A traced part issued with no
   serial is refused on the server, saying which part; the report stays on the phone until it is
   typed. An untraced part keeps its serial optional — the column has always been free text.
3. **The phone is told which parts are traced.** `trackSerialOrBatch` rides in the sync bundle, so
   the form can mark the field required and check it before queueing, with no signal.
4. **The trace reads every serialled movement for one part.** A page of them would compute a serial's
   balance from part of its history, which is a wrong answer to "where is it" — the one question the
   screen exists for. It is unbounded on purpose; a window belongs on the serial, not the part, if a
   catalogue line ever makes this slow.

**As built.** `locationBalances` in `src/lib/validation/parts.ts` is pure and testable.
`tracePartSerials` in `src/server/inventory/parts.ts` groups a part's serialled movements by
`serialOrBatch` and returns, per serial: what is held, where, and every job it was issued to with that
job's cranes. `/parts/[id]` renders it as **Serial and batch trace** above
the movement list; `reportSubmitSchema`'s parts already carried `serialOrBatch`, so the only server
change was the traced-part check in `applyReport`. `SyncBundle.parts` and `CachedPart` gained
`trackSerialOrBatch`; `PartsSection` in the report form says under the field that a traced part
needs it, and `submit()` refuses to queue one without it.

Two follow-ups close the gap between "the trace is the shelf" and the screens: a count correction
now carries the serial through `adjustToCounted` into its `ADJUST`/`WRITEOFF`, and an issue without
a named location takes it from the bin that actually holds the named serial (`issueLocationFor`
reads that serial's movements first), falling back to the fullest bin only when no serial is given
or it has never been on the books.

**The seed** now flags wire rope, hooks and chain as traced and opens them as a batch
(`DEMO-<number>-001`), so a fresh database has a trace to look at. It does not retrofit parts that
already exist — the flag is set when a part is created, and re-running the seed leaves them alone.

**Migration:** none. `StockMovement.serialOrBatch` and `Part.trackSerialOrBatch` were designed in
Phase 1.

**Known limits.** The lookup is per part, and only on the part page — there is no cross-catalogue
"find serial SN-9001" box. A serial typed inconsistently (`AB-12` vs `ab-12`) is two traces; nothing
normalises it, because normalising would rewrite what the store typed. A batch received without a
serial and later issued with one shows the issue but not the receipt; the part page flags that
serial in red ("more issued than received") and points at posting a count, rather than presenting a
negative balance as fact.

#### 7.13.3 Slice 25 — reorder alerts and purchase orders (**built**)

**Goal:** turn the below-reorder count into the thing the store actually does with it — an order to a supplier,
and a shelf that goes up when the order lands.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 153–159):

1. **The suggested quantity is the store's, then the arithmetic.** `reorderQty` when the catalogue sets one;
   otherwise enough to bring the shelf back to `reorderLevel`. `suggestedOrderQuantity` is pure and tested.
2. **The list is grouped by preferred supplier, and the unassigned group is named, not merged.** A part with no
   preferred supplier cannot be ordered — `PurchaseOrder.supplierId` is required — so that group is shown with
   a link to the part, and the screen says what to fix.
3. **The form posts part ids and quantities, never cost.** Description and cost are re-read from the catalogue
   inside the raising transaction and snapshotted on the line, the way an invoice line is: a stale page cannot
   price an order, and a later price change does not rewrite one already sent.
4. **A line the store blanked is not on the order.** Every short part in the group is offered with its suggested
   quantity; a blank or zero quantity leaves it off. Nothing is ever removed from the catalogue by ordering.
5. **A delivery larger than the line still owes is refused, naming the remainder.** Unlike an issue (which is a
   signed field document and may go negative, item 136), a receipt is a store action with the delivery in front
   of the person. The extra goes in through the store's own receipt form, so the paperwork keeps saying what was
   ordered.
6. **The order's status is derived from its lines.** `DRAFT` until something arrives, `PARTIAL` while some lines
   are short, `RECEIVED` when every line is whole — never posted by the form, the same rule delivery orders and
   invoices follow. Nothing sends or cancels a PO yet, so `SENT` and `CANCELLED` are unused.
7. **A receipt is one `RECEIVE` per line through `postMovement`, carrying `purchaseOrderId`.** The order's running
   quantity and the shelf are the same arrival, so they cannot drift (rule 10). One receipt names one location;
   a delivery split across two shelves is two receipts. A serial rides along when the store types one, so a
   traced rope received on a PO is still traceable.
8. **`purchaseorder.write` is the storekeeper's and Admin's.** Dispatch and finance read the catalogue but do not
   buy stock; a technician holds `part.read` and sees the groups without the forms.

**As built.** `src/lib/validation/purchase-orders.ts` holds the pure rules — `suggestedOrderQuantity`,
`purchaseOrderStatusFor`, `remainingOnOrder`, the status labels, and the two form schemas. `src/server/inventory/
purchase-orders.ts` holds `reorderGroups`, `listOpenPurchaseOrders`, `raisePurchaseOrder` and
`receivePurchaseOrder`; `postMovement` gained `purchaseOrderId`. `/parts/reorder` is the screen: the groups with
their raise forms, and the open orders with a receipt form each; **Parts** links to it. The audit viewer labels a
`PurchaseOrder` and links it to the reorder screen. The seed creates three suppliers and points the demo parts at
them (filling in only parts whose supplier is still unset, so a store choice is never overwritten).

**Migration:** none. `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseOrderStatus`, the `PO` sequence prefix and
`StockMovement.purchaseOrderId` were designed in Phase 1 and already applied. `PurchaseOrderLine` has no relation
to `Part`, so a part's number and unit are read in one batched lookup per screen rather than per line.

**Known limits.** No purchase order PDF, email or "send" action — the office raises the order and sends it however
it does today. A PO cannot be cancelled or edited once raised. Receiving does not check that a receipt's total
matches the order (only that no line is over). There is no browser test of `/parts/reorder`; the integration suite
is what proves it. Back-orders linked to jobs on hold are slice 28.

#### 7.13.4 Slice 26 — stock take (**built**)

**Goal:** the store can settle the shelf-against-books argument — count a location, see the
differences, and post them as ledger entries with a reason and a person on each.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 160–166):

1. **The system quantity is a snapshot; approval reconciles to the live shelf.** A session copies
   what each line held when it opened, so the review reads the difference the counter was working
   against. Approving then re-reads the live level through `adjustToCounted` and posts the difference
   to what is *actually* on the shelf, so a delivery that landed mid-count is counted rather than
   reversed. A line that already matches at approval time is skipped, not refused.
2. **A variance is counted less system, computed by one function.** Positive is stock the books did
   not have. One definition, so the review table, the record after approval and the movement cannot
   disagree about which way the sign goes.
3. **A correction is the same `adjustToCounted` the part page uses**, an upward difference as
   `ADJUST` and a downward one as `WRITEOFF`, each carrying `stockTakeId` so the ledger names the
   count that posted it — the rule slice 22 set (item 137), applied rather than restated.
4. **A partial count cannot be approved**, and a count that writes stock off needs a reason said
   out loud. Approving half a shelf would write off the lines nobody looked at.
5. **The status is derived, never posted.** `DRAFT` until something is counted, `COUNTING` while
   lines remain, `REVIEW` once every line has a count (a zero is a count), `APPROVED`/`CANCELLED`
   after that. `Cancel` posts nothing and an approved count cannot be cancelled — it is the record
   the ledger was reconciled against.
6. **One open session per location.** Two people counting one shelf produce two answers and one
   argument, so a second session is refused by naming the open one. An empty location still opens a
   session: "we counted the van and it was empty" is a result.
7. **`stock.move` counts, `stocktake.approve` approves.** A technician can count a van but cannot
   write stock off; finance reads the book and does neither. The capability was already in the map
   and unused until this slice.

**As built.** `src/lib/validation/stock-takes.ts` holds the pure rules — `varianceFor`,
`stockTakeStatusFor`, the status labels, the reason codes and the three form schemas.
`src/server/inventory/stock-takes.ts` holds `listStockTakes`, `getStockTake`, `createStockTake`,
`recordCounts`, `approveStockTake` and `cancelStockTake`. `adjustToCounted` in `parts.ts` was made
exportable and gained `stockTakeId` and a non-strict mode for approval; `postMovement` carries
`stockTakeId`. `/stock-takes` is the list and the opening form; `/stock-takes/[id]` is the count, the
review and the approval, and becomes a read-only record once approved. The parts page links to it,
the office nav gains **Stock takes**, and the audit viewer labels a `StockTake` and links it.
References come from the shared `DocumentSequence` under a new `ST` prefix.

**Migration:** none. `StockTake`, `StockTakeLine`, `StockTakeStatus` and
`StockMovement.stockTakeId` were designed in Phase 1 and already applied.

**Known limits.** The count screen is office-first and table-shaped; the brief's "blind count on
mobile/scanner" is not built — a phone holding `/stock-takes/[id]` works, but nothing drives it and
there is no barcode entry. `movementsFrozenAt` is still unused: the scope is not frozen during a
count, which is why approval reconciles to the live shelf (item 1) rather than reversing movements
posted since. There is no repeat-discrepancy flag — the part page's negative lines and this list's
`differences` count are the signal today. A cancel is refused once approved rather than being
unwound by a reversing count.

#### 7.13.5 Slice 27 — the supplier book (**built**)

**Goal:** the reorder screen already grouped short parts by "the supplier the catalogue prefers", and
nothing in the UI could set that preference — the seed was the only thing that ever filled it in.
This slice gives the suppliers a screen and gives a part the field.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 167–173):

1. **The price history is the purchase orders, not a new table.** A supplier's page shows the orders
   raised from it with their totals and dates. A `SupplierPrice` table would be a second record of the
   same number, free to disagree with the document the store actually sent.
2. **A supplier is retired (`deletedAt`), never deleted**, the way a stock location is: the parts that
   prefer it and the orders raised from it keep naming it. A retired supplier drops out of the part
   form's choices and out of the reorder grouping, but reads on its own page and on its past orders.
3. **Retiring a supplier that a part still prefers is refused, saying how many.** A part preferred by a
   retired supplier lands in a reorder group nothing can order from — the exact state slice 25's
   "no preferred supplier" group already warns about, arrived at invisibly.
4. **A part may not prefer a retired supplier.** Checked in the service on both create and update, the
   same way a movement's locations are checked to exist rather than trusting the form.
5. **`preferredSupplierId` is added to the part form**, which is where the reorder grouping's input
   comes from. The part form takes the active suppliers as an optional prop so a role holding
   `part.write` without the book (none today) still renders.
6. **`supplier.write` is the storekeeper's and Admin's** — already in the permission map since slice 22,
   finally used. Reads ride on `part.read`, because the book is a view of the catalogue rather than a
   separate register, and a write without that read would let a role edit what it cannot see.
7. **Names are unique**, like locations: a dropdown with two "Sin Heng"s is a support call.

**As built.** `src/lib/validation/suppliers.ts` holds the form schema; `src/server/inventory/
suppliers.ts` holds `listSuppliers`, `supplierOptions`, `createSupplier`, `updateSupplier` and
`assertSupplierActive`; `src/components/office/supplier-forms.tsx` is the add/edit form;
`/suppliers` is the screen (each supplier's parts with their catalogue cost, and its recent orders).
`PartSummary` gained `preferredSupplierId` and `preferredSupplierName`, and `PartForm` the select. The
office nav gains **Suppliers** (after Stock takes), the parts page links to it, and the audit viewer
labels a `Supplier` and links it to the book.

**Migration:** none. `Supplier`, its relation to `Part` and `part.write`/`supplier.write` were designed
in Phase 1 and already applied, and the seed has created three suppliers since slice 25.

**Known limits.** There is no supplier-level price list beyond the orders actually raised — a quoted
price that never became an order is not recorded anywhere. A part's supplier is set on the part form,
one part at a time; there is no bulk re-pointing screen, which is what retiring a busy supplier would
want. There is no browser test of `/suppliers`; the integration suite is what proves it.

#### 7.13.6 Slice 28 — back-orders linked to jobs on hold (**built**)

**Goal:** "on hold — awaiting parts" said why but never *what*. The store could not tell which part a job
was standing still for, and a part could not tell anyone which jobs were waiting on it.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 174–178):

1. **The link is one nullable column, `Job.onHoldPartId`.** Not a join table: a hold waits on the
   part the job is actually short of, and a second part is a second hold's worth of problem. The
   migration is additive and its foreign key is `ON DELETE SET NULL`, so a withdrawn part empties the
   link rather than blocking.
2. **The part may only be named on an `AWAITING_PARTS` hold**, and the service clears it whenever the
   job is not on that hold — so a weather hold or a job that has resumed cannot leave a stale link
   behind. The id is checked against the live catalogue inside the transaction, not trusted from the
   form.
3. **"When it lands" is derived, not stored.** It is the `expectedAt` of the open purchase order line
   that still owes the part (`backOrdersForPart`, existing `OPEN_PURCHASE_ORDER_STATUSES`). A line
   that has received everything contributes nothing, so an order that arrived stops being a back-order
   the moment it is receipted — no status to keep in step.
4. **`PurchaseOrderLine.backOrderedQuantity` stays unused.** Ordered less received already is the
   outstanding quantity.
5. **The wording is one pure function, `expectedDateLabel`** in `src/lib/validation/purchase-orders.ts`:
   "Order not sent yet", "No expected date", "Expected today", "Expected in N days", "N days late" —
   counted in whole days in the operating timezone, with the lateness flagged so the page can colour it.

**As built.** The job page's amber hold banner gains a "waiting for *part*" block listing each open order
still owing it (quantity, order number, supplier, when it lands, and the landing date) or a link to the
reorder list when nothing is on order. The transition form gains a "Part it is waiting for" select,
offered only when the reason is awaiting parts, fed by `partOptions`. The part page gains a "Jobs
waiting for this part" panel (number and customer, linked), fed by `heldJobsForPart`, which reads
through `jobReadWhere` so a technician sees only their own. `backOrdersForPart` and the two new parts
queries join the existing inventory service.

**Migration:** `20261028600000_slice28_job_on_hold_part` — one nullable column plus its foreign key.

**Known limits.** A hold names one part, so a job short of two shows one here and the rest in the
note. There is no browser test of the hold banner or the part panel; the integration suite proves the
stored link, the refusal of an unknown part, the clearing on resume, and what counts as on back-order.

### 7.14 Phase 4 — Optimisation (slice table)

Phase 4 is where the app stops only *running* the business and starts telling it something: the customer gets a door,
the contracts the SLA numbers were always meant to come from get a screen, and the money and hours already recorded
become reports. The schema was designed up front (§3) and the `CUSTOMER` role and `Contract`/`SlaPolicy` tables have
been migrated since Phase 1 — **no migration is expected for the first slices.**

| # | Slice | Delivers | Where the work lands | Brief § |
|---|---|---|---|---|
| **29** | **Contracts on the customer page** (**built** — see §7.15) | A customer's contracts: type, reference, term, renewal, included visits, scope notes and covered cranes, with the negotiated response/resolution targets written as `SlaPolicy` rows for that contract — the rows `createJob` already reads. Retired, never deleted | `src/server/contracts/` (new), `src/lib/validation/contracts.ts` (new), the customer page's Contracts tab | §5, §8 |
| **30** | **SLA management and the renewal board** (**built** — see §7.16) | Company-wide targets editable on a screen (they are seed-only today), and every contract renewing or overdue in one queue | `/admin/sla` (new), `/customers` | §4.3, §8 |
| **31** | **The customer portal** (**built** — see §7.17) | The `CUSTOMER` role finally signs in: their jobs and their cranes' certificates and reports, read-only, scoped by `customerId` | `src/app/(portal)/`, `src/server/portal/`, `src/server/auth/scope.ts` | §4.1 |
| **32** | **Profitability reporting** (**built** — see §7.18) | Revenue against the parts cost of the jobs behind it, per customer, contract and job type, from invoices and the stock ledger. Labour is not costed, and the screen says so | `src/server/reports/profitability.ts` (new), `/reports/profitability` | §11 |
| **33** | **Technician utilisation** (**built** — see §7.19) | Hours on the tools and on the road against the working hours available, from the job status history, less booked leave | `src/server/reports/utilisation.ts` (new), `/reports/utilisation` | §11 |
| **34** | **Equipment calibration tracking** (**built** — see §7.20) | A calibration register beside certificates, with its own due/overdue queue | `src/server/calibrations/` (new), `/calibrations` | §4.5 |
| 35 | Route optimisation (**built** — see §7.21) | An ordered round from the day's jobs, using the site addresses already held | `/schedule` | §4.4 |
| 36 | WhatsApp and SMS adapters (**built** — see §7.22) | A third and fourth `notify` channel, behind the adapter seam that already exists | `src/server/notify/` | §10 |
| **37** | **Xero/QuickBooks integration** (**built** — see §7.23) | Push billed invoices into Xero through the accounting adapter slice 21 left in place: a driver behind `AccountingExporter`'s sibling seam, `Invoice.externalRef` as the record of what went, and a press that never sends the same bill twice | `src/server/accounting/push.ts` (new), `/invoices` | §10 |
| **38** | **The notification inbox** (**built** — see §7.24) | The `IN_APP` rows every alert has written since Phase 1 finally have a screen: a person's own P1s, due-service reminders and dispatch packs, unread-first, with a failed delivery shown and its reason. Adds no table and no writer — it reads what `notify.ts` already wrote | `src/server/notifications/` (new), `/inbox` | §4.3, §8 |

| **39** | **The Service Report** (**built** — see §7.25) | Two documents. The per-crane **Servicing checklist form** is a `Report` whose job type is flagged `isServiceReport` (seeded on PM): every answered checklist line is graded 1–5 with a comment and submission is refused while one is ungraded. The **Service Report** is its own row per job — prose generated from the graded forms, rewordable by the office — and only it is numbered `SR<yy><mm><nnn>` on approval. Two additive migrations; the monthly counter reuses `DocumentSequence` | `src/server/service-reports/` (new), `src/server/documents/service-report.ts`, `src/server/documents/sequence.ts`, `src/lib/validation/service-report.ts`, `src/lib/validation/reports.ts`, `src/components/tech/report-form.tsx` | §6, §7.1 |

Slices **40–45** — the Android tablet app — are planned separately in [`PLAN-TABLET-APP.md`](PLAN-TABLET-APP.md).
Slice 40 (**built** 31 Oct 2026) widens the technician shell to a tablet (`max-w-lg md:max-w-4xl lg:max-w-6xl`),
moves the gate and the sign-out to an in-scope `/m/login`, makes the manifest installable (`id`, `orientation: any`,
PNG + maskable icons via `scripts/make-icons.ts`), clears Cache Storage on sign-out and asks before deleting unsent
reports. No schema change.

Slice 41 (**built** 31 Oct 2026) makes updates opt-in (`skipWaiting: false` + a banner in the tech layout) and adds
an install card on `/m/jobs` driven by a pre-hydration `beforeinstallprompt` capture. The report form also flushes
its draft on `pagehide`/`visibilitychange`, and an outbox 401 now reports a dead session instead of counting a failed
attempt. No schema change.

Slice 42 (**built** 31 Oct 2026) puts a `NetworkOnly` rule in front of `defaultCache` for every same-origin `GET`
outside `/m/` and `/_next/` — the worker had been caching `/api/tech/sync` and office documents — and adds a
Background Sync `tech-outbox` listener that runs the same `flushOutbox` the page runs, under a Web Lock, rejecting
the `sync` event only for retryable failures. No schema change and no new endpoint.

Slice 44 (**built** 31 Oct 2026) reads the printed crane label with the camera. `TechCrane` gains `qrValue`, the
token's shape and the payload parser move to `lib/cranes/qr.ts` so the scanner (client) and the generator (server)
share one definition, and a new `QrScanner` uses `BarcodeDetector` + `getUserMedia` with a typed-in fallback. A scan
opens that crane's report from the job sheet, or jumps to the other visit the crane is cached under; the report
form verifies the label without ever switching crane. No schema change and no new dependency.

Slice 45 (**built** 31 Oct 2026) is the Play Store wrapper's only app-side piece: Digital Asset Links. A public
`/.well-known/assetlinks.json` (rewritten to `/api/assetlinks`) returns the package and every SHA-256 fingerprint from
two optional env vars, 404s when unset, and 500s on a malformed value. `twa-manifest.json` is committed as the build
config; the keystore and Bubblewrap's generated project are gitignored. No schema change and no new dependency.

Slice 29 was taken first because the contract is the one record the app has been *shaped* around and could not enter:
`Contract` and contract-scoped `SlaPolicy` rows existed, `createJob` already resolved them, and the customer page
already had a disabled Contracts tab. It also gives `sla.manage` its first use.

## 8. Testing strategy

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest | Permission map; status transitions (every legal and illegal edge, `ON_HOLD` reason requirement); SLA calculation; schedule recomputation; document numbering; money/GST maths; Zod schemas |
| Integration | Vitest + real Postgres (Docker) | Services against a real database: audit-log writes, tenant scoping, stock movement reconciliation, report locking and amendment, sync idempotency |
| E2E | Playwright | The two happy paths in §12.10, plus offline mode via `context.setOffline(true)` |

The brief's must-have unit tests are covered in slices 1 and 5; the tenant-isolation tests are slice 1's main
deliverable and are re-run as a regression guard on every later slice.

---

## 9. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| **Offline sync is the hardest part** (photos, signatures, two-sided conflict) | Isolated in slice 8 with its own tests and a documented conflict rule. Client-generated ids from day one, so no later rewrite. Nothing else depends on it. |
| **PDF reproducibility across template versions** | `Report` stores `templateVersion` + the exact `data`; `ReportTemplate` rows are never mutated, only superseded by a new version. Slice 9 test: re-render an approved report after a template change and diff. **Built:** `tests/integration/report-approval.test.ts` approves a report, adds a version 2 template, repoints the job type at it, and asserts the re-rendered SHA-256 equals the stored PDF's — which only works because `Document.creationDate` is pinned. |
| **Compliance rules change (MOM circulars)** | Rules live in `ComplianceRule` with `effectiveFrom`/`effectiveTo` and a required `sourceReference`. Superseding a rule is an Admin data entry, not a deploy. No regulatory fact appears in code. |
| **Scope creep across 14 job types** | Phase 1 seeds all 14 as data but fully builds only 4 templates (servicing, breakdown, visual inspection, load test). The rest are configurable rows. |
| **PDF rendering on Vercel** | No Chromium and no worker. Rendering is pure JavaScript (`@react-pdf/renderer`) inside the approving request; the daily cron retries any render or email that failed. A very large report (dozens of photos) could approach the function duration limit; the retry pass and per-report status make that visible rather than silent. |
| **Schema churn in later phases** | Full schema designed now (§3); Phase 2–4 models exist but stay unused until their slice. Migrations are additive. |

---

## 10. Open questions (assumed, not blocking)

Recorded with the assumption taken and the cost of being wrong, in `ASSUMPTIONS.md`. All six are Phase 2+ shaping
questions: none change the Phase 1 architecture, so none block the start.
