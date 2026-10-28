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
29. **A job must have a site; a ticket need not.** `Job.siteId` is non-null in the schema because a job is a visit and
    somebody has to be sent somewhere. The site is taken from the ticket, or from the first selected crane when the
    ticket named none. A job whose cranes sit at two sites is refused rather than silently filed at the first — that
    is how a technician ends up at the wrong plant. *Cost if wrong:* a genuinely multi-site visit would need one job
    per site, which is also how the report and invoice would have to be split.
30. **Converting a ticket stamps `closedAt` and sets status `CONVERTED`.** The ticket's response/resolution clocks
    stop when the jobs take over, and the ticket can no longer be triaged, closed or reopened — it is the record of
    the call, not of the work. *Cost if wrong:* reopening a converted ticket would mean deciding whether the linked
    jobs keep their own numbers; the linked jobs would be the safer starting point.
31. **One ticket may become several jobs, but the ticket screen creates them one row at a time.** The service accepts
    up to 20 jobs per conversion (the UI posts one group per row). Every job inherits the ticket's customer, site and
    single crane; per-job crane selection belongs with dispatch in slice 6.
32. **A P1 job raised directly alerts dispatchers; a job made from a ticket does not.** The call already alerted them
    when the ticket arrived, and an alert per follow-up job would train people to ignore the one that matters. The
    notification row records `jobId` so a future in-app inbox can link straight to the work.
33. **Job SLA deadlines are snapshotted onto the job at creation** (`slaResponseDue` / `slaResolveDue`), and the job
    screens compute state from those stored deadlines. Editing `SlaPolicy` later therefore cannot rewrite history.
    The target minutes are derived back from the snapshot for display rather than read live from the policy.
34. **Resolution for a job is met at `completedAt`, falling back to `closedAt`.** The customer's window is about the
    crane being usable again, not about the invoice being raised, so `invoicedAt` deliberately does not satisfy it.
35. **Correcting a job's paperwork uses `job.create`, not a separate `job.edit`.** Dispatcher and Admin already hold
    both; adding a capability nobody would be granted differently would be a name without a rule. Status changes
    remain `job.transition`, so editing text and moving the lifecycle stay separate permissions.
36. **There is no technician job screen in slice 5.** The service and `jobReadWhere` already scope `job.read.own` to
    assigned jobs and are covered by isolation tests, but the phone UI arrives with the PWA in slice 7. Office roles
    hold `job.read.all`; the `/jobs` list asserts it, so a technician is refused rather than shown a redirect.

37. **On-call is a list of shifts, not an `isOnCall` flag on the technician.** A flag answers "who is on call now",
    which is the one question a dispatcher can answer by looking out of the window; what is actually needed is
    "who was on call at 02:00 on Sunday, and is there an hour nobody was". Shifts may overlap deliberately (a
    handover where both are reachable is safer than a clean cut), and the gaps are computed by `onCallGaps` from the
    merged spans. *Cost if wrong:* a flag plus a shift history would be two records of the same fact.
38. **`JobType.requiredCompetencies` is a list of names, matched case-insensitively against `Competency.name`.** Both
    are typed by people in different screens, so a join table of competency ids would require an admin screen for
    competency types before the first job could be scheduled. A name that matches nothing is a *gap*, which is the
    safe direction. The existing `blockAssignmentOnExpiredCompetency` setting decides whether a gap blocks or warns:
    when it is on, a missing competency blocks; when it is off, nothing does. A blocked competency is never
    overridable through the form — that is the whole point of it being a block — while a double-booking or a clash
    with leave is a warning that needs `override` **and** a written reason, and writes its own audit row.
