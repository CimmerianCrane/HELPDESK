# CLAUDE.md — Cimmerian Crane Services Helpdesk

System of record for crane servicing, breakdown repairs, inspections, load testing, parts and compliance documents.
Replaces spreadsheets, WhatsApp threads and paper forms.

Full product spec: the brief the user supplied (this file summarises the parts that constrain *how* we build).
Architecture, screens and phase plan: `docs/PLAN.md`. The full schema: `docs/DATA-MODEL.md`.
Assumptions made where the brief was silent: `docs/ASSUMPTIONS.md`.

---

## Where this lives

This app lives in `cimmerian-crane/` inside a larger sandbox folder. The sandbox root `../CLAUDE.md` still applies
to anything outside this folder. Keep this folder self-contained: its own `package.json`, its own git history.

---

## Commands

All cross-platform (npm scripts, no bash-only tooling). Run from `cimmerian-crane/`.

| Command | What it does |
|---|---|
| `npm run setup` | One command for a fresh clone: install deps, migrate, seed. Works against Supabase or a local database — it does not start Docker |
| `npm install` | Install dependencies |
| `npm run db:up` / `npm run db:down` | Start / stop Postgres via Docker Compose |
| `npm run db:migrate` | `prisma migrate dev` — create and apply a migration |
| `npm run db:deploy` | `prisma migrate deploy` — apply migrations without prompts (CI/prod) |
| `npm run db:reset` | Drop, re-migrate and re-seed the local database |
| `npm run db:studio` | Prisma Studio |
| `npm run seed` | Seed realistic demo data (idempotent: safe to re-run) |
| `npm run dev` | Next.js dev server on http://localhost:3000 |
| `npm run dev:stop` | Stop whatever is listening on the dev port (`-- 3001` for another). Use this rather than `taskkill` |
| `npm run build` / `npm start` | Production build / serve |
| `/api/cron/daily` | Scheduled maintenance (Vercel Cron, declared in `vercel.json`). No local `worker` process exists — see the deployment notes |
| `npm run lint` | ESLint (`eslint .`, not the deprecated `next lint`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests — fast, needs no database |
| `npm run test:integration` | Vitest against the real database (needs `DATABASE_URL`) |
| `npm run test:e2e` | Playwright end-to-end |
| `npm run verify` | `typecheck && lint && test` — the fast gate, no database needed |
| `npm run verify:full` | The above plus integration and end-to-end tests (needs a database and Chromium) |

`npm run verify` is the gate for every commit; a slice is not done until it passes. `npm run verify:full` is
the gate for finishing a slice, since it is the only version that exercises the real database and browser.

### Environment

`.env.example` is the source of truth for required variables; `.env` is gitignored. Key ones:
`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `APP_BASE_URL`, `STORAGE_DRIVER` (`disk` | `supabase`),
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `EMAIL_DRIVER`
(`console` | `smtp`), `SMS_DRIVER` and `WHATSAPP_DRIVER` (`console`, or the named drivers `twilio` / `meta` which are
declared but not yet built and fall back to console), `ACCOUNTING_DRIVER` (`none` | `xero`) with
`XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` / `XERO_TAX_TYPE` for the invoice push, `CRON_SECRET`, `DEFAULT_TIMEZONE`, `DEFAULT_CURRENCY`,
`DEFAULT_GST_RATE`, `SEED_PASSWORD` (optional — overrides the demo password `npm run seed` uses).

**Deployment: Vercel + Supabase.** Use the Node runtime for anything that touches Prisma — never Edge.
There is no long-running worker and no durable local disk. Scheduled work goes in `vercel.json` and
calls a route under `/api/cron/`, which requires `Authorization: Bearer $CRON_SECRET` in production.
Files are uploaded **directly from the browser to Supabase Storage** with a signed upload URL; do not
route uploads through a server action, because Vercel caps a function request body at 4.5 MB.

Anything configurable by the office team lives in the `Setting` table, not in env. Env is for deployment secrets
and infrastructure choice only.

---

## Stack

TypeScript everywhere; Next.js App Router; PostgreSQL + Prisma; Auth.js; Tailwind + shadcn/ui;
Dexie + Serwist PWA; Vitest + Playwright; Zod on every input.

Deviations from the brief's defaults, all justified in `docs/PLAN.md` §2:

1. **PDF: `@react-pdf/renderer`**, pure JavaScript. (Originally Playwright/Chromium; reversed because
   Vercel cannot run Chromium reliably. A versioned render function per template keeps old reports
   reproducible.)
2. **Scheduled work: Vercel Cron + inline rendering**, not pg-boss. There is no worker process.
3. **Auth.js: JWT sessions**, no `Account`/`Session` tables (credentials login only).
4. **Money: `Decimal(12,2)`**, never `float`. Time: `DateTime` in UTC, never local.
5. **Files: Supabase Storage** in production, direct upload with signed URLs. Local disk in development.
6. **Login rate limiting: the `RateLimitBucket` table**, not process memory, because Vercel runs many
   short-lived instances.

Do not add a dependency for something the standard library or an existing dependency already does.
Do not introduce a second way of doing something the codebase already does one way.

---

## Folder structure

```
cimmerian-crane/
  prisma/
    schema.prisma          # single source of truth for the data model
    migrations/
    seed.ts
  src/
    app/
      (auth)/login/        # unauthenticated
      (office)/            # desktop-first: dashboard, inbox, customers, cranes, tickets, jobs (+ /jobs/export),
                           # schedule, schedules, certificates, reports, admin (users, compliance rules, audit log)
      (tech)/m/            # mobile-first technician PWA: my jobs, job detail, report form (slice 8)
      (portal)/portal/     # customer portal (slice 31): own jobs, cranes, certificates, issued reports — read-only
      offline/             # the /offline fallback: renders the deep-linked job from the Dexie cache
      sw.ts                # Serwist worker source (built to public/sw.js, which is gitignored)
      api/                 # route handlers: tech/sync, file upload, health, PDF, webhooks
    server/
      auth/                # session, password hashing, permission map, row-level scope
      users/               # user administration service
      contracts/           # a customer's contracts, the SLA targets agreed on them, and the
                           # renewal queue
      portal/              # the customer portal's read layer — its own jobs, and its reports via
                           # the office services, narrowed by the customerId scope filter
      notifications/       # the inbox (slice 38): the in-app rows notify.ts writes, read through the
                           # caller's own userId, plus marking one read
      audit/               # audit(context, ...) — the only way to write business data; the viewer's
                           # cross-entity search and record labels
      dashboard/           # the office board's morning counts, derived from jobSla
      sla/                 # SLA computation, and the company-wide targets screen writes them
      schedule/            # crane next-due recomputation
      schedules/           # a crane's recurring obligations, and rolling them forward on completion
      compliance/          # ComplianceRule — the rulebook, its adoption check and the admin screen
      reminders/           # the daily scan: which schedule is due, who to tell, and the draft job
      certificates/        # the certificate register and the expiring/overdue queue
      calibrations/        # the equipment register (Resource) and its calibration due dates and scans
      documents/           # numbering, PDF render, email-on-close
      tech/                # the field phone's read layer and its one-call sync bundle
      reports/             # report queue, approval/return/amendment, issued-PDF lookup, email retry;
                           # profitability (invoices against parts cost) and utilisation (job status
                           # history against working hours)
      inventory/           # the parts book, locations, the supplier book, the stock ledger, reorder
                           # groups and purchase orders, the back-orders on them, stock takes; postMovement is the only writer of
                           # StockMovement and StockLevel, tracePartSerials derives a serial's
                           # whereabouts from those same movements, and adjustToCounted is the one
                           # place a count is reconciled to a shelf
      storage/             # StorageAdapter: disk | supabase (signed upload/download URLs)
      email/               # EmailAdapter: console | smtp
      notify/              # notification fan-out to channel adapters
    lib/
      db.ts                # Prisma client singleton
      templates/           # TemplateSchema — the declared shape Report.data must satisfy
      validation/          # Zod schemas, shared by forms, actions and API
      utils.ts
    components/
      ui/                  # shadcn/ui primitives
      office/              # desktop components
      tech/                # mobile components (large tap targets, high contrast)
    offline/               # Dexie schema, sync queue, conflict log (client only)
  tests/
    unit/                  # Vitest
    e2e/                   # Playwright
  docs/
    PLAN.md  DATA-MODEL.md  ASSUMPTIONS.md  README.md
```

One domain = one folder under `src/server/`. Route handlers and server actions are thin: they validate with Zod,
check permission, call a service, return. Logic lives in the service, tests live against the service.

---

## Domain glossary

| Term | Meaning |
|---|---|
| **AE** | Authorised Examiner — a MOM-approved Professional Engineer who issues statutory certificates of test and examination |
| **Crane / asset** | The centre of the data model. Every job, report, certificate, part and reminder hangs off a crane. Each crane belongs to one site and one customer |
| **SWL** | Safe Working Load (kg) |
| **PM** | Preventive maintenance — scheduled servicing |
| **Service Report** | A PM report (`JobType.isServiceReport`) where every answered checklist line is graded 1–5 with a comment. Numbered `SR<yy><mm><nnn>` — `SR2606001` is the first of June 2026 — on approval; every other report is `RPT-…`. Grades live in `Report.data.grades`, keyed by checklist code |
| **Statutory examination** | AE-led inspection producing a *certificate*. Not the same as our inspections |
| **Company inspection** | Work our technicians do and report on. Never called a certificate, never implies statutory status |
| **Finding** | A defect recorded on a report; can spawn a follow-up job |
| **Restricted / Do Not Operate** | Crane flag with a reason; shown on the crane, its customer and every job at that site |
| **Competency** | A technician qualification with an expiry date, checked when assigning |
| **SLA** | Response and resolution targets, per priority, optionally overridden per contract |
| **DO** | Delivery order, generated from parts issued on a job |
| **On hold reason** | Mandatory enum whenever a job enters `On Hold` |
| **CraneSchedule** | A recurring obligation for a crane (monthly service, annual exam, load test…) with `lastDoneDate`/`nextDueDate` |
| **ComplianceRule** | Editable configuration mapping crane type → interval + whether an AE is required. Never hard-coded |
| **StockMovement** | One append-only row per change to stock. The only way a quantity changes, posted through `postMovement`, which moves the `StockLevel` in the same transaction |
| **On hand** | A part's summed `StockLevel`, computed on read. May go negative when a part is issued that was never received — shown in red, corrected by a count |
| **Preferred supplier** | The supplier a part names, which is the group the reorder list files it under. Retired suppliers are not offered; a supplier a part still prefers cannot be retired |
| **Back-order** | What an open purchase order line still owes of a part (ordered less received). Never stored as a flag: it appears against the jobs on hold awaiting that part, with the line's `expectedAt` as "when it lands" |

---

## Rules that must never be violated

1. **Server-side authorization on every query and every action.** Authorization has two halves and both are
   required. `src/server/auth/permissions.ts` decides *whether* a role may do something; `src/server/auth/scope.ts`
   decides *which rows* it may do it to, and every read spreads its filter into the `where`. A capability without a
   scope filter is a bug, not a shortcut. Services take an `AuthContext` as their first argument and call
   `assertCan` themselves, so no service can be reached without an identity. UI checks are cosmetic; the server
   check is the real one. A technician must never read another technician's jobs or any data belonging to another
   customer.
2. **Compliance rules are data, not code.** Intervals, whether an AE is required, and the legal reference live in
   `ComplianceRule` + `CraneSchedule` and are editable by Admin, each carrying a free-text **source/reference** and a
   `reviewedAt` date. Never invent or hard-code a regulatory fact. The admin screen carries the standing notice:
   *"Rules are configured by your team. Verify against current MOM requirements with your Authorised Examiner."*
3. **Company inspection ≠ statutory certificate.** Keep them distinct in the data model, the UI wording and the PDFs.
   Our reports never claim to be statutory certificates.
4. **Never hard-delete reports, certificates or audit logs.** Soft-delete and archival only.
5. **Approved/issued reports are immutable.** A correction creates an *amendment* — a new version linked to the original
   with a reason. Never overwrite. An old report must always re-render exactly as originally issued (store the
   template version with the report and snapshot the rendered data).
6. **Every business mutation writes an audit log entry** (entity, entityId, action, before/after, userId, timestamp, ip).
   `AuditLog` is append-only.
7. **Every status change is timestamped, attributed and recorded** in `JobStatusHistory`. `On Hold` requires a reason.
   Priority bumps that displace a scheduled job are audit-logged with a reason.
8. **All timestamps stored in UTC.** Timezone, currency and GST rate are settings, never constants. Dates display as
   `DD/MM/YYYY`.
9. **Every input validated with Zod at the trust boundary** — form, server action and route handler alike.
10. **Stock quantity changes only ever happen as a `StockMovement`, posted through `postMovement`.**
    Quantities are derived/reconciled from movements, and that one function moves the materialised `StockLevel`
    in the same transaction — never write either table directly. Issuing a part on a job writes to both the
    report's parts list and the DO.
11. **Never lose field data.** Reports auto-save locally every few seconds. Sync uses client-generated ids so a retry
    is idempotent. On conflict, the technician's own field data wins for their job report; office scheduling edits never
    overwrite field data; conflicts are logged.
12. **No bash-only scripts.** Everything runs on Windows, macOS and Linux via npm scripts.

---

## How authorization is done here

Every slice that reads or writes business data follows this shape. It is short on purpose.

```ts
// 1. The service takes the caller's identity. It never accepts a role or an id from the caller.
export async function listJobs(context: AuthContext, filters: unknown, client: Tx = db) {
  // 2. Capability: may this role do this at all?
  assertCan(context, 'job.read.all')

  // 3. Scope: which rows? Spread the filter; never build a `where` without it.
  return client.job.findMany({ where: { ...jobReadWhere(context), ...validated(filters) } })
}

// 4. The service writes through withAudit, passing the client so the caller's transaction is used.
await withAudit(context, async (tx, log) => { ... }, client)
```

- `assertCan` throws `ForbiddenError`; `runAction` turns that into a message the form can show.
- Actions are thin: `formValues(formData)` → service → `revalidatePath`. No business rules in an action.
- Route handlers translate `AppError` to its `status`; anything else is a 500 and reaches the logger.
- A new entity gets a `xxxReadWhere` in `scope.ts` **before** its first service, so the fail-closed
  default is in place from the start rather than retrofitted.

## How the offline phone is wired

The technician PWA is four pieces. New work extends these; it does not add a fifth way of doing the same
thing (see `KICKOFF.md` "Where the build stands" and `docs/PLAN.md` §7 for what is being built next).

1. **Read layer** — `src/server/tech/my-jobs.ts`. Every query spreads `jobReadWhere(context)` and every
   function calls `assertCan` first. A technician's own job list is the only list; another technician's
   job returns `NotFoundError`, not `ForbiddenError`, because a 403 confirms the job exists.
2. **One sync call** — `GET /api/tech/sync` returns a single bundle: open jobs with site details, crane
   history and checklist, plus reference rows (cranes, checklist items, parts, that technician's site
   contacts) and the operating `timezone`. Not one request per thing: a phone at a site gate is the worst
   place to run eight sequential requests, and a half-finished sync is worse than none.
3. **Client cache** — `src/offline/db.ts` (Dexie) writes the bundle in one multi-table transaction,
   clearing the old rows first. Components read from Dexie only in `src/components/tech/offline-shell.tsx`,
   which is what the `/offline` fallback renders.
4. **One component, two renderers** — the server pages (`/m/jobs`, `/m/jobs/[id]`) and the offline shell
   render the same `JobList` / `JobSheet`. Never fork them: a cached screen that drifts from the live one
   is a support call you cannot reproduce.

Also fixed by design: the service worker is disabled under `npm run dev`; the manifest lives at
`/m/manifest` because Next reserves `manifest.webmanifest`; signing out clears the Dexie cache before the
session ends, because site phones are shared.

## Working agreement

- **One vertical slice at a time**: database → service → API → UI → tests. After each slice: `npm run verify`,
  a commit with a clear message, and a 3–5 line summary of what works and how to try it.
- The schema is designed up front for all phases (`docs/DATA-MODEL.md`) so we don't rewrite it; only the current phase's
  UI and logic get implemented.
- Migrations are reversible where possible. Never edit an applied migration — add a new one.
- Seed data stays realistic and the seed stays runnable after every slice.
- Empty, loading and error states are part of the work, not a follow-up. Forms show clear validation messages.
- Technician screens are checked at ~390px width and in offline mode before a slice is called done.
- Update this file and `docs/PLAN.md` in the same commit as any change that makes them wrong.

---

## Definition of done (every slice)

Typecheck, lint and tests pass · new logic has tests · permissions proven server-side by a test · mutations are
audit-logged · empty/loading/error states handled · mobile technician screens checked at 390px and offline ·
README and CLAUDE.md updated · migration included · seed still works · short summary written.
