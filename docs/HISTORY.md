# HISTORY.md — the build, slice by slice, and the original brief

`KICKOFF.md` is where a session starts; this is the record it used to carry. Read a section when a
trap bites, or when you need to know why something is the way it is. Every slice's fixed decisions are
in `docs/PLAN-SLICES.md`; the slice tables are `docs/PLAN.md` §7.2, §7.13 and §7.14.

## The last slices, as they landed

> **Slice 40 — the tablet shell (31 Oct 2026).** The first of the six tablet slices in
> `docs/PLAN-TABLET-APP.md`. Four things are worth knowing before the next one.
>
> 1. **`/m/login` is outside the `(tech)` layout on purpose.** That layout redirects unauthenticated
>    visitors to `/m/login`, so the login page inside it would be a redirect loop. It sits at
>    `src/app/m/login/page.tsx` — bare route, no group — and reuses the website's `LoginForm` and
>    `signInAction` with `next=/m/jobs`. Sign-out needed the same treatment: `signOutAction` redirects
>    to `/login`, which is outside the manifest's `/m/` scope and would leave the app for Chrome, so
>    `techSignOutAction` lands on `/m/login` instead. The office and portal keep the old one.
> 2. **The icon script cannot top-level `await`.** The project is CommonJS, and `tsx` refuses a
>    top-level await with `Top-level await is currently not supported with the "cjs" output format`.
>    `scripts/make-icons.ts` calls `void main()` instead. The three PNGs are committed; the script is
>    the record, not a build step.
> 3. **`clearCache()` clears Cache Storage as well as Dexie.** Clearing Dexie alone left the previous
>    technician's cached `/m/` documents and RSC payloads readable offline on a shared tablet. The
>    worker stays registered — the next sign-in still needs it.
> 4. **Sign-out with a pending report is two-step.** It flushes the outbox first (the signal may have
>    returned), then shows a full-width prompt naming the count; only "Delete and sign out" clears.
>    With nothing pending it is still one tap. The prompt is a panel above the bottom nav, not an
>    inline row in the header — at 390px the header has no room to be read in.
>
> The tablet spec (`tests/e2e/tech-tablet.spec.ts`, `--project=tablet` at 800×1280) asserts the grid
> tracks rather than hunting for a day of the seed that happens to hold two jobs: asserting card
> geometry made the test skip on seeds where the technician's work came one job a day.

> **The blank report form on a phone (31 Oct 2026).** Two faults, both only visible on a real device
> reaching the dev machine over the LAN, and one that survives into production.
>
> 1. **`crypto.randomUUID` does not exist outside a secure context.** Opening `http://192.168.x.x:3000`
>    is not one, so the call was `undefined()` in the report form's load effect, the promise rejected
>    with nobody catching it, and the screen sat on *"Reading the draft on this phone…"* for ever. All
>    client ids now go through `newId()` in `src/lib/id.ts`, which falls back to `crypto.getRandomValues`
>    (not gated) and still builds an RFC 4122 v4 id, because those ids are the server's retry key
>    (rule 11). The load effect also has a `.catch`, so a browser fault now says so and offers a reload
>    instead of hanging. **HTTPS is still the real answer** — plain HTTP also means no service worker, so
>    there is no offline mode at all. Never test the phone against an `http://` IP.
> 2. **Next 16 blocks cross-origin dev requests.** With no `allowedDevOrigins` entry, `/_next/*` from the
>    LAN host is refused, the HMR socket fails with `ERR_INVALID_HTTP_RESPONSE`, and React never hydrates
>    — so *every* client component (the form, the sync provider, Dexie) is dead on the device, though the
>    server-rendered HTML looks fine. Fixed without widening any origin list: the guard always allows the
>    hostname the server was **started** with, so `npm run dev:lan` (`scripts/dev-lan.ts`) finds the
>    machine's LAN address and starts `next dev --hostname <it>`. Verified on a real LAN origin: hydrates,
>    syncs, and opens the report form.

**All four phases are complete, and slice 39 brings the paper Service Report into the app.** Slices 0–39 are built;
Phase 1's acceptance path still passes untouched. **The slice write-ups are in `docs/PLAN-SLICES.md`**,
which holds §7.3–§7.12 (Phase 2), §7.13 slices 22–28 and §7.15–§7.25 (slices 29–39), each keeping the
section number the plan gave it. The slice tables stay in `docs/PLAN.md`: **§7.2 is the Phase 2 table,
§7.13 the Phase 3 table and §7.14 the Phase 4 table.** Slices 22 and 23 as built are §7.13.1, slice 24
§7.13.2, slice 25 §7.13.3, slice 26 §7.13.4, slice 27 §7.13.5 and slice 28 §7.13.6. Slices 29–38 as
built are §7.15–§7.24, in that order — slice 38, the notification inbox, is §7.24 — and slice 39, the
Service Report, is §7.25.

> **Slice 39 — the Service Report.** The paper is **two documents**, and the technician only fills the first. The
> **Servicing checklist form** is the per-crane `Report` they already submit: `JobType.isServiceReport` (seeded on PM)
> makes its form ask for a 1–5 condition grade and a short comment on every checklist line, held in
> `Report.data.grades` keyed by `ChecklistItem.code` with the line's wording snapshotted. Submission is refused while
> an answered line is ungraded. The **Service Report** is the second document and the one that gets the number: one
> row per job (`ServiceReport`, `@@unique([jobId])`) because it belongs to the visit rather than the crane. The office
> opens the job, presses generate, and gets prose built from the grades — worst first, a section per crane, a sentence
> per part — which they may reword but not restructure. `approveServiceReport` issues it as `SR2606001` (year, approval
> month, month's running number) through a `DocumentSequence` key `SR:2606`; a crane with no graded checklist blocks
> the issue. The per-crane form keeps its `RPT-…`. **Two additive migrations**,
> `20261031100000_service_report_grades` and `20261031110000_service_report_documents`, both applied on 31/10/2026. See
> `docs/PLAN.md` §7.25.

> **Slice 38 — the notification inbox.** `/inbox` is where the alerts have been going all along: every
> P1, due-service reminder and dispatch pack has written an `IN_APP` row since Phase 1, and nothing
> could read one back — the gap recorded at `ASSUMPTIONS.md` 96 and 100 and in PLAN §7.5 and §7.22.
> It is a read of those rows plus marking one read, behind a new `notification.read` capability and a
> `notificationReadWhere` that returns the caller's own id and nothing else. A failed
> email/SMS/WhatsApp delivery is listed with its reason beside the
> in-app copy that arrived. No table, no column, no migration and no new writer: `notify.ts` still
> writes every notification. The nav gains **Inbox** with an unread badge. See `docs/PLAN.md` §7.24.

> **Slice 37 — Xero push.** See below. **Its migration was NOT applied when the plan said it was** — a
> verification run found `Invoice.externalRef` missing from the database. It is now applied, and doing so
> exposed two faults in slice 37's own integration tests (both raised a second invoice on a job that
> issuing the first had moved out of `REVIEWED`); each now uses its own job. All four gates are green.

> **Slice 37 — Xero push.** Billed invoices leave `/invoices` for Xero through a second adapter seam
> beside slice 21's exporter: `AccountingPushDriver` in `src/server/accounting/push.ts`, resolved from
> `ACCOUNTING_DRIVER` (default `none`). A Xero custom connection takes the place of an OAuth flow —
> no callback, no refresh token. Only issued, partly paid and paid bills are sent; a bill is marked
> pushed (`Invoice.externalRef`) only once Xero returns its id, the write is guarded on NULL, and the
> request carries an idempotency key, so pressing twice never bills twice. A refused bill stays
> unpushed with its reason. **No live Xero call has been made** — no credentials exist in this
> repository, so the payload is pinned by unit tests and the first real push is the real verification.
> Migration `20261030200000_slice37_accounting_push` (additive, **applied 31/10/2026** — see the gates
> note above). See `docs/PLAN.md` §7.23.

> **Slice 36 — WhatsApp and SMS adapters.** A P1 alert now writes a fourth and fifth row beside the in-app and
> email ones: `SMS` and `WHATSAPP`, sent through `src/server/notify/message.ts`. Both drivers are the console one
> — `SMS_DRIVER=twilio` and `WHATSAPP_DRIVER=meta` are accepted and fall back to console with a warning, exactly
> as `EMAIL_DRIVER=smtp` already did — because the seam is the deliverable and nobody has bought a gateway. The
> phone body is one line and a link, not the notification text. A recipient with no `User.phone` gets no phone
> row, and the demo Admin and Dispatcher accounts are seeded with one. No migration: the enum values and the
> column have existed since Phase 1. See `docs/PLAN.md` §7.22.

> **Slice 36 is done and verified.** No migration was needed. `npm run verify` (453 unit tests, 3 new in
> `tests/unit/message-adapters.test.ts`), `npm run test:integration` (376, the P1 alert test in
> `tests/integration/tickets.test.ts` rewritten for the three channels), `npm run test:e2e` (45 passed, 2
> offline-only skipped) and `npm run build` all pass.

> **Slice 35 — route optimisation.** `/schedule` gains a **Round for the day** section under the board: the day's
> visits in the order to drive them, the kilometres from each stop to the next, and an estimated drive for the
> total. The order starts at whichever visit is scheduled first and improves from there by 2-opt; the distance is a
> great circle and the time assumes 30 km/h, both said on the screen. A read, not a write — nothing is rescheduled.
> A site with no coordinates is listed in an amber block rather than dropped. No migration: `Site.latitude` and
> `longitude` have existed since Phase 1 and were simply never read. See `docs/PLAN.md` §7.21.

> **Slice 35 is done and verified.** No migration was needed. `npm run verify` (450 unit tests, 9 new in
> `tests/unit/routes.test.ts`), `npm run test:integration` (376, 5 new in `tests/integration/routes.test.ts`),
> `npm run test:e2e` (45 passed, 2 offline-only skipped) and `npm run build` all pass.

> **Slice 34 is done and verified.** No migration was needed. `npm run verify` (441 unit tests, 1 new),
> `npm run test:integration` (371, 6 new in `tests/integration/calibrations.test.ts`), `npm run test:e2e`
> (45 passed, 2 offline-only skipped) and `npm run build` all pass.
**One slice per session: stop after the slice you were asked for; do not begin the next one unless
asked.**