39. **A priority bump is recorded twice: as a `ScheduleBump` row and as an audit entry.** The row answers "why did
    Tuesday's service move" without reading an audit diff and keeps the previous dates, so the move can be undone;
    the audit entry answers "who decided". The bump frees the slot and returns the displaced job to `APPROVED` with
    its dates cleared. It deliberately does **not** place the incoming job: doing both in one call would hide one
    refusal (the incoming job's competency or travel check) inside the other.
40. **A `datetime-local` value means wall time in the operating timezone, never UTC.** The browser input carries no
    zone, so the schema validates its shape only and the service converts it with `localWallToUtc` using the
    `timezone` setting. Reading it as UTC in a schema — the obvious implementation — makes every visit depend on the
    server's locale and moves everything by the zone offset with nothing looking broken. `src/lib/time.ts` is the
    only place the conversion exists, and it is unit-tested against a zone with daylight saving (a week across the
    change is 169 hours, not 168).
41. **Dragging a card on the board is one service call, not two.** A drop says who and which day at once, so
    `moveJobCard` composes the assignment and reschedule services inside a single transaction: if the competency
    check refuses the person, the date does not move either. The card keeps its wall-clock time when it changes day
    (Tuesday 08:00 becomes Wednesday 08:00), because that is the slot the dispatcher chose. A drop that would
    double-book refuses with the same message the form would give; an override needs a reason, so it is only
    available through the form.
42. **A board card belongs to one technician.** Dropping a card onto a named technician replaces the crew rather
    than adding to it, because a card is drawn in one cell and showing it in two would misrepresent what is booked.
    Multi-person visits are staffed through the job screen. Dropping on the unassigned rail takes everybody off.
43. **Leave that clashes with scheduled work is recorded, not refused,** and the job numbers it clashes with are
    named in its audit entry. People book leave after a visit was planned; refusing the leave would push the office
    to keep the diary and lose the record. The board marks the card and the dispatcher moves it.
44. **A resource booking with no span follows its job's dates.** A test weight is on site for the visit, so making
    the office type the visit's own start and end again would be a second place for them to disagree. A job with no
    dates cannot lend one, so that booking needs its own span. An expired calibration or a maintenance status is a
    warning requiring confirmation, not a refusal — the office may be booking it in order to send it away.
45. **Dispatch is its own lifecycle step, and only `SCHEDULED` can be dispatched.** Dispatching moves the job to
    `DISPATCHED` with a `JobStatusHistory` row; re-dispatching an already-dispatched job re-sends the details (a
    technician who lost the email) without pretending it is a new step, and without re-stamping anything. The message
    itself is rendered from rows — access notes, the site contact, recent approved reports and certificates, the job
    type's checklist — so what the technician receives is assembled once rather than remembered under pressure.

46. **The phone's sync is one request, not one per thing.** `/api/tech/sync` returns a single bundle: the
    technician's open jobs with site details, crane history and checklist, plus the reference rows (cranes,
    checklist items, parts, that technician's site contacts). A phone on one bar of signal at a site gate is
    the worst place to run eight sequential requests, and a half-finished sync is worse than none — so the
    bundle is fetched whole and written to IndexedDB in a single transaction that clears the old rows first.
    The bundle carries the operating `timezone`, so a cached page formats dates as the office does rather than
    in the phone's own zone.
47. **The service worker is off in development.** A worker that survives `npm run dev` serves the page you were
    looking at an hour ago while you edit, and the dev overlay cannot tell you that is why. So
    `next.config.ts` disables Serwist when `NODE_ENV === 'development'`, and offline behaviour is verified
    against `npm run build && npm start`. The Playwright offline test skips in dev with an explicit reason
    rather than passing vacuously.
48. **`/offline` reads `window.location` instead of being a generic apology.** A deep link to a job the phone
    had never opened as its own document still must show *that* job, so the service worker's fallback serves
    `/offline`, which parses the pathname and renders the job from Dexie. A static page that said "you are
    offline" would technically satisfy the brief and would be useless on a site with no signal.
49. **The manifest lives at `/m/manifest`, not `/manifest.webmanifest`.** Next reserves the conventional
    filename: a route directory named `manifest.webmanifest` breaks the build outright
    (`Invariant: no direct app page entry found for /_not-found`). Nothing requires the conventional name —
    browsers read whatever the page's `<link rel="manifest">` points at. The icons are SVG with
    `sizes: "any"`, which Chrome, Android and iOS all accept for vector art; a PNG ladder would be a binary
    nobody here can edit.
50. **Signing out on the phone clears the IndexedDB cache first.** Site phones are shared between technicians
    and handed over at a shift change, so a cache that outlives the session would show the next person the
    previous one's jobs. The cache is cleared, then the session ends. The service worker's document cache is
    not purged, but those documents were fetched with a session and the server gate still applies to anything
    it re-fetches.

51. **Demo customers, cranes and jobs are seeded only into an empty register.** `seedWork()` returns
    immediately if any customer exists, because the seed also runs against the real hosted database: demo
    rows must never appear mixed into a live customer list. Dates are seeded through the same wall-clock
    conversion the services use, so "tomorrow 08:00" is 00:00 UTC in Singapore, not 08:00 UTC.

52. **A report draft exists only on the phone.** There is no `DRAFT` row in Postgres while the technician is
    filling the form: the draft is a Dexie row, written every couple of seconds, and submitting creates the
    report with the id the phone generated before it went offline. The office therefore never sees a
    half-finished report, and the server never holds a report the technician has not signed.
53. **Checklist answers are stored in a reserved `Report.data.checklist` key**, keyed by `ChecklistItem.code`.
    The checklist template and the report template are versioned independently, so answers cannot be keyed by
    report field key. The submission validates them against the checklist template the **job type** points at,
    and the key is reserved: a report template may not declare a form field called `checklist`.
54. **Photos and signatures attach to the job, not to the report.** They are uploaded before the report row
    exists, so `File.entity = 'Job'` with `jobId` set; the report refers to them by id. The id is generated on
    the phone, which makes a retried upload upsert the same `File` row instead of leaving an orphan. Storage
    keys are `jobs/<jobId>/<fileId>.<ext>`.
55. **The outbox item id is the report id.** Re-queueing after a failed upload therefore replaces the item
    rather than adding a second, and the server's `SyncReceipt` is keyed by the same id inside the submission
    transaction. Once the server has accepted a report, editing and resubmitting on the phone is a no-op that
    returns the first result: a submitted report is immutable (CLAUDE.md rule 5).
56. **A rejected queued report stays queued, with the server's reason on screen.** The form does not discard
    field data it cannot yet explain; the technician can reopen the draft, correct it and submit again, and
    the queue retries the same id. A validation rule that will never pass is treated the same way — the
    message is the actionable part, and the data is not thrown away to clear the badge.
57. **The disk storage driver has no download URL yet.** `signedDownloadUrl` throws for `disk` on purpose:
    nothing in slice 8 reads a file back (the phone keeps the bytes until upload, and the office has no report
    viewer). Slice 9's PDF embedding is the first caller, and adding it is a route plus a token extension
    rather than a redesign.
58. **Issuing a part writes a `StockMovement` with no source location.** The van bins and the
    `StockLevel` reconciliation arrive in Phase 3; until then the movement records what left stock, for which
    job and report, at what cost — which is the audit trail, even though no on-hand count moves yet.
59. **Supabase uploads are not size-checked server-side.** The browser PUTs straight to Storage with a signed
    URL, so the server never sees the bytes; it checks the declared type and size and re-checks them on the
    disk driver, which does receive them. A bucket-level file size limit is the production control, and is
    noted here because it is a real difference between the two drivers rather than an oversight.
60. **A draft started under an older report template is restarted.** Submission refuses a template version the
    phone did not render, so the form detects the mismatch when it loads the draft and starts again with a
    notice. The old answers cannot be submitted against the new shape, and keeping them on screen would let a
    technician finish a form that cannot be sent.
61. **The technician's name is prefilled from the signed-in session, not from the cache.** The online report
    page passes the authenticated user's name into the form; the offline shell falls back to the name saved
    with the sync bundle. The bundle can land after the form opens, and depending on it for a required field
    left the name blank and the submit refused with no explanation of why.

## Slice 9 — approval, locking and PDF

62. **`ReportStatus.RETURNED` is a new status, not an amendment.** Sending a submitted report back to the
    technician is the third decision the queue needs (approve / return / correct). Modelling it as an
    amendment would give an unapproved report a document number it never earned; modelling it as `SUBMITTED`
    with a note would leave the queue unable to tell "not looked at" from "looked at and refused". The reason
    lives on `Report.returnReason`, a new column, because a technician cannot read the audit log.
63. **One data-driven renderer, not a component per template.** The plan assumed a versioned component per
    template. That is a third copy of a shape the template already declares as data, rewritten for every job
    type the office configures. `renderReportPdf` (`src/server/documents/render.ts`) instead takes the template
    schema stored on the report plus the stored answers. `Report.template` is read by `Report.templateId`, never
    through `JobType.defaultReportTemplateId`, so a superseded template cannot change an issued document.
64. **PDF timestamps are pinned to the approval time.** `@react-pdf/renderer` writes `creationDate = new Date()`
    into the info dictionary, so two renders of one report are never byte-identical. `Document.creationDate` and
    `modificationDate` are set from `issuedAt`; that is what makes "re-render an issued report and diff it" a
    real test rather than a coincidence.
65. **Photos are snapshotted onto the report as `Report.data.photoFileIds`.** Slice 8 validated the photo ids and
    then dropped them, leaving the `File` rows attached to the job with nothing pointing back from the report.
    Storing the ids in `data` beside the checklist avoids a join table for a list that never changes after
    signing, and means the issued PDF embeds exactly the photographs that were attached when it was signed.
66. **Approval moves the job COMPLETED → REVIEWED.** A report is what finishes the work, so approving it is the
    review. Only from `COMPLETED`, and `reviewedAt` is written once like every other lifecycle stamp.
67. **The customer email is sent after the commit and retried by the daily cron.** Approval commits the number,
    the PDF and the status; the mail goes afterwards so a dead mail server cannot roll back an issued document.
    `approvedAt` set with `emailedToCustomerAt` null is the complete definition of "issued but not told".
68. **An amendment is a copy, at most one open at a time.** Copying the answers lets the office correct the new
    one without touching the issued report. A second open amendment of the same report is refused, because
    whichever was approved second would silently win.
69. **Download tokens are purpose-separated from upload tokens.** `signUploadToken` signs
    `<purpose>.<key>.<expiry>`. Without the purpose an upload grant could be replayed as a download grant, or
    the reverse — read access would become write access to a signed photograph.
70. **Reads inside a transaction take the transaction's client.** Every service that opens `withAudit` passes
    its `tx` to `getSettings`, because `DATABASE_URL` is the Supabase transaction pooler with
    `connection_limit=1`: a read through the global client while a transaction is open waits for a second
    connection that cannot arrive, and the request dies on `P2024`. The integration suite has a larger pool and
    did not catch this; the end-to-end suite against the dev server did. Any new helper that reads a table
    from inside a transaction takes the same optional `client: Tx = db` argument.
71. **A sync requested while a sync is running is queued, not dropped.** `SyncProvider` runs one sync at a
    time so two bundles cannot be written out of order. The first version returned early when another was in
    flight, which on a slow connection dropped the `online` event that fires when the radio comes back — and
    with it the flush of the report the technician had just finished, which then sat in IndexedDB until the
    next page load while the screen said nothing. The end-to-end suite caught it because the mount sync took
    longer than the offline stretch of the test. `sync()` now sets a `queued` flag and loops once more in the
    same call when an overlapping request arrived.

## Slice 10 — the job list, the dashboard and the audit viewer

72. **A saved filter is its own table, not a `Setting` row.** A `Setting` is one value under one key; saved
    filters are a list, they are added, renamed and deleted, and they belong to the person who made them.
    `SavedJobFilter` is keyed `(userId, name)` so saving the same name twice replaces the query instead of
    failing, and every read and write filters by `userId` directly rather than by a scope helper — a saved
    filter belongs to exactly one person, so the owner *is* the row filter.
73. **A saved filter stores the address-bar query string.** It replays exactly the view that saved it and
    cannot drift when the list gains a filter later. The cost is that a query saved today could name a
    parameter a future slice removes; the Zod schema on the list would then reject the whole filter, which
    is visible rather than silent.
74. **Saved filters are not audited.** CLAUDE.md rule 6 covers business mutations; renaming a personal view
    changes no job, customer or report, and an audit log full of them buries the entries that matter. This is
    the one write in `src/server` that deliberately skips `withAudit`, and it is written down here so it is a
    decision rather than an omission.
75. **The SLA state filter runs in JavaScript, over a capped row set.** "Breached" is a function of a
    snapshotted deadline and the clock, not a column, so a SQL predicate would be a second implementation of
    `slaState` — exactly what `src/server/sla/sla.ts` exists to prevent. `listJobs` therefore takes at most
    `MAX_JOB_ROWS` (2,000) rows, applies every other filter in SQL, and drops the non-matching SLA states
    afterwards. The page then slices that set in memory rather than issuing `skip`/`take`. At the scale in
    ASSUMPTIONS 5 the cap is the whole book of work; `shortcut: 2,000 rows, when a month exceeds it, add a
    snapshot of the SLA state as a column written at transition time`.
76. **The date range filters on the visit date, falling back to when the job was raised.** A range is two
    wall dates in the operating timezone (00:00 to 23:59:59 local), so it is resolved with `wallTimeToUtc`.
    A job with no `scheduledStart` matches on `reportedAt`: the date it was raised is the only date it has,
    and a range that silently omitted the unscheduled backlog would be worse than one that includes work
    somebody raised that morning.
77. **The calendar files a visit by its wall date, and always draws six weeks.** A job at 00:30 Singapore is
    16:30 UTC the previous day, so bucketing by the UTC date would put it on yesterday's square; `dayKey` is
    the same helper the schedule board uses. The grid is 42 squares from the Monday on or before the 1st, so
    the month arrows never change the height of the page. Undated jobs are left off it — a calendar is about
    dates — which is why the list view remains the default.
78. **"Late visit" on the dashboard means a scheduled start that has passed on work that has not begun.**
    Status `IN_PROGRESS`, `COMPLETED` and later mean somebody is on it or it is finished; everything earlier
    with a `scheduledStart` in the past is late. It is a click away from the same list ordered by visit date,
    so the tile and the list cannot disagree about which jobs they are counting.
79. **The audit viewer is gated on `audit.read` inside the page *and* sits behind the admin layout.** The
    layout checks `user.manage`, which is a narrower question than `audit.read`; a role holding the second
    without the first would be turned away by the layout before the page renders (and today no role does).
    The check inside the page is the one that matters: it is what a future screen or action reusing the
    audit reads relies on, and it is asserted in `tests/integration/jobs-list.test.ts`. A 404 would tell an
    administrator the page is broken, so the page states the refusal in a sentence.
80. **The audit viewer labels records with one batched query per entity type.** A 100-row page costs at most
    seven lookups instead of a hundred, and each label links to its record's office screen where one exists.
    Entities with no office screen (`Finding`, `StockMovement`, `File`, …) show the row's id, which is ugly
    but honest.
81. **"Assign the nearest qualified technician" is a competency check, not a distance.** The data model has
    no technician location — `Technician` carries no site, no postcode and no last-known position — so any
    distance would be invented. What the assignment form does enforce is the part the brief can be held to:
    the technician's competencies are matched against `JobType.requiredCompetencies`, an expired one warns or
    refuses depending on `blockAssignmentOnExpiredCompetency`, and a clash or a leave day has to be
    overridden with a reason. Adding real proximity means giving technicians a home site or a check-in
    position first; until then the dispatcher picks from the technicians the form says can do the work.
82. **The demo book is keyed on natural keys, and it is gated like the demo accounts.** Re-running
    `npm run seed` finds each customer by legal name, each site by (customer, name), each crane by asset tag,
    each part by part number, each historical job by a marker in `internalNotes`, and each opening stock
    movement by `reasonCode: 'DEMO-OPENING'`; it creates only what is missing. It also only runs where the
    demo password is allowed (a local database, or `SEED_DEMO_USERS=true`) — the same reasoning: invented
    customers must never look like a real register. Because `seedWork` still owns the first two customers,
    this book adds to them rather than replacing them, which is what lets an existing development database
    gain the estate without being reset.
83. **Seeded historical reports have a document number but no stored PDF.** The seed runs under `tsx`, which
    cannot load `@react-pdf/renderer`'s hyphenation data (`ERR_PACKAGE_PATH_NOT_EXPORTED ./en-us`), so it
    cannot render. The rows are otherwise complete — APPROVED, numbered, signed, on the crane's timeline —
    and approving a new report in the app produces a real PDF exactly as the issued one would. A seed that
    could render would need the PDF dependency to be loadable under tsx first.

84. **Ending a schedule is a soft delete, so `CraneSchedule` gained a `deletedAt`.** Nothing else fit: a
    hard delete would break CLAUDE.md rule 4 for the reminders and jobs that point at the row, and an
    `isActive` boolean would sit beside `deletedAt` as a second way of saying the same thing. Live reads
    spread `craneScheduleReadWhere`, so an ended obligation disappears from the crane page, the list and
    the counts while its record and audit trail stay. Re-raising the same kind of obligation on the same
    crane afterwards is allowed — the duplicate check only looks at live rows.
85. **"Mark schedule done" is a checkbox on the existing completion form, not a separate action.** One
    write, one transaction, one permission check: `markSchedulesDone` runs inside `transitionJob`'s
    `withAudit`, so the status change and the rolled-forward due dates commit together or not at all. The
    date recorded is the job's `completedAt`, never the wall clock, so a report signed on Friday and moved
    to Completed on Monday still dates the work on Friday. A schedule named against a crane the job did
    not touch is refused rather than skipped — a silent no-op would hide a form that disagrees with the
    ledger. **No job type is mapped to a schedule type anywhere in code**: that mapping is a
    `ComplianceRule` (slice 14), which is the rule-2 requirement.
86. **Overdue is derived on every read, never stored.** `dueBucket(nextDueDate, now)` is the single
    definition, shared by the crane block, the list, the counts and the completion checkboxes; the
    comparison is by calendar day in UTC, so something due today is not overdue at 00:01. The bucket
    boundaries are inclusive: at most 30 days left is `30`, at most 60 is `60`, at most 90 is `90`, and
    anything further out is `later`. `addMonths` clamps to the target month's last day (31 Jan + 1 month
    is 28 or 29 February) — lossy for a chain but self-correcting here, because every recompute counts
    from a real completion date rather than from the previous computed one.
