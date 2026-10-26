# ASSUMPTIONS.md

Every assumption made where the brief was silent or ambiguous. Each has the assumption, why, and what it costs if wrong.
**Nothing here blocks Phase 1.** Items marked ⚑ should be confirmed before the phase noted.

## Where the code lives

1. **The app sits in `cimmerian-crane/`, not the folder root.** The sandbox `../CLAUDE.md` says this folder is a
   general-purpose sandbox with no project and that real project work should move into a subfolder. Kept that rule and
   left `../CLAUDE.md` untouched. *If wrong:* move the directory contents up one level — nothing references the path.

## From the brief's open questions (§15)

2. **AE relationship — assume we do not employ an AE; we support AE-led exams.** Work is scheduled, prepared and
   followed up by us; the certificate is issued by an external AE and stored against the crane.
   *Design impact:* `ComplianceRule.requiresAE` and `Certificate.issuer` already model this either way.
   ⚑ Confirm before Phase 2 ships the certificate workflow.
3. **Accounting — assume CSV export first, Xero later.** No accounting API integration in Phase 1 or 2.
   ⚑ Confirm before Phase 2's export adapter is built, since the CSV column shape is vendor-specific.
4. **Technicians use both Android and iOS.** Drives the PWA choice over a native app. *Cost if wrong:* a
   single-platform native app could use the camera and barcode APIs more directly; the PWA already covers both.
5. **Scale — assume ≲ 500 cranes, ≲ 100 customers, ≲ 20 technicians, data arriving as spreadsheets.** Comfortably
   handles single-instance Postgres and the index set in `PLAN.md` §3.10. *If wrong:* hosting and indexing get
   revisited, not the schema.
6. **Hosting — Vercel, with Supabase Postgres.** Confirmed by the user, and it replaced the
   single-VM assumption this plan originally made. Vercel has no long-running process, no durable
   local disk and no reliable way to ship Chromium, so the worker, Playwright PDF and disk storage
   were replaced (see 9, 10 and 21). Deployments use the Node runtime, never Edge, because Prisma
   requires it. The Prisma client is generated on install (`postinstall`).
7. **WhatsApp intake — assume Phase 1 is phone/email/web form only.** `TicketSource` already has a `WHATSAPP` value
   so adding the channel later is an adapter, not a migration.

## Technical assumptions

8. **Auth.js uses JWT sessions (no `Account`/`Session` tables).** Credentials-only login. Role is read from the DB per
   request so a role change takes effect immediately. *Cost if wrong:* adding DB sessions later is one Prisma model
   plus a sweep job.
9. **PDF via `@react-pdf/renderer`** — reversed from Playwright/Chromium because Vercel cannot run a
   Chromium binary reliably. Pure JavaScript, renders inside the approving request. Versioned render
   functions keep old reports reproducible. Justified in `PLAN.md` §2.
10. **Scheduled work via Vercel Cron**, not pg-boss. `/api/cron/daily` is declared in `vercel.json`
    and protected by `CRON_SECRET`. Immediate work (PDF render, email on approval) runs in that
    request; the daily pass retries failures, evaluates reminders and prunes rate-limit rows.
11. **Money as `Decimal(12,2)`, quantities as `Decimal(12,3)`** (parts are measured in metres and kilograms).
12. **Single-tenant, single-company deployment.** No tenant column anywhere. *If wrong:* this is the one assumption
    that would touch every table — worth confirming early, though nothing suggests multi-tenancy is wanted.
13. **IDs are UUID v7** (time-sortable, so index locality stays good) and are **client-generatable**, which the
    offline sync in Phase 1 slice 8 depends on. This is why they are not auto-increment integers.
14. **A `CHECK` constraint enforces `ON_HOLD` requires a reason at the database level**, in addition to service-layer
    validation. The brief states the rule twice; the constraint means no future code path can violate it.
15. **Photographs are compressed client-side before upload** (target ~1600px longest edge) and stored as separate
    files referenced by `File` rows, not inline in `Report.data`.
16. **`StockLevel` is a materialised total reconciled from `StockMovement`.** Movements remain the only way quantities
    change; the level row exists so list screens don't re-aggregate the whole movement history.
17. **GST rate is snapshotted onto the invoice at issue time** rather than read live from settings, so reprinting an
    old invoice shows the rate that applied then.