> **Slice 32 — profitability reporting.** `/reports/profitability` puts revenue against material cost per
> customer, contract and job type. Revenue is the invoice subtotal ex-GST on issued, partly paid and
> paid invoices; cost is the `unitCost` on the `ISSUE` movements of the jobs behind them. **Labour is
> not costed** — nothing records an hourly rate — so the column is labelled Parts cost and the screen
> says a margin here is not gross profit. Behind `report.financial`. No migration. See `docs/PLAN.md`
> §7.18.

> **Slice 31 is done and verified.** Migration `20261030100000_slice31_portal_user` is applied (column
> and index confirmed in the database directly, not just from the migrate output). `npm run verify`
> (430 unit tests, 0 lint errors), `npm run test:integration` (355 tests, 31 files — up from 347 by
> the 8 portal tests), `npm run test:e2e` (45 passed, 2 offline-only skipped — the 7 portal tests are
> `tests/e2e/portal.spec.ts`) and `npm run build` all pass.

> **Slice 31 — the customer portal.** A `CUSTOMER` login is a `User` with a `customerId`
> (migration: one nullable FK). It signs in at `/portal` and sees its own jobs, cranes, certificates
> and issued reports, read-only. The scope filters were already written for this — every one had a
> `customerId` branch — so the portal calls the same `listCranes`, `listCertificates` and
> `issuedPdfUrl` the office calls, and the filter decides the rows. `CUSTOMER` holds four
> capabilities and no writes. `/admin/users` gained the customer picker. See `docs/PLAN.md` §7.17.

> **Slice 30 is done and verified.** No migration was needed. `npm run verify` (428 unit tests,
> 0 lint errors), `npm run test:integration` (347), `npm run test:e2e` (38 passed, 2 offline-only
> skipped) and `npm run build` all pass.

> **Slice 30 — SLA management and the renewal board.** `/admin/sla` edits the company-wide response
> and resolution minutes for all four priorities (seed-only until now), showing the built-in fallback
> where a priority has no row. `/customers` gains a **Contracts renewing** board above the list:
> every live contract overdue or renewing within 90 days, soonest first, each linking to the
> customer's contracts. Both ride on existing capability and scope — `sla.manage` to write targets,
> `customer.read` to read the board. See `docs/PLAN.md` §7.16.

> **Slice 29 is done and verified.** No migration was needed. `npm run verify` (423 unit tests),
> `npm run test:integration` (341), `npm run test:e2e` (38 passed) and `npm run build` all pass, and
> `tests/e2e/happy-path.spec.ts` passes **unmodified**.

> **Slice 29 — contracts on the customer page.** A customer's Contracts tab lists its contracts — kind,
> reference, term, renewal, included visits, covered cranes, scope notes — with add, edit and *Retire*
> behind `sla.manage`. The response and resolution minutes agreed per priority are written as
> `SlaPolicy` rows carrying the contract's id — the rows `createJob` already resolves — and `insertJob`
> now picks the newest live contract that actually covers the job's cranes. Retired, never deleted. See
> `docs/PLAN.md` §7.15.

> **Slice 28 is done and verified.** `20261028600000_slice28_job_on_hold_part` is applied.
> `npm run verify` (410 unit tests), `npm run test:integration` (335), `npm run test:e2e` (38 passed,
> 2 offline-only skipped) and `npm run build` all pass.

> **Slice 28 — back-orders linked to jobs on hold.** An on-hold job can now name the catalogue part it
> is waiting for, and its amber banner says which part, how many are still owed, from whom, and when
> — read from the open purchase order line rather than stored. The part's own page lists the jobs
> standing still for it. One nullable `Job.onHoldPartId`, cleared whenever the job leaves an awaiting-
> parts hold. See `docs/PLAN.md` §7.13.6.

> **Slice 27 is done and verified.** No migration was needed. `npm run verify` (406 unit tests),
> `npm run test:integration` (330), `npm run test:e2e` (38 passed, 2 offline-only skipped) and
> `npm run build` all pass, and `tests/e2e/happy-path.spec.ts` passes **unmodified**.

> **Slice 27 — the supplier book.** `/suppliers` lists every supplier with the parts that prefer it and
> the purchase orders raised from it — the price history is the orders themselves, not a second table.
> Add and edit are behind `supplier.write`; a supplier is retired, never deleted, and one a part still
> prefers cannot be retired until those parts move. The part form finally gained the
> **preferred supplier** select, which is what the slice-25 reorder grouping has always read and no
> screen could set. See `docs/PLAN.md` §7.13.5.

> **Slice 26 is done and verified.** No migration was needed. `npm run verify` (400 unit tests),
> `npm run test:integration` (325), `npm run test:e2e` (38 passed, 2 offline-only skipped) and
> `npm run build` all pass, and `tests/e2e/happy-path.spec.ts` passes **unmodified**.

> **Slice 26 — stock take.** `/stock-takes` opens a session over one location — blind by default — and
> snapshots what the books say for every line in scope. `/stock-takes/[id]` is the count, the variance
> review and the approval; approving posts one `ADJUST`/`WRITEOFF` per differing line through
> `adjustToCounted` with the count's reference on it, then turns the page into a read-only record.
> Counting is `stock.move` (a technician can count a van); writing the difference off is
> `stocktake.approve`. See `docs/PLAN.md` §7.13.4.

> **Slice 25 is done and verified.** No migration was needed. `npm run verify` (390 unit tests),
> `npm run test:integration` (317), `npm run test:e2e` (38 passed, 2 offline-only skipped) and
> `npm run build` all pass, and `tests/e2e/happy-path.spec.ts` passes **unmodified**.

> **Slice 25 — reorder alerts and purchase orders.** `/parts/reorder` groups everything below its
> reorder level by preferred supplier, with a suggested quantity (the store's reorder quantity, else
> the shortfall to the level), and raises a numbered `PO-YYYY-NNNN` from a group with the catalogue's
> cost snapshotted on each line. The open orders on the same screen take a receipt: one `RECEIVE` per
> line through `postMovement`, carrying `purchaseOrderId`, into one location, with an optional serial;
> the order's status is derived from what its lines have received. The seed now creates three
> suppliers and points the demo parts at them. See `docs/PLAN.md` §7.13.3.

> **Slice 24 is done and verified.** No migration was needed. `npm run verify` (373 unit tests),
> `npm run test:integration` (307), `npm run test:e2e` (38 passed, 2 offline-only skipped) and
> `npm run build` all pass, and `tests/e2e/happy-path.spec.ts` passes **unmodified**. Four gaps found
> in review afterwards — a count that dropped the serial, an issue that took the fullest bin instead
> of the serial's, a negative batch rendered as fact, and no browser coverage of `/parts` — are now
> closed, and `tests/e2e/parts.spec.ts` walks the parts screens.

> **Slice 24 — serial and batch traceability.** `/parts/[id]` now carries a **Serial and batch trace**
> above the movement list: every serial or batch the ledger has seen for the part, how much of it is
> still held and where, and every job it was issued to with that job's cranes. The trace is derived
> from the movements, so it cannot disagree with the shelf. A part flagged as traced can no longer be
> issued on a report without its serial, on the server and on the phone. See `docs/PLAN.md` §7.13.2.

> **Slice 23 is done and verified.** No migration was needed. `npm run verify` (369 unit tests),
> `npm run test:integration` (299), `npm run test:e2e` (36 passed, 2 offline-only skipped) and
> `npm run build` all pass, and `tests/e2e/happy-path.spec.ts` passes **unmodified**.

> **Slice 23 — stock locations and transfers.** `/parts/locations` manages the store, bins, vans and
> customer-site locations — what each holds, and a refusal to retire one that still holds stock — and
> the part page posts the `TRANSFER` the ledger always had a type for. It also fixed the receiving form,
> which had been offering only the locations the part already sat in. See `docs/PLAN.md` §7.13.1.

> **Slice 22 — the parts book and the stock ledger.** `/parts` is the catalogue — search by number,
> description or crane model, filter by brand, and a "below reorder" filter whose count is the number
> the store acts on; `/parts/[id]` shows on-hand, the stock in each location, the part's last twenty
> movements and the store's receipt / return / count form. **The slice's real work is underneath it:**
> `postMovement` in `src/server/inventory/stock.ts` is now the only function that writes a
> `StockMovement` *and* the `StockLevel` it moves, and the report path was re-pointed at it — until
> this slice the seed was the only code that ever moved an on-hand level, so every part issued on a
> report changed the ledger and not the shelf.

| Slice | State |
|---|---|
| 0 Foundations | done |
| 1 Auth, roles, users | done |
| 2 Customers, contacts, CSV import | done |
| 3 Sites, cranes, QR labels | done |
| 4 Job types, templates, tickets | done |
| 5 Ticket → job, lifecycle, SLA snapshots | done |
| 6 Scheduling & dispatch | done |
| 7 Technician PWA shell | done |
| 8 Offline report completion | done |
| 9 Approval, lock, PDF | done |
| 10 Job list, dashboard, audit viewer | done |
| 11 E2E happy paths + §13 demo dataset | done |
| 12 Schedules on the crane page | done |
| 13 Certificates & compliance dashboard | done |
| 14 Compliance rule admin, adoption, re-registration prompts | done |
| 15 Reminder engine in the daily cron | done |
| 16 Findings & one-click follow-up jobs | done |
| 17 Load test & visual inspection templates | done |
| 18 Delivery orders | done |
| 19 Quotes & variations | done |
| 20 Invoicing, GST & payments | done |
| 21 Accounting export & Phase 2 acceptance | done |
| 22 Parts book & stock ledger | done |
| 23 Locations & transfers | done |
| 24 Serial & batch traceability | done |
| 25 Reorder alerts & purchase orders | done |
| 26 Stock take | done |
| 27 Suppliers | done |
| 28 Back-orders & jobs on hold | done |
| 29 Contracts on the customer page | done |
| 30 SLA management & the renewal board | done |
| 31 The customer portal | done |
| 32 Profitability reporting | done |
| 33 Technician utilisation | done |
| 34 Equipment calibration tracking | done |
| 35 Route optimisation | done |
| 36 WhatsApp and SMS adapters | done |
| 37 Xero/QuickBooks integration | done |
| 38 The notification inbox | done |