87. **The schedule list is scoped on `crane.read`, not `schedule.manage`.** Reading what is due on a crane
    is part of reading the crane; a technician is assigned the machine and needs to know it is due a
    service. Editing needs `schedule.manage`, which a technician does not hold. The search text is
    `AND`-ed onto the crane's scope rather than spread beside it — `craneReadWhere` uses `OR` internally
    for a technician's cranes, and a second `OR` on the same object would have replaced it, letting a
    search for another customer's asset tag through. `tests/integration/schedules.test.ts` asserts that.

88. **A certificate's compliance date is `expiryDate ?? nextDueDate`, bucketed on every read.** The
    certificate register answers "what is about to lapse", so it uses the same `dueBucket` (overdue,
    30, 60, 90, later, none) the schedule list uses, and nothing stores an overdue flag. The dashboard
    tile keeps its existing 30-day window and its "Certificates expiring" wording, because it sits in
    the dashboard's "The next 30 days" card; `/certificates` headlines the 90-day window the brief asks
    for and shows overdue separately. Both read `certificateCounts`, so the tile and the list cannot
    disagree about the window they share.
89. **Only the statutory test and examination is labelled an AE statutory certificate.** The brief says
    an Authorised Examiner issues the certificate of test and examination, and that is the one type
    marked as statutory in the UI. Every other `CertificateType` — load test, calibration, registration,
    competency, lifting gear examination, repair/modification record — is shown as a "Supporting
    document" rather than claiming an issuer we do not know. No regulatory interval or issuer is
    hard-coded: the register records what the document says, and the standing note on both screens says
    our own reports are company inspections, never certificates (CLAUDE.md rule 3).