18. **Report `DRAFT` state is per-technician-per-crane.** A job covering several cranes produces one report per crane,
    which is what makes the crane timeline and the certificate linkage work.
19. **Passwords are hashed with scrypt from Node's standard library**, not bcrypt. scrypt is memory-hard and needs no
    dependency or native build step, which keeps `npm install` clean on Windows. Hashes are stored self-describing
    (`scrypt$N$r$p$salt$hash`) so the cost parameters can be raised later without invalidating existing passwords.
    *Cost if wrong:* the format is ours, so switching to bcrypt or Argon2 later means a rehash-on-next-login, not a
    forced password reset — but nothing suggests we will need to.
20. **Login rate limiting lives in Postgres** (`RateLimitBucket`): 10 failed attempts per email and 30
    per client address, each over a 15-minute window, checked as two independent buckets. This replaced
    the original in-process `Map` when hosting moved to Vercel, where every request may reach a
    different instance and a per-process counter would bound nothing. The increment and window reset
    are one atomic `INSERT … ON CONFLICT` statement, so concurrent instances share the limit. The
    table is small: expired rows are deleted by the daily cron. Losing the database already means
    losing sign-in, so this adds no failure mode.

21. **Files live in Supabase Storage in production** (private bucket, signed URLs), with the local
    disk used only in development. Uploads go directly from the browser to Supabase using a
    short-lived signed upload URL, because a Vercel function request body is capped at 4.5 MB — less
    than a phone photo — and the server must not proxy upload bytes. The `File` row is written after
    the upload succeeds, with the storage key and checksum.

22. **SLA clocks run on calendar minutes, 24/7.** There is no working-hours calendar and no public-holiday table in
    Phase 1. A P1 raised at 23:50 has its full thirty minutes overnight rather than waiting for 08:00.
    *Why:* the brief specifies targets but not the calendar they run against, and a calendar is a substantial table
    of its own. Calendar minutes make the target harder to meet, so the error is towards alerting early.
    *If wrong:* add the calendar to `slaState` and nothing else changes — every caller already goes through it.
23. **A P1 alerts dispatchers when the ticket is created, not later.** The slice table lists the P1 alert under slice
    5, but the moment that matters is the phone call; a P1 that waits for a job to exist alerts after the response
    window has already been eaten by triage. The alert writes an `IN_APP` row and sends through the email adapter,
    both recorded separately so a dead mail server cannot hide the in-app alert.
24. **Technicians hold `ticket.read`, scoped to tickets they raised themselves** (`Ticket.createdById = their user`).
    They are given `ticket.create` so a technician can log a fault a customer reports to them directly; without a read
    capability the confirmation page and any follow-up would be a dead end. They still cannot browse the intake board,
    triage, or see any other ticket — that is proven against the database, not promised in a comment.
25. **Ticket photos are deferred until there is an upload path.** `Ticket.photos` exists in the schema, but Phase 1
    intake captures the description only; photo capture arrives with the offline report work in slice 8, because that
    is where the storage adapter, compression and signed uploads are built.
26. **Checklist and report templates are authored in `prisma/seed-templates.ts` as version 1.** After the first seed,
    the rows in the database are the source of truth and re-running the seed never overwrites them; changing a
    template means publishing version 2, which is a deliberate act. The checklist wording follows the components named
    in brief §6.3 and is marked for review by the technicians before real use.
27. **Ticket intake is an office screen in slice 4.** A technician's ticket-creation UI belongs on the phone, next to
    the job they are already looking at, and arrives with the PWA in slice 7. The service already enforces the
    capability, so adding that screen does not change any rule.
28. **The ticket list is capped at 500 rows rather than paginated.** At the scale assumed in item 5 this is every open
    ticket several times over. Pagination arrives with the company-wide job list in slice 10, where the filtering
    requirements are much heavier; doing it twice would produce two pagination idioms.

## Not assumed — deliberately left to you

- The **document number formats** (`JOB-2026-0001`, `RPT-2026-0001`, `DO-…`, `INV-…`) are placeholders. They live in
  `DocumentSequence` and are a one-line change each once you confirm the format you want.
- The **SLA minutes per priority** are seeded as plausible defaults only, because the real numbers are contractual.
- The **checklist item wording** for the four Phase 1 templates follows the components named in brief §6.3 and is
  marked for review by your technicians before it is used on a real job.