What exists now, in the order it was built: sign-in and role scoping; the customer, site and crane
registers with CSV import and QR labels; fourteen seeded job types plus four versioned report
templates held as data; the ticket intake board with triage, P1 alerts and live SLA timers; the job
side of the same work — creation by hand or from a ticket, the enforced status machine with
`JobStatusHistory` and audit entries, on-hold reasons, and SLA deadlines snapshotted at creation; and
scheduling: a day/week board with drag-to-move, technician assignment with competency checks and
warn-then-override clashes, leave, the on-call roster with gap detection, resource booking, priority
bumps with a reason, and dispatch notifications built from the site, the crane history and the job
type's checklist; and the technician's phone — an installable PWA at `/m/jobs` with a job list and job
detail, an IndexedDB cache of the jobs, cranes, checklist items, parts and contacts, an offline
indicator with retry, an `/offline` fallback that opens the deep-linked job from the cache, and a
sign-out that wipes it; and the report form behind **Fill report** — template-driven sections and
tables, the checklist with measurements, photos compressed on the phone, parts issued as stock
movements, findings, both signatures (or a reason the customer did not sign), autosave into Dexie,
and an outbox flushed by a single idempotent sync endpoint with a pending badge and retry.
and the office side of a report — a queue of what the field has signed, approval that assigns a
document number and renders a numbered PDF with the signatures and photographs embedded, the report
locked once approved, a return-with-reason path, amendment copies linked to the report they correct,
the customer emailed on issue with a cron retry, and the crane page's timeline filled in; and the
office's own view of the work — a company-wide job list with every filter (search, status, priority,
SLA state, technician, kind of work, visit dates, sort) plus a six-week calendar, per-user saved
filters that replay the address bar, and a CSV export that runs the same query as the screen; a
dashboard of the morning's questions with each count linking to the list that answers it; and the
audit log as a screen — a cross-entity search, and a "who changed what" panel on jobs and cranes;
and, proving the whole of it, the acceptance path as a Playwright test — a P1 ticket through triage,
a job, the board and dispatch, an offline phone report with a photo and both signatures, the sync,
the office moving it on, approval and the numbered customer PDF — plus the demo estate that path runs
against.

**Phase 2, slice 12 — schedules.** The `CraneSchedule` rows the seed has always written are now a
working screen: the crane page carries its obligations (kind, interval, last done, next due, overdue
state, whether it came from a rule) with add, edit and "End" behind `schedule.manage`, all audited;
`/schedules` lists every obligation soonest-due-first with search, bucket and kind filters; the
dashboard's "Services / exams due" and a new "Schedules overdue" tile both read that same service and
link into the filtered list; and completing a job offers the schedules on that job's cranes as
checkboxes — ticking one records the work as done **on the job's completion date** and moves the
obligation on by its interval, in the same transaction as the status change. Overdue is computed from
the clock, never stored.

**Phase 2, slice 13 — certificates.** Every crane now has a certificate register: the crane page lists
the paper issued to it (kind, number, issuer, issue/expiry/next due, stated SWL, linked job, the scan
itself) with add, edit and "Archive" behind `certificate.write`, all audited; `/certificates` is the
compliance queue — expiring in 90/60/30 and already lapsed — with search and kind filters; and the
dashboard's "Certificates expiring" tile now counts the same service and links to the filtered list.
Uploads use the phone's signed-URL flow with `FileKind.CERTIFICATE` (PDF or image), and only an
Authorised Examiner's certificate of test and examination is labelled as statutory — our own reports
stay company inspections on the timeline.

**Phase 2, slice 14 — compliance rules.** `/admin/compliance` maintains the rulebook: one row per
kinds-of-crane × kind-of-obligation with its interval, whether an AE is required, the dates it applies
between, and the two fields that make it defensible — a required **source reference** and a required
**reviewed-on** date — under the standing notice copied verbatim from the brief. Rules are never
deleted: a replacement is entered and the old one given an end date, and a second rule overlapping the
same pair is refused by naming the one it clashes with. A schedule can be **adopted from a rule** on
the crane form, which copies the kind and the interval and keeps citing that rule even after it is
superseded; the rule — not the form — decides both, so a schedule cannot claim a basis it is not
running on. Changing a crane's owner of record, moving it to another site, or changing a customer's UEN
raises a **"re-registration may be required"** prompt on the crane, with a one-click "Mark as checked"
that records the check in the audit log. In force and overlapping are computed from the clock and the
dates, never stored.

**Phase 2, slice 15 — the reminder engine.** `/api/cron/daily` now evaluates every live crane schedule
at its own reminder offsets (90/60/30 by default, then once when overdue) and tells the Admin and
Dispatcher accounts by email and in-app row through the same fan-out a P1 uses. A schedule marked
"raise a draft job" also raises a NEW job in the kind of work the office chose for it, on the day it
falls due — with normal numbering, SLA targets and an audit entry naming the schedule. Each reminder is
claimed in `ReminderDispatch`, unique per schedule, threshold and due date, so a retried cron run
cannot email twice, and a schedule that is done and rolled forward can remind again.

**Phase 2, slice 16 — findings.** A defect a report raises now has a state and a place to live: the
report page moves a finding through quoted / scheduled / rectified, a refusal is a signed
acknowledgement from the customer rather than a tick-box, the crane page lists what is still open on
it, and one click raises a follow-up job pre-filled from the finding (kind, crane, description, and a
priority derived from severity but capped at P2) linked both ways. **Phase 2, slice 17 — the two
weight-bearing templates.** The load test and visual inspection reports are complete against brief
§6.3 — test load, radii with SWL and result at each, instruments with load cell ID and calibration due,
the pre- and post-test examination, deflection, AE attendance and outcome; structure, safety devices,
markings and load charts, wire rope and hook, operator controls, findings by severity and an overall
condition rating. The load test now checks each instrument against the equipment register **at the test
date** and says so in amber when one had lapsed — on the phone under the instruments table and again
on the office report page. It warns and never blocks: a blocked form on a phone with no signal is a lost
report. **Phase 2, slice 18 — delivery orders.** The paper that travels with the parts is built from the
`ISSUE` movements already recorded against the job, so the DO and the stock ledger cannot disagree; it is
numbered, receipted with a signature and a running quantity per line (the status derived from those), loan
kit is chased back, and it downloads as a PDF. **Phase 2, slice 19 — quotes.** A job raises a numbered
`QTE-YYYY-NNNN` quote with quantity/unit price lines, a variation flag and GST computed from them; sending,
accepting and declining are recorded, expiry is derived from the date, accepting moves the job
`QUOTED → APPROVED` through the status machine, and the quote downloads as a PDF. Completing a follow-up job
now marks its finding rectified. **Phase 2, slice 20 — invoicing and payments.** A reviewed job raises a
numbered `INV-YYYY-NNNN` tax invoice whose lines are prefilled from the parts issued on it (read from the
stock ledger, so the bill and the delivery order describe the same parts) plus labour the office types; GST is
computed from the lines at the rate in force when the invoice is issued, and payments recorded against it drive
`PART_PAID` and `PAID` from the money rather than from a form. Issuing moves the job to `INVOICED`; the invoice
downloads as a PDF, and `/invoices` is the book of what is owed and overdue.

**Phase 2, slice 21 — the accounting export and the acceptance path.** Issued, partly paid and paid invoices
leave the app as CSV — `GET /invoices/export`, or `?what=payments` for the payment file — with `YYYY-MM-DD`
dates, the amounts and GST rate stored on each invoice rather than recomputed, and the invoice book's own
filters applied to the file. `AccountingExporter` is the seam a Xero/QuickBooks driver renders later.
`tests/e2e/phase2.spec.ts` walks the whole of Phase 2 in one browser run, starting with a compliance rule
added on `/admin/compliance`, adopted on a crane, and ending with the invoice exported.

**Every slice in the plan is built.** Phase 3 is complete (§7.13); Phase 4's slice table is §7.14,
with slice 29 as built in §7.15, slice 30 in §7.16, slice 31 (the customer portal) in §7.17,
slice 32 (profitability) in §7.18, slice 33 (utilisation) in §7.19, slice 34 (calibration) in
§7.20, slice 35 (route optimisation) in §7.21, slice 36 (WhatsApp/SMS) in §7.22 and slice 37
(Xero push) in §7.23. Phase 4's acceptance is not written as a browser test the way Phase 1's and
Phase 2's are — the portal, the reports and the push are proven by their integration suites.

Decisions that depart from the brief as written, all already in the code and in `docs/PLAN.md`:

- **Hosting is Vercel**, which replaced three of the brief's defaults: there is no pg-boss worker
  (Vercel Cron calls `/api/cron/daily` with `CRON_SECRET`), PDFs will use `@react-pdf/renderer`
  rather than Playwright/Chromium, and uploads go to Supabase Storage rather than local disk or S3.
- **The database is hosted Supabase** (region `ap-southeast-1`, project `vbyisdfntzfgbjubtily`).
  `docker-compose.yml` is still in the repository but unused.
- The brief's open questions (§15) are answered or assumed in `docs/ASSUMPTIONS.md`.

**The gate for every slice** — all four must pass before a commit:

```
npm run verify             # typecheck, lint, unit tests
npm run test:integration   # against the real database
npm run test:e2e           # Playwright, office and technician projects
npm run build              # production build
```

**Local notes.** Node is installed but not on `PATH` in this shell, so prefix commands with
`export PATH="/c/Program Files/nodejs:$PATH" &&`. Git identity is set for this repository only. Each
database round trip is a few tens of milliseconds (Singapore, same region as the office), so
round-trip count in hot paths matters less than it did against the old Seoul project, and
`test:e2e` runs a single worker for that reason. The service worker is off under `npm run dev` on
purpose, so offline behaviour — including the offline half of the technician e2e test — is checked
against `npm run build && npm start`.

**Traps that have already bitten, and will again.**

- ~~Never run `npm run build` while `npm run dev` is up.~~ **Fixed by the framework.** They used to
  share `.next`, and a build pruned the tree the dev server was serving from — `Invariant: no direct
  app page entry found for /login`, then 500s on every dev route. Next 16 separates them natively
  (dev writes `.next/dev`), so the home-grown `distDir` switch in `next.config.ts` is gone. A build
  no longer needs the server stopped.