90. **Certificate scans use the same signed-URL upload path as photos, with `FileKind.CERTIFICATE`.**
    The file is uploaded by the browser directly to storage, so a PDF never passes through a server
    action (Vercel caps a function body at 4.5 MB). The `File` row is owned by the crane
    (`entity: 'Crane'`, `entityId: craneId`), and the certificate write checks that the file is a
    `CERTIFICATE` belonging to that same crane. `completeUpload` decides whether a PDF is acceptable
    from the File row's `kind`, never from the request, because the declared MIME type is not a trust
    boundary. Re-uploading with the same client-generated id rewrites the row and follows the new
    storage key, so replacing a PDF with a photograph cannot leave the certificate pointing at bytes
    that were never stored.
91. **The certificate register resolves its files in one batched lookup.** `Certificate.fileId` is a
    plain id with no Prisma relation to `File`; the list queries the files by id in one `findMany` and
    signs a short-lived download link per row. Adding a relation would be a schema change for a lookup
    this cheap, and would only be worth it if certificates ever need to be joined through files.
    `certificateReadWhere` follows `craneReadWhere` — a technician reads certificates on cranes they are
    assigned work at and nobody else's; writing needs `certificate.write`.

92. **`ComplianceRule` needed no schema change; `reviewedAt` is required in Zod, not in the column.**
    The model already had a NOT NULL `sourceReference` and a nullable `reviewedAt`. The brief requires
    both fields on a rule, so the form and the service refuse a rule without a review date, and saving
    records the reviewer in `reviewedById`. The column stays nullable so a rule written by a script or
    an earlier build is not retro-invalidated. The only migration in slice 14 is the two additive
    `Crane` prompt columns.