- **Dev chunks are served from unhashed URLs, so a browser can outlive an upgrade.** `app-pages-internals.js`
  carries no content hash and no version query (only `main-app.js` gets `?v=`), so a tab holding the
  pre-upgrade build keeps running Next 15's `OuterLayoutRouter` against a Next 16 server and dies with
  `Cannot read properties of undefined (reading 'parallelRoutes')` — an error that exists nowhere in
  Next 16. It is the browser, not the code: clear site data and unregister any service worker (a
  `npm start` run leaves one registered, and `npm run dev` disables *registering* but never
  *unregisters*). Delete `.next-dev/` too — it is the dead pre-upgrade `distDir` output, and nothing
  in the repo should reference it any more.
- **Only one `next dev` runs at a time.** Next 16 holds a lock. A second start refuses and prints the
  running PID and its port; the first stays on 3000 and the refused one offers 3001. `npm run
  dev:stop` the old one before starting again, or you end up hunting a server on 3001.
- **`npm run dev:stop`** stops whatever is on port 3000 (or `npm run dev:stop -- 3001`). Use it when a
  previous session left a server behind. It exists because `taskkill` and `rm -rf .next` are denied by
  the permission classifier — this script is the sanctioned path, so do not reach for those.
- A running `npm run dev` still locks `node_modules/.prisma/client/query_engine-windows.dll.node`, so
  `npx prisma generate` fails with `EPERM`. `npm run dev:stop` first, then generate.
- `npx prisma migrate deploy` against the hosted database is refused by the auto-mode permission
  classifier as "Modify Shared Resources". Ask the user to approve it; it is a single additive
  `ALTER TABLE` and is safe to apply.
- A running dev server keeps serving the Prisma engine it started with, so after a schema change it
  must be restarted even if the client on disk was regenerated. `npm run dev:stop` then `npm run dev`.

**Slice 12's two deliberate deviations** from `docs/PLAN.md` §7.3, both written up there: the "mark
done" checkboxes live in the existing job-transition form rather than a separate action, and
`markSchedulesDone` asks for `schedule.manage` even though the caller is already transitioning the
job. **One known gap**, recorded so it is not forgotten: there is no "show ended schedules" view —
archiving is a soft delete by design (`docs/ASSUMPTIONS.md` 84) but the only place an ended
obligation is visible today is the audit log. Adding it to `/schedules` is a filter, not new
architecture, if the office asks.

#### The Phase 1 slices

Copied from `docs/PLAN.md` §6, which is the canonical copy — if the two ever disagree, that one wins.

| # | Slice | Delivers | Brief § |
|---|---|---|---|
| **0** | **Foundations** | Next.js + TS + Tailwind + shadcn scaffold; Docker Compose Postgres; Prisma init with the §3 schema for Phase 1 models; all npm scripts; `/api/health`; structured logging + error boundary; `Setting` table and `DocumentSequence`; `audit()` service; Vitest + Playwright wired; `.env.example` | §12.1 |
| **1** | **Auth, roles, users** | Auth.js credentials login; password hashing; `permissions.ts` capability map + scope helpers; rate limiting on login; Admin user management; **tests proving technician isolation and cross-customer isolation** | §12.2, §12.9 |
| **2** | **Customers & contacts** | CRUD, search, status filter, CSV import, audit-logged; empty/loading/error states | §12.3 |
| **3** | **Sites & cranes** | CRUD, search, CSV import, QR value + printable label, crane detail page shell (timeline empty until slice 9), restriction flag with reason | §12.3 |
| **4** | **Job types, templates, tickets** | Seed 14 job types; seed checklist + report templates for servicing, breakdown, visual inspection, load test; ticket CRUD, triage, priority, SLA timer display | §12.4 |
| **5** | **Ticket → Job, lifecycle, SLA** | Ticket spawns 1..n jobs, job covers 1..n cranes; status machine + `JobStatusHistory`; `ON_HOLD` reason required (DB check + service); `SlaPolicy` → SLA due timestamps + live timer/breach state; P1 alert to dispatchers (in-app + email adapter) | §12.4, §4.3 |
| **6** | **Scheduling & dispatch** | Schedule board (day/week, dnd-kit, conflict warnings); technician assignment with competency warnings + configurable block; leave/unavailability; on-call roster; resource booking + conflict flags; priority bump with reason (audited); dispatch notification with site contact, access notes, crane history, checklist | §12.5 |
| **7** | **Technician PWA shell** | Installable PWA (Serwist); Dexie cache of upcoming jobs, crane histories, templates, parts, contacts; My Jobs; Job detail; offline indicator | §12.6 |
| **8** | **Offline report completion** | Checklist form with measurements; photos with client-side compression; parts used; findings; technician + customer signatures with declined-with-reason; autosave every few seconds; outbox sync queue with pending badge, retry, idempotency via `SyncReceipt`, conflicts logged | §12.6, §10 |
| **9** | **Approval, lock, PDF** | Report approval flow; locked reports + amendment with reason linked to original; document numbering; `@react-pdf/renderer` PDF with embedded signatures and photos; email to customer on close with copy stored against job and crane; crane timeline now populated | §12.7 |
| **10** | **Job list, dashboard, audit views** | Company-wide job list with every filter + saved filters + CSV export + calendar view; office dashboard; audit log viewer and "who changed what" on key records | §12.8, §12.9 |
| **11** | **E2E happy paths** | Playwright: (a) P1 breakdown ticket → assign nearest qualified technician → offline report with photos and both signatures → sync → approve → customer PDF; (b) offline report completion and later sync | §12.10 |

Phase 1 acceptance is slice 11's path (a): a P1 breakdown ticket → assign the nearest qualified
technician → offline report with photos and both signatures → sync → approve → customer PDF.

**Note on the working tree — a performance pass rides along with slice 12.** The tree already
carried, uncommitted and verified green before slice 12 started: `connection_limit=5` on the pooled
URL in `.env.example`, `.env.*` added to `.gitignore`, React `cache()` around `getCrane` and
`metadataForJob` so `generateMetadata` and the page share one read, `Promise.all` batching on the job,
report and ticket pages, and `loading.tsx` for the office and technician route groups. It is not part
of slice 12 and it is not separable any more without splitting a commit by hand — it was reviewed and
passed the same gates. Say so in the commit message so a later `git log` does not read it as
schedules work.

---

## Slice 11 is done — Phase 1 is complete; Phase 2 is next, when asked

**Goal of slice 11:** the end-to-end happy path (brief §12.10) and the §13 demo estate. The
acceptance path lives in `tests/e2e/happy-path.spec.ts`: a P1 breakdown ticket → triage → a job →
the status machine → a visit → a qualified technician → dispatch → an offline report on the phone
with a photo and both signatures → sync → the office moving the job on → approval → a numbered PDF.
It builds every record it uses, and runs in the desktop project only (the phone half, at 390px and
offline, is `report.spec.ts`).

The §13 dataset is `seedDemoBook()` in `prisma/seed.ts`: 8 customers, 26 cranes, 30 closed jobs (10
with issued reports — only four job types have templates), crane schedules staggered from overdue to
distant, 2 open P1 tickets, and 40 parts with 9 below reorder level. It is additive and idempotent,
and gated on the same condition as the demo accounts.

Decisions slice 11 settled (`docs/ASSUMPTIONS.md` items 81–83): "nearest qualified technician" is the
first technician holding the job type's required competency, because no technician location exists to
measure distance with; the demo book is keyed on natural keys so re-running the seed adds nothing
twice, and it never lands in a real register; and the seeded historical reports carry a document
number but no stored PDF, because the seed runs under `tsx`, which cannot load
`@react-pdf/renderer`.

**Known traps that have cost time, still true.**

- The e2e suite runs against `npm run dev`, so editing a source file while a run is in flight
  hot-reloads the server under a test that is mid-page-load. Freeze the tree while it runs.
- A route a spec visits for the first time in a run pays Next's on-demand compile plus a database
  round trip: measured first visits ran 15–43s while the database was in Seoul, so the suite-wide
  `expect` is 30s and the heaviest routes carry their own 60s. If a spec fails on a *page that rendered*, read the dev
  server's log before widening anything — an earlier run hid a real dropped-flush bug behind what
  looked like a timeout.