93. **Two capabilities cover two different jobs.** `compliancerule.manage` (Admin only) reads and writes
    the whole rulebook, superseded rules included — that screen *is* the configuration. A dispatcher
    needs only `schedule.manage` on `rulesForCraneType`, which returns the in-force rules for one kind
    of crane so they can be adopted: they can base an obligation on a rule without being able to
    invent one. The nav link follows `compliancerule.manage`, so only an Admin sees it — which also
    keeps `/admin/*`'s `user.manage` layout gate honest.
94. **Adopting a rule copies its kind and interval, and the form's own values are ignored.** A schedule
    "based on" a circular but running on a different cadence is a citation that does not describe the
    work. `createSchedule`/`updateSchedule` resolve the rule, refuse one written for another crane type
    or not in force today (naming the reference), then write `source = 'RULE'`, `ruleId`, and the
    rule's `scheduleType`/`intervalMonths`. The kind of obligation is fixed once a schedule exists —
    changing it is ending one obligation and adding another.
95. **One rule in force per `craneType × scheduleType`, enforced at write time.** Effective windows are
    inclusive and may be blank at either end (unbounded). An overlapping live rule is refused with a
    message telling the office to end the old rule first; superseding is `effectiveTo` or untick *In
    force*, never two live answers to one question. Deactivating a rule does **not** rewrite the
    schedules already citing it: their copied interval and `ruleId` are the honest record of what they
    were based on, and re-pointing them is a deliberate edit.
96. **The re-registration reminder is a stored prompt on the crane, not a `Notification` row.** There is
    no in-app notification inbox anywhere in the app (the `Notification` model is written by the
    notify fan-out and read by email only), so a notification would be invisible where the crane lives.
    `Crane.reregistrationRequiredAt`/`reregistrationReason` carry the prompt and its cause; the crane
    page shows it in amber with a Mark-as-checked button, and acknowledging clears it and audits the
    check. It is raised by `updateCrane` on an owner change or a site move, and fanned out by
    `updateCustomer` to every live crane when the customer's UEN changes. The wording says "may be
    required" — only the AE can decide for certain.
97. **No compliance rules are seeded.** Seeding an interval, an AE requirement or a citation would be
    inventing a regulatory fact (CLAUDE.md rule 2), and the brief explicitly says not to assume which
    MOM circular governs. The screen therefore ships with an empty state, and until a rule is added a
    schedule's interval and AE requirement are typed by hand on the crane as they were in slice 12.

98. **"The account owner" is the office roles that own the work, not a per-customer person.** The
    brief's §8 wording assumes an account owner per customer; there is no such field, and inventing one
    would be a user question, not a schema guess. Reminders therefore go to the same recipients as a P1
    alert — every active Admin and Dispatcher — through the same two-channel fan-out. If the office
    wants one named person per customer, that is a `Customer` field and a recipient change, not a
    rewrite of the scan.