- `tests/e2e/report.spec.ts` deletes and recreates the report on one seeded breakdown job (Ahmad's).
  Any new e2e that needs a report must build its own customer, crane and job, as every later spec
  does.
- Sign-in is throttled per IP (30 attempts per 15 minutes, and success does not reset it). A full run
  now signs in more often than that inside one window, so `tests/e2e/fixtures.ts` clears the throttle
  table before each test; every spec imports `test`/`expect` from there. A spec that imports
  `@playwright/test` directly will be the next one to fail on the throttle.
- A spec that signs out then signs in again must `await page.waitForURL(/\/login/)` after the click.
  Navigating to `/login` straight away cancels the sign-out request, and the page then finds the
  session that was never cleared and redirects to the dashboard — where there is no `Email` label, so
  the test times out on a page that is working correctly.

---

## Slice 21 is done — Phase 2 complete, Phase 3 is next

**Read `docs/PLAN.md` §7 first; it is the canonical copy and is not repeated here.** §7.2 is the
Phase 2 slice table, §7.4 is slice 13 as built, §7.5 is slice 14 as built, §7.6 is slice 15 as built,
§7.7 is slice 16 as built, §7.8 is slice 17 as built, §7.9 is slice 18 as built, §7.10 is slice 19 as
built, §7.11 is slice 20 as built, §7.12 is slice 21 as built, and §7.13 is the Phase 3–4 outline. Slice 19's and
slice 20's accounts below are kept for the record.

**What slice 20 delivered.** `src/server/invoices/invoices.ts` is the one read/write path, scoped through the
new `invoiceReadWhere` and gated on `invoice.read`/`invoice.write` — finance and admin only, so a dispatcher who
raised the quote cannot raise the bill that follows it. `createInvoice` re-reads the job under `jobReadWhere`,
refuses anything not `REVIEWED` by naming its status, allocates `INV-YYYY-NNNN` with
`nextDocumentNumber(tx, 'INVOICE')`, computes the totals from the lines and the current rate, and audits — one
transaction. `jobCosting` reads the job's `ISSUE` movements at sell price as the raise form's prefill: the same
ledger rows the delivery order prints, so the bill and the paperwork describe the same parts. `transitionInvoice`
issues a draft — stamping the issue date, the due date from the customer's payment terms, and **re-snapshotting
the GST rate with the amounts it produces**, because a bill stating 10% beside an amount computed at 9% is worse
than either rate being wrong — and moves the job `REVIEWED → INVOICED` with its history row and stamp in the same
transaction; it writes that move itself rather than calling `transitionJob`, which needs a `job.transition`
finance does not hold. `recordPayment` works in integer cents, refuses an overpayment by naming what is still
owed, and derives `PART_PAID`/`PAID` from the sum of the payments rather than from a form field. The money
arithmetic was **moved** to `src/lib/validation/money.ts` and the quote re-pointed at it, so an invoice and the
quote before it cannot price the same lines differently. `src/server/documents/invoice.ts` is the fixed-layout
"Tax invoice" PDF, with Paid and Balance-due rows once money is in, downloaded through `GET /api/invoices/[id]/pdf`.
The office gains `/invoices` (counts, q/status filters, outstanding total, overdue badges) and `/invoices/[id]`
(charges, totals, payments, what happens next, the payment form), the job page gains an Invoices section with a
raise form prefilled from the job's parts, the nav gains **Invoices**, and the audit viewer labels and links one.
The dashboard's "awaiting invoicing" hint now says where the work is done.

**Migration:** none needed. `Invoice`, `InvoiceLine`, `Payment`, both enums and the `INV` sequence key were
designed in Phase 1 and already applied — `npx prisma migrate status` reports nothing pending.

**The gate it passed:** `npm run verify` (342 unit tests, 18 new in `tests/unit/invoices.test.ts`,
`tests/unit/invoice-render.test.ts` and `tests/unit/permissions.test.ts`), `npm run test:integration` (279, 17 new
in `tests/integration/invoices.test.ts`), `npm run test:e2e` (35 passed, 2 skipped as offline-only) and
`npm run build`. `tests/e2e/happy-path.spec.ts` passes unmodified; no e2e walks the invoices screen, so the
integration suite is what proves it.

**Known limits.** There is no credit note: an invoice with money against it cannot be voided and an overpayment
cannot be taken — both are refused with the reason said out loud. The customer page has no Invoices tab; the job
page and `/invoices` are the two screens. A payment records its method and reference but has no proof-of-payment
upload.

**What slice 19 delivered.** `src/server/quotes/quotes.ts` is the one read/write path, scoped through the new
`quoteReadWhere` and gated on a new `quote.read` capability (dispatch and finance read; dispatch and admin
write). `createQuote` re-reads the job under `jobReadWhere`, takes the current `gstRate`, allocates
`QTE-YYYY-NNNN` with `nextDocumentNumber(tx, 'QUOTE')`, writes the lines and the computed totals, and audits —
one transaction. `src/lib/validation/quotes.ts` holds the pure rules: the transition table, the derived expiry
(`effectiveQuoteStatus`, day keys in the operating timezone — `EXPIRED` is never stored), and `quoteTotals`,
which rounds each line to the cent, sums the subtotal and applies GST once to it. `updateQuote` refuses a quote
that is no longer a draft and reprices on save. `transitionQuote` refuses an expired quote by naming the date,
refuses sending one whose validity has already lapsed, and on send/accept calls `transitionJob` **inside the
same transaction** — `TRIAGED → QUOTED`, then `QUOTED → APPROVED` — so the job history entry and the quote audit
are one event. `src/server/documents/quote.ts` is the fixed-layout renderer (lines, a Variation tag, totals, a
"not a tax invoice" notice) downloaded through `GET /api/quotes/[id]/pdf`. The office gains `/quotes` (per-status
counts, q/status filters) and `/quotes/[id]`, and the job page a Quotes section whose raise form prefills from
the job's open findings. **The slice-16 carry-over is wired:** `transitionJob` to `COMPLETED` writes the job's
`SCHEDULED` follow-up findings to `RECTIFIED` with one Finding audit row each, in the same transaction, because
a dispatcher holds no `finding.write`.

**Migration:** `20261028500000_slice19_quotes` adds `Quote.gstRate DECIMAL(5,4) NOT NULL DEFAULT 0`, so a reprint
shows the rate the quote was priced at. Additive only, and applied.

**The gate it passed:** `npm run verify` (325 unit tests, 17 new in `tests/unit/quotes.test.ts`,
`tests/unit/quote-render.test.ts` and `tests/unit/permissions.test.ts`), `npm run test:integration` (262, 11 new:
10 in `tests/integration/quotes.test.ts` and the rectification case in `findings.test.ts`), `npm run test:e2e`
(35 passed, 2 skipped as offline-only) and `npm run build`. `tests/e2e/happy-path.spec.ts` passes unmodified; no
e2e walks the quotes screen, so the integration suite is what proves it.

**Known limits.** A quote is always raised from a job — there is no customer-level quote screen (ASSUMPTIONS
116). Quoting a finding prefills a line and leaves the finding's status alone (118). Declining leaves the job at
`QUOTED`; no requirement names a state for it. Expiry is derived, so a lapsed quote is visible in the list but
nothing emails the customer about it.

**What slice 18 delivered.** (Previous session's slice, kept for the record.) `src/server/delivery-orders/delivery-orders.ts` is the one read/write path.
The parts on a DO are the `ISSUE` movements already recorded against the job: `issuedPartsForJob` lists the
ones no DO has claimed, and `createDeliveryOrder` re-reads every named movement under the job before it
writes anything, refusing a foreign, non-issue or already-claimed one **by part number**. Raising it
allocates `DO-YYYY-NNNN`, snapshots the line descriptions and serials, writes
`StockMovement.deliveryOrderId` for each movement and audits — all in one transaction, so the ledger and
the paperwork are the same rows. `receiveDeliveryOrder` records the person, their signature (uploaded
through the existing signed-URL route under a new `DELIVERY_SIGNATURE` kind) and the running received
quantity per line; the status is derived (`deliveryStatusFor`) so `PARTIAL` cannot disagree with the
numbers. `returnDeliveryOrder` books loan kit back and moves the DO to `RETURNED` once every loan line is
whole. `src/server/documents/delivery-order.ts` is a fixed-layout PDF rendered **on demand** by
`GET /api/delivery-orders/[id]/pdf`, with the document dates pinned so an unchanged DO downloads to the
same bytes. The job page has the Delivery orders section — each DO with its lines, terms and PDF link,
then the raise, receipt and return forms — gated on the new `deliveryorder.write` capability (dispatcher
and storekeeper; the technician issues the parts but signs for nothing).

**Migration:** `20261028400000_slice18_delivery_orders` adds `DeliveryOrderLine.movementId` (unique index +
FK) and `receivedQuantity` (default 0). Additive only, and applied.

**The gate it passed:** `npm run verify` (308 unit tests, 20 new in
`tests/unit/delivery-orders.test.ts`, `tests/unit/delivery-order-render.test.ts` and
`tests/unit/permissions.test.ts`), `npm run test:integration` (251, 13 new in
`tests/integration/delivery-orders.test.ts`), `npm run test:e2e` and `npm run build`.
`tests/e2e/happy-path.spec.ts` passes unmodified; no e2e walks the delivery screen, so the integration
suite is what proves it.

**Known limits.** A DO raised on a job with no stock movements has nothing to offer and says so. There
is no screen for a customer-level DO without a job. Receiving writes no stock movement — the issue already
happened, and a second one would double-count the part (ASSUMPTIONS 111).

**What slice 17 delivered.** (Previous session's slice, kept for the record.) `LOAD_TEST` and `VISUAL_INSPECTION` are published at **version 2** in
`src/server/templates/definitions.ts`; the seed creates `LOAD_TEST-v2` / `VISUAL_INSPECTION-v2` rows and
repoints the job type at them, but only when the job type still points at an *older version of the same
template* — a job type the office pointed elsewhere is left alone. `TemplateSection.calibration` in
`src/lib/templates/schema.ts` names the test-date field, the instrument, its serial and its due-date
column, so no code knows a column name of the load test; `calibrationWarnings(template, answers,
register)` is a pure function that reads no clock and returns amber messages. The register reaches the
phone through the existing single sync call (`SyncBundle.calibrationResources`, scoped by
`resourceReadWhere` to instruments booked on the technician's own jobs) and one new Dexie table
(`version(3)`). The report form shows the warnings under the instruments table; the office report page
runs the same function on the dates as recorded. `tests/unit/templates.test.ts` pins both v2 shapes and
six `calibrationWarnings` cases; `tests/integration/tech.test.ts` proves the bundle carries only the
technician's own instruments.

**The gate it passed:** `npm run verify` (288 unit tests, 9 new), `npm run test:integration` (12 new
in `tests/integration/tech.test.ts`), `npm run test:e2e` (35 passed, 2 skipped as offline-only) and
`npm run build`. `happy-path.spec.ts` passes unmodified — it drives BREAKDOWN, which is still v1, as
does `approval.spec.ts` with PM.

**Known limit:** the register only reaches the phone for instruments booked on that technician's jobs;
an unbooked one falls back to the due date typed on the form, which is the honest source anyway.

**What slice 16 delivered.** (Previous session's slice, kept for the record.) `src/server/findings/findings.ts` is the one read/write path: reads
scoped by `findingReadWhere` (the finding follows its report), `updateFindingStatus` for the three
office moves, `acknowledgeDecline` for a signed refusal, and `createFollowUpJob`, which calls
`createJob` **inside its own transaction** so the job, the finding's `followUpJobId`, its move to
`SCHEDULED` and `Job.parentJobId` commit together. `src/lib/validation/findings.ts` holds the flow as
pure data — the transition table, `canMoveFinding`, `isFindingOpen`, `priorityForSeverity` and the
three Zod schemas — and the status form deliberately cannot post a decline, which only the signed
acknowledgement produces. The report page has the Findings section with the three forms gated by the
capability each action checks (`finding.write` for status and decline, `finding.followUpJob` for the
job), the crane page has "Open findings", the job page has "Follow-ups", and the audit viewer labels a
finding with its component and links to its report. `FINDING_SIGNATURE` uploads go through the
existing signed-URL path. No migration.

**The gate it passed:** `npm run verify` (279 unit tests, 12 new), `npm run test:integration`
(10 new in `tests/integration/findings.test.ts`), `npm run test:e2e` and `npm run build`.
`happy-path.spec.ts` passes unmodified.

**Known limits carried forward.** ~~A follow-up job completing does not move its finding to rectified~~ —
closed by slice 19: `transitionJob` to `COMPLETED` now rectifies the job's `SCHEDULED` follow-up findings.
The decline note lives in the audit trail rather than a column (`ASSUMPTIONS.md` 104). The three `/admin/compliance`
carry-overs from §7.5 are still queued and slice 17 does not touch that screen.

**What slice 15 delivered.** `src/server/reminders/reminders.ts` is the scan: `runScheduleReminders`
for the cron, `remindForSchedule` for one row (which is what the integration suite drives),
`reminderOffsetFor` as the pure threshold rule, and the `ReminderDispatch` claim that makes a re-run a
no-op (`INSERT … ON CONFLICT DO NOTHING`, because a unique-violation exception aborts the surrounding
transaction). `notifyOfficeOfReminder` reuses the P1 fan-out through a shared `fanOut`;
`createSystemJob` in the jobs service gives a cron job the same numbering, SLA snapshot and status
history as one raised by a person, with no actor. `CraneSchedule.draftJobTypeId` is chosen on the
schedule form and required whenever "raise a draft job" is ticked. The cron route reports what it did
in its JSON and its log line.

**The gate it passed:** `npm run verify` (267 unit tests, 6 new), `npm run test:integration` (227
tests, 6 new in `tests/integration/reminders.test.ts`), `npm run test:e2e` (35 passed, 2 skipped as
offline-only) and `npm run build`. `happy-path.spec.ts` passes unmodified.

**Known limit carried forward:** the fan-out writes in-app `Notification` rows but there is still no
inbox screen, so email is the channel that reaches anybody (`ASSUMPTIONS.md` 96 and 100). An inbox
would serve P1 alerts and reminders together, and is worth doing before notifications multiply.

**What slice 14 delivered.** `src/server/compliance/rules.ts` is the one path for the rulebook — list
(admin), `rulesForCraneType` (the in-force rules a schedule may adopt), create, update, the overlap
check that refuses a second rule in force for the same pair and names the one it clashes with, and the
`adoptedCount` that says how many schedules cite a rule; `isRuleInForce` is a db-free function in
`src/lib/validation/compliance.ts` so "in force today" has one definition. `/admin/compliance` is the
admin screen behind `compliancerule.manage`: the standing notice verbatim, the rules with their source
reference and reviewed-on date, inline editing, and the help text that says how to replace a rule
(give the old one an end date first). The crane form's **Based on a rule** select adopts a rule —
kind and interval come from the rule, not the form, and the citation survives that rule being
superseded. `updateCrane` and the customer UEN change raise a re-registration prompt on the crane,
shown as an amber banner with "Mark as checked", and audited.

**The gate it passed:** `npm run verify` (261 unit tests, 9 new), `npm run test:integration` (221
tests, 9 new in `tests/integration/compliance.test.ts`), `npm run test:e2e` (35 passed, 2 skipped as
offline-only) and `npm run build`. `happy-path.spec.ts` passes unmodified.

**Queued while building it — take the first one when the slice in flight touches the same screen**
(carried in `docs/PLAN.md` §7.5 so both files agree):

1. **A Playwright path for `/admin/compliance`** — add a rule → adopt it on a crane → change the
   owner → see the prompt → mark it checked. The screen is proven by services and integration tests
   but no browser test walks it. Slice 17 edits the report form and template definitions, not a rule
   screen, so take this with whichever slice next touches `/admin/compliance`. Build
   its own customer and crane, as every post-slice-11 spec does.
2. **A state filter on the rules table** (in force / ended), so a rulebook with superseded rules does
   not read as dead rows — the same gap the ended-schedules filter has (§7.3).
3. **Re-pointing schedules that cite a superseded rule**, only if the office asks: an explicit action
   that lists the schedules first. Ending a rule deliberately does not rewrite them (§7.5 known
   limit).

**What slice 13 delivered.** `src/server/certificates/certificates.ts` is the one read/write path for
the register (list, per-crane, counts, create, update, archive, `certificateDueDate`,
`certificateDueLabel`); `certificateReadWhere` in `scope.ts` follows the crane so a technician sees
only certificates on cranes they are assigned work at; `src/lib/validation/certificates.ts` holds the
types, labels, date rules and upload schema; the crane page has a Certificates section with add, edit
and soft-delete Archive behind `certificate.write`; `/certificates` is the compliance queue with
q/due/kind filters and a count line; the dashboard's "Certificates expiring" tile counts the same
service (the 30-day window) and links to the filtered list; and `/api/files/upload-url` now accepts a
`CERTIFICATE` upload (PDF or image, `FileKind.CERTIFICATE`, owned by the crane) through the same signed
URL the phone uses. Only `STATUTORY_TEST_EXAMINATION` is labelled "AE statutory certificate"; every
other type is a supporting document, and both screens say our reports are company inspections, not
certificates (rule 3). No migration — the model, `deletedAt` and the file kind already existed.

**The gate it passed:** `npm run verify` (252 unit tests), `npm run test:integration` (212 tests, 7
new in `certificates.test.ts`), `npm run test:e2e` and `npm run build`. `happy-path.spec.ts` passes
unmodified.

**Slice 20 — invoicing, GST and payments — is done.** `docs/PLAN.md` §7.11 records it as built and §7.2 row 20
is marked off. No migration: the models and the `INV` sequence key were already applied. One decision changed
while building it: the job move on issue is written by the invoice service rather than through `transitionJob`,
because finance — the only role holding `invoice.write` — does not hold `job.transition` and granting it would let
finance move any job to any state (`ASSUMPTIONS.md` 129). An integration test caught a second: issuing must
recompute the amounts as well as the rate, or the PDF can state 10% beside a 9% charge (assumption 123).

**Before continuing:** `npx prisma migrate status` should report nothing pending — this slice added none.

**Slice 21 — accounting CSV export and the Phase 2 acceptance path — is done.** `docs/PLAN.md` §7.12 records it as
built and §7.2 row 21 is marked off. `src/server/accounting/accounting.ts` holds `AccountingExporter` (the seam a
Xero or QuickBooks adapter slots behind) and one CSV implementation; `/invoices/export?what=invoices|payments`
streams it through the existing `﻿`/CRLF attachment convention. Amounts come from the issued ledger, not from
today's settings, and the export is deliberately not audited — `AuditAction` has no EXPORT (assumptions 130–134).
`tests/e2e/phase2.spec.ts` walks Phase 2 end to end in one test: compliance rule → adoption → re-registration
prompt → certificate → PM job completed → schedule rolls forward → cron reminds → finding → follow-up job → quote →
invoice → payment.

The acceptance path earned its keep: it found two product bugs, both the same shape. The schedule form and the
certificate form on a crane's own page rendered no `craneId` — the dropdown only exists on `/schedules` — so every
submission from a crane page failed validation. Each now posts a hidden `craneId`.

**Before continuing:** `npx prisma migrate status` should report nothing pending — this slice added none.

**Phase 2 is complete; Phase 3 has started.** Slice 22 (the parts book and the stock ledger) is built and written
up in `docs/PLAN.md` §7.13, which also carries the rest of the Phase 3 slice table (23–28). Slice 23 — locations
and transfers — is next.

The gate is unchanged for every slice: `npm run verify` and `npm run verify:full`, then
`tests/e2e/happy-path.spec.ts` must still pass **untouched**.


## The kickoff brief (verbatim)

Everything below this line is the brief as it was given. It has not been edited.

---

## Project brief: Cimmerian Crane Services — Helpdesk & Job Management App

You are the lead engineer on a new, blank project. Read this entire brief before writing any code. It is long on purpose: it is the product spec, the domain knowledge and the build plan.

---

## 0. How I want you to work

1. **Do not build everything at once.** First produce two files, then stop and show me a short summary:
   - `CLAUDE.md`: project conventions, stack, commands (install, dev, test, lint, migrate, seed), folder structure, domain glossary, and the rules in this brief that must never be violated.
   - `docs/PLAN.md`: architecture, data model (as a schema), screen list, and the phased plan from section 12, with Phase 1 broken into small vertical slices.
2. If something is genuinely blocking, ask me at most 5 questions in one message. Otherwise make a sensible assumption, record it in `docs/ASSUMPTIONS.md`, and continue.
3. After I approve the plan, **build Phase 1 only**, one vertical slice at a time (database → API → UI → tests). After each slice: run tests and lint, commit with a clear message, and give me a 3 to 5 line summary of what works and how to try it.
4. Design the schema for all phases up front where cheap (so we don't rewrite it later), but only implement the UI and logic for the current phase.
5. Keep everything runnable on **Windows, macOS and Linux**. No bash-only scripts; use npm scripts or cross-platform tooling.
6. Prefer boring, well-supported libraries. Justify any deviation from the stack in section 2.
7. Never invent regulatory facts. Compliance rules are **configuration**, not hard-coded logic (see section 7).

---

## 1. Context

**Company:** Cimmerian Crane Services. We provide crane servicing, breakdown repairs, visual inspections, load testing and related work for industrial customers.

**Users:** a small office team (admin, dispatcher, finance), a storekeeper, field technicians working on phones/tablets, and eventually customers.

**Locale defaults:** Singapore. Timezone `Asia/Singapore`, currency SGD, GST-aware invoicing, dates as `DD/MM/YYYY` in the UI (store UTC in the database). Make timezone, currency and GST rate settings, not constants.

**Goal:** one system of record for every enquiry, job, crane, customer, document, certificate and part, replacing spreadsheets, WhatsApp threads and paper forms.

**Core principle:** the **crane (asset)** is the centre of the data model. Every job, report, certificate, part used and reminder hangs off a crane, and every crane belongs to a site and a customer.

---

## 2. Tech stack (defaults; deviate only with justification)

- **Language:** TypeScript everywhere.
- **App:** Next.js (App Router) full-stack, with server actions or route handlers for the API.
- **Database:** PostgreSQL (via Docker Compose for local dev; provide a one-command setup). Use **Prisma** for schema and migrations.
- **Auth:** Auth.js (email + password to start), role-based access control enforced **server-side** on every query and action, not just in the UI.
- **UI:** Tailwind CSS + shadcn/ui. Responsive; the technician screens are **mobile-first**, the office screens are desktop-first.
- **Technician app:** installable **PWA** (service worker via Serwist or equivalent) with **offline-first** storage using IndexedDB (Dexie). See section 10.
- **Signatures:** `signature_pad` (or equivalent) producing PNG/SVG stored with the report.
- **PDF generation:** server-side HTML-to-PDF (Playwright/Chromium) or `@react-pdf/renderer`; pick one and justify it. PDFs must be reproducible and include a unique document number.
- **File storage:** local disk in dev, with an S3-compatible adapter interface for production (photos, PDFs, uploaded certificates).
- **Background jobs / scheduling:** a simple job runner (e.g. pg-boss or node-cron behind an interface) for reminders and email.
- **Email:** an adapter interface with a console/log implementation in dev and SMTP in production.
- **Testing:** Vitest for unit tests, Playwright for a few end-to-end happy paths. Seed script with realistic demo data.
- **Validation:** Zod on all inputs.

---

## 3. Users and roles

| Role | Can do |
|---|---|
| **Admin** | Everything: users, roles, templates, settings, pricing, data import |
| **Office / Dispatcher** | Create and triage tickets, manage customers/sites/cranes, schedule and dispatch, review and approve reports, raise quotes |
| **Technician** | See only jobs assigned to them; complete checklists and reports; log parts used; capture photos and signatures; view crane history for assigned sites |
| **Storekeeper** | Parts catalogue, stock movements, delivery orders, stock take, purchase orders |
| **Finance / Manager** | Read all jobs; invoicing queue; profitability and SLA reports; approve pricing and write-offs |
| **Customer** (Phase 4) | Read-only access to their own cranes, reports, certificates and due dates; raise tickets |

Implement a permission map (role → capability) in one place so it can be changed easily. Write tests proving a technician cannot read another technician's jobs or any other customer's data.

---

## 4. Job management

### 4.1 Job types

Seed these as configurable `JobType` records (each has a default checklist template, required documents, default priority and a default report template):

- Scheduled servicing (PM)
- Breakdown call-out
- Visual inspection
- Load test
- Statutory examination support (preparing the crane and test load for an Authorised Examiner, then following up)
- Installation / commissioning
- Re-certification / re-registration support
- Repair / modification
- Wire rope, hook or lifting gear replacement
- Site survey / quotation only
- Follow-up / defect rectification (usually auto-generated from findings)
- Warranty / callback
- Equipment rental / supply-only
- Training / familiarisation (optional)

### 4.2 Lifecycle

`Enquiry/Ticket → Triage → Quote (optional) → Scheduled → Dispatched → In Progress → Completed → Reviewed → Invoiced → Closed`

Job statuses: `New, Triaged, Quoted, Approved, Scheduled, Dispatched, In Progress, On Hold, Completed, Reviewed, Invoiced, Closed, Cancelled`.

Rules:
- Every status change is timestamped, attributed to a user, and stored in a status history table.
- `On Hold` **requires a reason** (awaiting parts, awaiting customer access, awaiting quote approval, awaiting AE, weather, other).
- A ticket can spawn one or more jobs. A job may cover one or more cranes.
- A completed job whose report contains findings requiring action can **generate follow-up jobs** with one click, pre-filled from the findings.
- Completing the relevant job types updates the crane's next-due dates (section 8).

### 4.3 Priority and SLA

- Priorities: `P1 Crane down / safety risk`, `P2 Degraded operation`, `P3 Routine`, `P4 Planned`.
- Priority → SLA targets (response, resolution) are configurable per priority and overridable per contract.
- Tickets and jobs show a live SLA timer and breach state. P1 tickets trigger an immediate alert to dispatchers (in-app + email in Phase 1; SMS/WhatsApp via adapter later).
- Dispatchers can bump a lower-priority scheduled job to make room for a P1; this must be audit-logged with a reason.
- A crane can be flagged **Restricted / Do Not Operate** with a reason. The flag is shown prominently on the crane, its customer, and any job at that site.

### 4.4 Assignment and scheduling

- Technicians have **competencies** (e.g. electrical, rigging, specific brands, load test competent) with expiry dates. Warn (or block, configurable) when assigning someone without a valid required competency.
- Schedule board: day/week view by technician, drag-and-drop, conflict warnings, leave and unavailability, and an on-call roster for after-hours breakdowns.
- Jobs can require **resources** (vehicle, test weights, load cell) as well as people; resources are bookable and conflicts are flagged.
- Dispatch sends the technician a notification with site contact, access/induction notes, crane history summary, and the checklist.

---

## 5. Data model (starting point; refine in `docs/PLAN.md`)

All tables: `id`, `createdAt`, `updatedAt`, `createdById`, soft-delete where sensible. Add an append-only **AuditLog** (entity, entityId, action, before/after JSON, userId, timestamp, ip) written for every create/update/delete on business entities.

- **Customer**: legalName, tradingName, UEN, billingAddress, paymentTerms, creditStatus, status (`prospect | active | dormant`), notes
- **Contact**: customerId, siteId?, name, role (site contact / accounts / safety officer / decision-maker), phone, email, preferred channel
- **Site**: customerId, name, address, access notes, induction requirements, operating hours, geo coordinates
- **Crane** (asset): siteId, customerId, assetTag/internal ID, QR code value, type (overhead, gantry, jib, mobile, tower, hoist, other), brand, model, serialNumber / distinctive number, SWL (kg), yearOfManufacture, statutoryRegistrationNo?, registrationDate?, ownerEntity, location within site, hour meter, status (`in service | restricted | out of service | decommissioned`), notes
- **CraneSchedule**: craneId, scheduleType (monthly service, annual examination, load test, hoist exam, etc.), intervalMonths, lastDoneDate, nextDueDate, source (`manual | rule`), reminder offsets (default 90/60/30 days)
- **Contract**: customerId, type (AMC etc.), term, SLA overrides, scope notes, included visits, price schedule, renewal date, covered cranes
- **Ticket**: number, source (phone/email/WhatsApp/web/portal), customerId, siteId, craneId?, description, photos, priority, status, createdBy
- **Job**: number, ticketId?, jobTypeId, customerId, siteId, status, priority, scheduledStart/End, assigned technicians (many), crane(s) (many), required resources, SLA timestamps (reported, responded, onSite, restored, completed), customer PO ref, onHoldReason, parentJobId (for follow-ups)
- **JobStatusHistory**
- **ReportTemplate** + **ChecklistTemplate** + **ChecklistItem**: versioned; per job type
- **Report**: jobId, craneId, templateVersion, data (JSON validated against the template), status (`draft | submitted | approved | amended`), technician signature (image, name, timestamp), customer signature (image, name, designation, timestamp, or `declined / unavailable` with reason), documentNumber, pdfFileId
- **Finding**: reportId, craneId, component, description, severity (`critical | major | minor | observation`), recommendation, photos, status (`open | quoted | scheduled | rectified | declined by customer`), customerDeclinedAcknowledgement (name, signature, date)
- **Certificate**: craneId, type (statutory test & examination certificate, load test certificate, calibration certificate, competency certificate, etc.), issuer (e.g. AE name/firm), issueDate, expiryDate/nextDueDate, statedSWL, certificateNumber, fileId, linked jobId?
- **Technician**: userId, employee details, **Competency** records (name, certificate no., issuer, expiry, file)
- **Equipment** (tools / test weights / load cells / vehicles): type, serial, calibrationDueDate, calibration certificate file, status
- **Part**: partNumber, description, brand, compatible crane models, uom, cost, sellPrice, preferredSupplierId, leadTimeDays, trackSerial/batch flag, reorderLevel, reorderQty, photos
- **Location**: warehouse / bin / van / customer site
- **StockLevel**: partId, locationId, quantity
- **StockMovement**: partId, fromLocation?, toLocation?, qty, type (`receive | issue | return | transfer | adjust | writeoff`), reference (jobId / deliveryOrderId / purchaseOrderId / stockTakeId), serial/batch, reasonCode, userId, timestamp, unitCost
- **DeliveryOrder** + **DeliveryOrderLine**: number, jobId, customerId, delivery address, lines (part, description, qty, serial/batch, condition, chargeable | warranty | loan, expectedReturnDate), receiver name/signature/timestamp, status (`draft | issued | delivered | partial | returned`)
- **Supplier**, **PurchaseOrder** + lines
- **StockTake** + **StockTakeLine**: scope (location/category), blind count flag, systemQty, countedQty, variance, recount flag, reasonCode, approvedBy, adjustmentMovementId
- **Quote** + lines, **Invoice** + lines (GST-aware), **Payment** (basic), with an accounting-export adapter (CSV first; Xero/QuickBooks later)
- **Notification**, **Setting**, **Attachment/File**

Indexes needed for: job list filtering (status, customer, type, technician, date, priority), crane next-due dates, stock levels by part/location, audit log lookups.

---

## 6. Documentation and reports

### 6.1 Common report header (all job types)

Job number, job type, customer, site address, site contact, date, time in / time out, technician(s), customer PO/reference, report document number.

### 6.2 Crane details block (all reports; pre-filled from the Crane record)

Crane ID, type, brand/model, serial/distinctive number, SWL, year of manufacture, statutory registration no. (if applicable), location, hour-meter reading (entered on site).

### 6.3 Per-job-type content

- **Servicing:** component checklist with `Pass / Fail / N/A` plus measurements and notes for: hoist, trolley, bridge/boom, brakes, wire rope (diameter, wear, broken wires), hook and block (throat opening, latch), limit switches, controls/pendant, electrical panel, lubrication. Plus work done, parts used, defects, recommendations, **"safe to operate" yes/no/with restrictions**.
- **Breakdown:** reported fault, time reported / arrived / restored, root cause, corrective action, parts used, whether returned to service, temporary measures, recommended follow-up.
- **Visual inspection:** structure, safety devices, markings and load charts, wire rope and hook condition, operator controls; findings by severity; photos of defects; overall condition rating.
- **Load test:** test load, test radii, SWL at each radius, result at each point, instruments used (load cell ID + calibration due date), pre- and post-test examination results, deflection or abnormalities, whether an Authorised Examiner attended (name/firm), final outcome. Validate that referenced calibration is **not expired** at test date and warn if it is.
- **Installation / modification:** scope, drawings/specs referenced, components installed, torque/alignment records, commissioning results, handover checklist.
- **Re-certification support / statutory exam support:** pre-exam checklist, items prepared, AE attendance, outstanding defects, certificate received (link to Certificate record).

### 6.4 Sign-offs

Technician name + signature + timestamp. Customer representative name + designation + signature + timestamp. Option: "Customer unavailable / declined to sign" with a reason. If a customer **declines a recommended critical repair**, capture a signed acknowledgement against that Finding.

### 6.5 Delivery orders

Generated from parts issued on a job (so stock and paperwork can't drift). Contents as in the DeliveryOrder entity. Supports partial delivery and loan equipment with return tracking.

### 6.6 Certificates and compliance documents

Store, link to the crane, and track expiry for: statutory certificates of test and examination issued by an Authorised Examiner, load test certificates, registration documents/history, repair and modification records, calibration certificates for load cells and test weights, technician competency certificates, lifting gear registers and examination dates (if we service gear), and test weight traceability. Show a **Compliance dashboard**: certificates expiring in 90/60/30 days and overdue.

### 6.7 Document generation

- Templates per job type with merge fields, company branding, and **versioning**, so an old report always re-renders as originally issued.
- PDF export with a unique document number, timestamp, embedded signatures and photos.
- Email to the customer on job close, with a copy stored against the job and crane.
- **Approved/issued reports are locked.** Corrections create an *amendment* (new version with reason, linked to the original); never overwrite.

---

## 7. Compliance rules (Singapore): configuration, not code

Context (from MOM publications, to be verified with our Authorised Examiner before relying on it):

- Cranes and similar equipment are statutory lifting equipment. Owners must register them with MOM through an **Authorised Examiner (AE)**, a Professional Engineer approved by MOM. The AE issues the **certificate of test and examination**, which states the safe working load.
- Revised MOM requirements took effect on **12 September 2025**: periodic overload testing after registration was removed; hoist periodic examination moved from 6-monthly to 12-monthly; competent persons may now perform periodic lifting gear re-examinations, while AEs remain required for critical inspections such as before first use and after major repairs or modifications.
- Re-registration is needed when equipment changes owner, when the owner's UEN changes, or when a disassembled unit is re-assembled at another location.
- A 2024 MOM circular sets a four-yearly load test for mobile cranes; a newer 2025 circular exists. **Do not assume which governs.**

Implementation requirements:
1. Model inspection/test **intervals as data** (`CraneSchedule` + a `ComplianceRule` table keyed by crane type), editable by Admin, with a free-text "source/reference" field (e.g. circular number, date reviewed).
2. Distinguish clearly in the UI and data between **company inspections** (our technicians) and **AE statutory examinations** (certificate issued by the AE). Our reports never claim to be statutory certificates.
3. Trigger "re-registration may be required" reminders when a crane's owner/UEN changes or its location is changed after re-assembly.
4. Show a visible note in the admin screen for compliance rules: "Rules are configured by your team. Verify against current MOM requirements with your Authorised Examiner."

---

## 8. Customer and job history, and reminders

- **Customers list** with status filter (`prospect / active / dormant`), search, and CSV import for historical customers.
- **Customer detail** tabs: Overview, Sites, Cranes, Jobs (active/past), Contacts, Contracts, Documents, Invoices.
- **Crane detail** (most important screen): header with status/restricted flag/SWL/registration; timeline of every service, inspection, load test, breakdown; certificates; parts used; open findings; recurring-fault indicator; next-due dates; QR code printable label that deep-links to this page.
- **Company-wide job list**: filter by status, customer, job type, technician, priority, date range, SLA state; saved filters; sortable; CSV export; list, calendar and (later) map views.
- **Dashboard** (office): open P1s, SLA breaches, overdue jobs, jobs on hold by reason, jobs awaiting invoicing, certificates expiring soon, next 30 days of due services/inspections.
- **Reminders:** a daily background job evaluates all `CraneSchedule.nextDueDate` values and sends reminders at the configured offsets (default 90/60/30 days, then overdue) to the account owner and optionally customer contacts. Option to **auto-create draft jobs** from due dates. Completing the relevant job type resets `lastDoneDate` and recomputes `nextDueDate`.

---

## 9. Parts inventory and stock take

- **Catalogue:** all Part fields above, searchable by part number, description, brand, compatible model.
- **Stock by location:** warehouse, bins, technician vans, customer site (for consigned parts).
- **Every change is a StockMovement**; quantities are derived or reconciled from movements. Issuing a part on a job writes to the report's parts list and to the DO. Job costing reads from these movements.
- **Serial/batch tracking** for critical items (wire rope, hooks, brakes, electrical components): you can trace which crane received which serial.
- **Stock take workflow:** create session → (optionally) freeze movements for scope → blind count on mobile/scanner → variance report → supervisor review, recounts, approve adjustments with reason codes → adjustments posted as movements. Flag repeat discrepancies by part/location.
- **Low stock alerts** when quantity ≤ reorder level, with a suggested purchase order grouped by supplier. Track back-orders and link jobs that are On Hold awaiting a part.
- **Suppliers:** contacts, lead times, price history, linked POs.

---

## 10. Mobile, offline and signatures (technician PWA)

- Mobile-first screens: My Jobs today, Job detail, Crane history, Checklist/report form, Parts issue, Photo capture, Signature capture, Check-in/out.
- **Offline-first:** before going offline (and on each sync), cache the technician's upcoming jobs, relevant crane histories, templates, parts catalogue and customer contacts in IndexedDB. A technician must be able to complete an entire report, take photos, capture both signatures and generate a customer copy **with no connectivity**.
- Sync queue with a clear "pending upload" indicator and retry. Conflict rule: the technician's field data wins for their own job report; office edits to scheduling don't overwrite field data. Log conflicts.
- Camera integration with client-side image compression; GPS check-in (optional, setting); barcode/QR scanning for cranes and parts.
- Signature capture on screen with signer name and timestamp. Generate the PDF on the server after sync, and also provide an on-device summary the customer can view immediately offline.
- Auto-save drafts locally every few seconds. Never lose a report because of a dropped connection.

---

## 11. Non-functional requirements

- **Security:** server-side authorization on everything, password hashing, session security, rate limiting on login, file-upload validation (type, size), signed URLs for private files.
- **Privacy:** follow Singapore PDPA principles. Collect only needed personal data, role-based access, and ability to export/delete a contact's personal data.
- **Audit:** append-only audit log, plus "who changed what" visible on key records.
- **Performance:** list views paginated server-side; target under 2 seconds for common screens on typical office hardware.
- **Reliability:** automated database backups documented in the README; migrations are reversible where possible.
- **Accessibility and usability:** large tap targets and high contrast on technician screens (gloves, bright sun); keyboard-friendly office screens.
- **Observability:** structured logs, an error boundary, and a simple health-check endpoint.
- **Document retention:** never hard-delete reports, certificates or audit logs; use soft-delete/archival.

---

## 12. Phases

### Phase 1: Core (BUILD THIS FIRST)

1. Project setup, CI-style scripts (lint, typecheck, test), Docker Compose Postgres, seed script, `CLAUDE.md`.
2. Auth, roles and permission map; user management (Admin).
3. Customers, Contacts, Sites, Cranes (full CRUD, search, CSV import for customers and cranes); crane detail page with timeline.
4. Tickets → Jobs, job types with seeded checklist templates (servicing, breakdown, visual inspection, load test), priorities and SLA timers.
5. Scheduling and dispatch (schedule board with drag-and-drop, technician assignment, competency warnings), in-app + email notifications.
6. Technician PWA: My Jobs, offline job + report completion, photos, technician and customer signatures, sync queue.
7. Report approval flow, locked reports with amendments, PDF export with document numbers, email to customer.
8. Company-wide job list with all required filters and CSV export; basic office dashboard.
9. Audit log across all entities.
10. Tests: unit tests for permissions, status transitions, SLA calculation, schedule recomputation; Playwright happy paths for (a) P1 breakdown from ticket to signed PDF, (b) offline report completion and later sync.

**Phase 1 acceptance:** a dispatcher can log a breakdown call, mark it P1, assign the nearest qualified technician; the technician receives it on a phone, goes offline, completes the report with photos and both signatures, reconnects, and the office approves it and the customer receives a PDF; the crane's history shows the job; every step is audit-logged.

### Phase 2: Compliance and recurring work

CraneSchedule + reminders engine, Certificates and Compliance dashboard, ComplianceRule admin, load test and visual inspection templates fully built out (including calibration validation), Findings and follow-up job generation, delivery orders (basic), quotes/variations, invoicing, accounting CSV export.

### Phase 3: Inventory

Parts catalogue, locations, stock movements linked to jobs and DOs, serial/batch tracking, reorder alerts, suppliers and purchase orders, stock take workflow and discrepancy approval.

### Phase 4: Optimisation

Customer portal, contracts and SLA management, profitability and technician-utilisation reporting, equipment calibration tracking, route optimisation, WhatsApp/SMS adapters, Xero/QuickBooks integration.

---

## 13. Seed and demo data

Create a seed script producing a realistic demo: about 8 customers (mix of active, dormant and prospect), 2 to 3 sites each, 25 to 40 cranes of mixed types with varying next-due dates (some overdue, some due in 30/60/90 days), 6 technicians with competencies (one with an expired one), 30 historical jobs across all job types with reports, 2 open P1 tickets, 40 parts with some below reorder level. Demo logins for each role, documented in the README.

---

## 14. Quality bar / definition of done (every slice)

- Typecheck, lint and tests pass; new logic has tests.
- Permissions verified server-side with a test.
- Mutations write to the audit log.
- Empty, loading and error states handled; forms validated with clear messages.
- Mobile technician screens checked at a ~390px width and in offline mode.
- README and `CLAUDE.md` updated; migration included; seed still works.
- Short summary to me: what was built, how to run it, what's next, and any assumptions made.

---

## 15. Open questions to flag early (don't block on these; record your assumption)

1. Do we employ or contract an Authorised Examiner, or do we only support AE-led exams?
2. Which accounting software do we use today (Xero, QuickBooks, other)?
3. Do technicians use Android, iOS or both?
4. Roughly how many cranes, customers and technicians exist today, and in what format is the data (spreadsheet columns)?
5. Is hosting preference cloud (which provider?) or on-premises?
6. Do we need WhatsApp-based ticket intake in Phase 1, or is email/phone/web form enough?

**Start now:** read this brief, then produce `CLAUDE.md` and `docs/PLAN.md` and stop for my review.