99. **A reminder is sent at most once per (schedule, threshold, due date).** `ReminderDispatch` holds
    the claim, unique on all three, so a retried Vercel Cron or a twice-run scan is a no-op. `period`
    is the due date as a calendar day in the operating timezone: a schedule that is done and rolled
    forward starts a fresh period and can remind again. Two consequences are deliberate — a threshold
    missed during an outage is not backfilled (the next one that is still open fires instead), and
    "overdue" fires once per period rather than daily. The dashboard's overdue count is the ongoing
    signal; a daily email about a service nobody has booked is how reminders get filtered away.
100. **The scan emits in-app rows as well as email, but there is still no in-app inbox.** The
    `Notification` model and fan-out are the brief's own mechanism (§4.3, §8) and are used unchanged;
    until an inbox screen exists, the email is the channel that actually reaches somebody. This is the
    same gap noted for slice 14 (item 96), recorded here so the next slice that touches notifications
    closes it once for both.
101. **An auto-created draft job needs a job type chosen by the office, and appears when the work falls
    due.** `CraneSchedule.draftJobTypeId` is picked on the schedule form (required whenever the box is
    ticked). Which kind of work discharges which obligation is operational configuration, not a
    regulatory fact, so it is not mapped in code — the same position slice 12 took. The job is raised
    only on or after the due date, not at the 90/60/30 reminders: a NEW job in the list three months
    early is noise nobody schedules from. It is created with no actor (`createdById` null), with the
    job type's default priority, normal SLA targets and an audit entry naming the schedule it came
    from. An inactive or deleted job type logs a warning and raises nothing rather than falling back to
    a guess.

102. **Declining is not a status the status form may set.** The flow has five states but the form offers
    three moves (quoted, scheduled, rectified). `DECLINED_BY_CUSTOMER` is reachable only through
    `acknowledgeDecline`, which requires the customer's name, a date and an uploaded signature `File`.
    A decline is a liability record — "you told me the repair was needed and I said no" — so nothing
    can produce one without the three things that make it a record.
103. **A follow-up job is never P1.** The priority is derived from the finding's severity, and both
    CRITICAL and MAJOR map to P2. The inspection that recorded the finding already returned the crane to
    service; a P1 that follows it would page dispatch for a crane that is working. If a crane really is
    down, the office raises the priority by hand on the job. The form shows the derived priority and
    lets it be changed.
104. **The decline note lives in the audit trail, not a column.** `Finding` has no note field for the
    acknowledgement, and adding one for a free-text aside was not worth a migration. The note is written
    into the `UPDATE` audit entry's `after.note` and read back by the finding service, which is the same
    place every other status change is recorded.
105. **Reading a finding and moving one along are different capabilities.** Dispatcher holds
    `finding.followUpJob` (they raise the work); Technician and Admin hold `finding.write` (they move the
    finding and record a decline). The report page therefore gates the status and decline forms on
    `finding.write` and the follow-up form on `finding.followUpJob`, so nobody is shown an action that
    would answer 403.

106. **The built-out templates are version 2, not an edit of version 1.** `ReportTemplate` rows are
    immutable once reports cite them, so completing the load test and visual inspection against §6.3
    publishes `LOAD_TEST-v2` and `VISUAL_INSPECTION-v2`. A report signed under v1 keeps rendering as
    issued; the job type moves to v2 for new work.
107. **The seed moves a job type onto a new version only from an older version of the same template.**
    The definition declares its version, the row is created at `code = <key>-v<n>`, and the repoint runs
    only when the job type's current template shares the `<key>-v` prefix and carries a lower version.
    Anything else — a different template, a hand-made one — is an office decision and is left alone.
    Without the narrow rule, "publish v2" would silently overwrite where the office pointed a job type.
108. **The calibration check lives in the template, and compares against the register on the phone.**
    `TemplateSection.calibration` names which fields hold the test date, the instrument, its serial and
    its due date, so no code knows a column name of the load test. `calibrationWarnings` is a pure
    function of `(schema, answers, register)` and reads no clock — the test date on the form is what the
    instrument is judged at, not today. It **warns and never blocks** (the brief's words): an out-of-date
    instrument is a decision for the person on site and the reviewer, and a blocked form on a phone with
    no signal is a lost report (rule 11). The office page runs the same function without the register,
    because the reviewer is looking at a signed document and a register disagreement is a different
    question. A serial the register has never seen produces nothing: hired test weights are normal and
    the register cannot speak for them.

109. **A delivery order line points at the stock movement it is paperwork for.** `DeliveryOrderLine.movementId`
    is a unique, nullable link to the `StockMovement` of type `ISSUE` that took the part out, and raising the
    DO sets `StockMovement.deliveryOrderId` in the same transaction. The brief asks for a DO "generated from
    the parts already issued on a job … so stock and paperwork can't drift"; a line that merely *copied* the
    quantity would drift the moment either side changed, and two DOs could claim one part. Unique because one
    issued part belongs to one document; nullable only because the column was added to a table that may hold
    rows in an existing deployment.
110. **Partial delivery is one additive column, `DeliveryOrderLine.receivedQuantity`.** A running total,
    defaulting to 0, rather than a deliveries sub-table: the brief asks for partial delivery, not for a
    delivery history, and a receipt re-posted with a smaller number never un-delivers anything (the service
    takes the maximum). The DO's status is **derived** from those totals — `PARTIAL` while anything is short,
    `DELIVERED` once all are whole — so the form cannot post a status that disagrees with the quantities.
111. **Receiving a DO writes no stock movement.** The part left the store when it was issued; the DO records
    who took it, when and with what signature. `MovementType` has no delivery value, and a second `ISSUE` at
    receipt time would double-count the same part against the job. The ledger answers "how much left the
    store", the DO answers "who has it" — one row, two questions.
112. **The number is issued when the DO is raised, and the PDF is rendered on demand.** The person at the gate
    signs a numbered document, so `DO-YYYY-NNNN` comes from `nextDocumentNumber` at raise time, in the
    operating timezone like every other number. There is no stored copy: unlike an approved report, a DO gains
    received quantities and a signature *after* it is issued, so a frozen render would go stale. The renderer
    still pins `creationDate`/`modificationDate` to the issue time, so an unchanged DO re-downloads to the same
    bytes.
113. **Only `LOAN` lines can be returned, and the DO closes when they are all back.** A chargeable part has been
    sold to the customer and a warranty replacement is not ours to collect, so a return posted against either
    is refused by name. `RETURNED` is terminal: `receiveDeliveryOrder` refuses a closed DO, which is what stops
    a signature being added to a document that is finished.
114. **The receiver's signature is a `File` on the DO, not on the job.** It is evidence of that handover, so it
    uploads through the existing signed-URL route (`kind: 'DELIVERY_SIGNATURE'`) with
    `entity: 'DeliveryOrder'`/`entityId`, and `receiveDeliveryOrder` refuses a File that belongs to a different
    DO. The same `SignaturePad` the phone uses draws it; nothing about the upload path is new.

## Not assumed — deliberately left to you

- The **document number formats** (`JOB-2026-0001`, `RPT-2026-0001`, `DO-…`, `INV-…`) are placeholders. They live in
  `DocumentSequence` and are a one-line change each once you confirm the format you want.
- The **SLA minutes per priority** are seeded as plausible defaults only, because the real numbers are contractual.
- The **checklist item wording** for the four Phase 1 templates follows the components named in brief §6.3 and is
  marked for review by your technicians before it is used on a real job.
