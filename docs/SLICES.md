# SLICES.md — what each slice added, and how to try it

Reference, not an introduction. `README.md` says how to run it; this file is the per-slice account
of what each one added and what to click. Canonical decisions stay in `docs/PLAN.md` §7 and
`docs/PLAN-SLICES.md`; assumptions in `docs/ASSUMPTIONS.md`.

## Slice 46 — the Crane and Monorail checklist

- **The first paper sheet is on the phone.** A PM job on an **overhead, gantry or jib** crane now opens the
  Crane and Monorail maintenance checklist: six sections (Hoist, Cross travel, Long travel, Oil lubricants,
  Festoon, Electrical) and 57 lines transcribed from `docs/assets/Crane and Monorail Maintenance Check List.xlsx`.
  Every line is Pass / Fail / N/A with a graded comment, and a line's grade is its answer.
- **The crane chooses the sheet, not the job type alone.** `ChecklistTemplate` now carries `craneTypes` beside its
  existing `jobTypeId`; `src/server/templates/checklist.ts` is the one resolver, used by the phone bundle, report
  submission and the dispatch pack. A sheet only applies to the job type it names, and only on the crane types it
  lists, so a mobile-crane PM keeps the generic servicing list. The newest version wins when two sheets name the
  same type.
- **The scale is the paper's four words.** 4 Good, 3 Monitor, 2 Replacement, 1 Unsafe; only **Unsafe** fails a
  line. A report graded before this slice may still hold a 5, and `readGrades` plus the stored-paragraph path keep
  reading it as the five-point scale it was given.
- **A stale phone is refused, not silently emptied.** A bundle cached before the sheet changed submits codes the
  resolver no longer knows; submission is refused with "The checklist for this crane has changed. Sync and fill the
  report in again" rather than stripping the answers.
- **It fixed an existing bug on the way.** The offline outbox rebuilt the submit payload field by field and dropped
  `grades`, so every queued Service Report was unsendable; `prepare()` now carries them.
- **One migration.** `20261103043308_checklist_template_crane_types` adds `ChecklistTemplate.craneTypes`.
- **Tests** — 5 unit tests in `tests/unit/templates.test.ts` (one sheet, PM, the three crane types, six sections,
  57 items, `CM_` prefix, no duplicate code), 7 integration tests in `tests/integration/checklists.test.ts`
  (resolver fallback and leak, newest version, per-crane phone bundle, dispatch union, CM_ answer accepted and
  labelled, unknown line refused), plus the updated grade tests in `reports.test.ts`, `service-report.test.ts`,
  `service-reports.test.ts` and the outbox payload test.
- **Known limits** — the other four paper sheets are later data entries in the same shape; Chain Block, Dock
  Leveler and Cargo Hoist need new `CraneType` values first. The office has no screen to choose between two active
  sheets for one crane type — newest version wins. A mixed-crane dispatch message prints the union of the sheets,
  so three crane types can make a long email.

## Slice 39 — the Service Report

- **Two documents, and the app now does both.** The **Servicing checklist form** is what a technician fills in at the
  site, per crane: every component graded **1–5** — 5 As new, 4 Good, 3 Serviceable, 2 Repair soon, 1 Failed — with a
  short comment saying what is damaged or needs replacing. A line left alone reads "not graded yet", never 0.
- **The Service Report is what the visit issues.** On `/jobs/[id]` a **Service Report** panel turns the graded
  checklists into prose — a section per crane, a paragraph per part, worst first — which the office rewords and then
  issues. That is the document that gets the number, and the job page links its PDF.
- **The number is `SR<yy><mm><nnn>`.** `SR2606001` is the first Service Report of June 2026. The monthly counter is a
  `DocumentSequence` row keyed `SR:2606`, so it restarts each month and two approvals cannot share one. The per-crane
  checklist form keeps `RPT-2026-0004` — it is a working record, not an issued document.
- **The number uses the approval month, in the operating timezone.** A visit on 31 May approved on 1 June is June's
  first.
- **Every answered checklist line must be graded before the form can be submitted.** Answered means a result, a
  measurement or a note, so a line nobody touched need not be judged. Submit is refused with "Grade every component
  you recorded — 1 line(s) still ungraded."
- **A crane with no graded checklist blocks the Service Report**, and the job page names which crane is missing.
- **Old documents still say what was signed.** Each grade stores the checklist line's wording at submission, and an
  issued Service Report stores its sentences; both re-render exactly as issued even after a template is superseded.
- **Two migrations.** `JobType.isServiceReport` (seeded on `PM`) and the `ServiceReport` table.
- **Tests** — 4 unit tests in `tests/unit/documents.test.ts` (`SR2606001`, month padding, 3-digit overflow) and 5 in
  `tests/unit/reports.test.ts` (1–5 accepted, 0/6/2.5/−1 refused, `''` reads as ungraded, malformed JSON ignored,
  grades survive `reportSubmitSchema`); 7 in `tests/unit/service-report.test.ts` (sentence wording, worst-first
  ordering, ungraded lines and empty cranes left out, no empty sentence accepted); 3 in
  `tests/integration/report-approval.test.ts` (the checklist form keeps `RPT-…`, ungraded refusal, label snapshot);
  8 in `tests/integration/service-reports.test.ts` (draft built from the checklists, SR issue + PDF + lock,
  consecutive numbering, a missing crane refused, `report.approve` enforced server-side, nothing to download before
  issue, no report for a job type that does not issue one).
- **Known limit** — grading is per checklist line, so a component the checklist does not declare has no grade box.
  Only the seeded `PM` type issues one. A Service Report has no amendment path: once issued it refuses edits.

## Slice 38 — the notification inbox

- **`/inbox` is where the alerts have always been going.** A P1 to every dispatcher, a due-service reminder, a dispatch
  pack to the technician on the job — every one of them has written an in-app row since Phase 1, and until now nothing
  could read one back. The nav gains **Inbox** with an unread badge; the screen lists the signed-in person's own alerts,
  newest first, with **All** and **Unread** tabs and a **Mark all read** button.
- **A failed delivery is visible, with its reason.** If the email, SMS or WhatsApp copy of an alert did not go, the row
  says which channel failed and why, beside the in-app copy that did reach you. A dead mail server is no longer only in
  the log.
- **The inbox is yours.** A notification is addressed to one person and the server reads it through that id, so signing
  in as the dispatcher and as the admin shows each their own: an alert addressed to one does not appear on the other's
  badge or list.
- **It adds no schema and no writer.** No migration; `src/server/notifications/inbox.ts` reads the rows `notify.ts`
  already writes, and marking one read is the only write, audit-logged like every other mutation.
- **Tests** — 4 unit tests in `tests/unit/scope.test.ts` (own rows for every role, never an unfiltered query, two users
  never seeing each other, denied for the portal role) and 10 integration tests in
  `tests/integration/notifications.test.ts` (scoping, newest first, counts over the whole inbox, an email twin not
  counting as a second unread alert, marking read audited, another user's row refused as `NotFound`, the role refusal,
  mark-all leaving read rows and other people's alone). `tests/e2e/inbox.spec.ts` walks the badge, the list, the other
  account's empty inbox, marking read, and the failed-delivery notice.
- **Known limit** — the phone shell has no inbox tab yet: `/inbox` renders the office layout, so a technician reaches it
  from a browser but not from the app's own nav. The list is the last 100 and has no search. Nothing is ever deleted.

## Slice 37 — pushing invoices into Xero

- **Billed invoices go into Xero from `/invoices`.** Above the list, an **Accounting system** panel says how many bills
  are not yet there and offers one press. Issued, partly paid and paid invoices are sent; a draft is still being edited
  and a void is not a bill. Pressing again sends nothing twice.
- **A bill is marked sent only once Xero accepts it.** The invoice page then says which Xero invoice it went under. A
  refused bill keeps the reason on screen, stays unpushed, and the next press retries only that one — a partial run does
  not undo the bills that went through.
- **Xero's total is checked against ours.** Lines go at their unit prices so the org computes and files the GST; if the
  returned total differs from the bill the customer was sent, the push reports it rather than recording it as sent.
- **It is off until configured.** `ACCOUNTING_DRIVER=none` by default and the CSV export remains the only way money
  leaves the app. To turn it on: create a **Custom connection** at developer.xero.com, authorise it against the org,
  and set `ACCOUNTING_DRIVER=xero`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` (and `XERO_TAX_TYPE` if the org's standard
  rate is not `SR`) in `.env`. **No live call has been made from this repository** — no credentials were available, so
  the first push against a real org is the real test.
- **Tests** — 6 unit tests in `tests/unit/accounting-push.test.ts` (the ACCREC body, cent rounding, the account code,
  the `none` driver reporting rather than pretending, resolving `xero` from env) and 4 integration tests in
  `tests/integration/invoices.test.ts` using a recording driver (sent only once the reference returns, the draft never
  sent, a refused bill retried alone, the null guard, the role refusal, the book's unpushed count). No browser test
  walks the panel. **Migration `20261030200000_slice37_accounting_push`** adds `Invoice.externalRef` and
  `Invoice.externalPushedAt`.
- **Migration status** — it is applied. Note for anyone reading an older copy of this file: it was once recorded as
  applied when it was not, so `Invoice.externalRef` was missing and every suite touching an invoice failed. That is
  now corrected, and two of the slice's own tests (which raised a second invoice on a job already moved to `INVOICED`)
  were fixed with it. `npx prisma migrate status` should read "Database schema is up to date!".

## Slice 35 — route optimisation

- **The day's round, in driving order.** Under the schedule board, `/schedule` lists the day's visits in the order to
  drive them: position, job, site, customer, address, and the kilometres from the stop before. A total and an estimated
  drive sit above the list. The technician filter at the top of the page narrows the round to one person's day.
- **The order starts at the first booked visit.** There is no depot in the system, so the earliest-scheduled visit keeps
  its slot and the rest are ordered from there. It is a **read**: nothing is rescheduled, and the dispatcher acts on it
  by dragging cards on the board.
- **The distances are honest about what they are.** Great-circle kilometres, not road distance, and the drive time
  assumes 30 km/h. Both are said on the screen — the round is a guide for the order, not a mileage claim.
- **A site with no coordinates is listed, never dropped.** Visits whose site has no latitude/longitude appear in an
  amber block naming the job; adding the coordinates on the site puts them on the round.
- **The demo sites now have coordinates**, so the round is populated after `npm run seed`.
- **Try it:** sign in as `dispatcher@cimmeriancrane.example`, open `/schedule`, and read the **Round** section under the
  board. Pick a day and a technician to see one person's day.
- **Tests** — 9 unit tests in `tests/unit/routes.test.ts` (the geometry, the pinned start, 2-opt never making it worse,
  determinism) and 5 integration tests in `tests/integration/routes.test.ts` (the ordering, the day window, the
  technician filter, the unlocated block, the role refusal). No browser test walks the section. **No migration.**

## Slice 34 — equipment calibration tracking

- **One register for the kit that gets calibrated.** `/calibrations` (Dispatch, Storekeeper, Admin and Finance, via
  `resource.read`) lists the equipment the schedule already books — test weights, load cells, vans and tools — with its
  state, the date its calibration runs out, and the lab certificate if one is on file. It opens on the same
  overdue/30/60/90 buckets as the certificate register, soonest first.
- **No new model.** The register is the `Resource` table: `calibrationDueDate` and `calibrationFileId` have existed
  since Phase 1, which is why the booking warning (slice 6) and the load test's instruments table (slice 17) already
  read them. This slice gives the date a screen that owns it, so a lapsed item can be renewed rather than only flagged.
- **The storekeeper maintains it.** Adding and editing is `resource.write` (Storekeeper and Admin); dispatch keeps
  `resource.read`. The certificate is uploaded through the same signed-URL route as a crane certificate, accepted as a
  PDF or a photo up to 5 MB, and is attached after the item is first saved — the storage key names its id.
- **Retiring is a status, not a delete.** An item still booked on an unfinished job cannot be retired, and the refusal
  names the jobs; once released, retiring keeps the row and its audit trail.
- **Try it:** sign in as `store@cimmeriancrane.example` and open `/calibrations`; add a load cell, save, then
  reopen its **Edit** panel to attach the certificate.
- **Tests** — 1 new permission test and 6 integration tests (`calibrations.test.ts`: the create and update audit rows,
  the file-ownership refusal, the retirement guard, the bucket counts and filters, and the role refusal). No browser
  test walks the screen. **No migration.**

## Slice 33 — technician utilisation

- **Hours against the hours that were available.** `/reports/utilisation` (Finance and Admin, via `report.financial`)
  lists every technician with their completed jobs, hours on the tools, hours on the road, leave taken, hours available
  and a utilisation percentage, busiest first. A from/to pair of completion dates narrows it; with neither it opens on
  the **last 30 days**.
- **Where the hours come from.** The job status history: **on the tools** is `IN_PROGRESS` until the job next moves,
  summed over however many visits it took, so a job parked awaiting parts counts the time worked and not the wait;
  **on the road** runs from dispatch to completion, so it carries the travel either side. A job with two technicians
  on it splits its hours between them.
- **Available time is Monday–Friday, 09:00–17:00, less leave booked inside those hours.** There is no shift pattern and
  no public-holiday calendar, and the screen says so. Hours count on the day a job completed, so a job still in
  progress contributes nothing yet and the most recent days read low.
- **Try it:** sign in as `finance@cimmeriancrane.example` and open `/reports/utilisation`; narrow the dates to reach the
  demo history jobs.
- **Tests** — 10 unit tests (`utilisation.test.ts`, the hold arithmetic, weekend skipping and leave clipping) and 5
  integration tests (`utilisation.test.ts`: the in-progress span excluding a hold, a crew splitting one job's hours,
  leave removed in working hours only, an unfinished job excluded with unassigned completions named, and the role
  refusal). No browser test walks the screen. **No migration.**

## Slice 32 — profitability reporting

- **Revenue against material cost.** `/reports/profitability` (Finance and Admin, via `report.financial`) shows a
  totals row and three tables — by customer, by contract, by job type — each with revenue, parts cost, margin and
  margin percentage, sorted by revenue. A from/to pair of **issue dates** narrows it.
- **Where the numbers come from.** Revenue is the invoice subtotal **excluding GST**, on issued, partly paid and
  paid invoices only. Cost is the `unitCost` on the `ISSUE` stock movements of the jobs behind those invoice lines —
  the same ledger rows the invoice prefill and the delivery order read.
- **Labour is not costed, and the screen says so.** Nothing records an hourly rate, so a margin here is revenue less
  material, not gross profit. The column is labelled *Parts cost* rather than "cost of sale" for that reason.
- **A job's material is counted once**, in the period its invoice falls in — a job billed on two invoices is not
  double-costed, and a job invoiced in March for February parts shows both in March. Invoice lines with no job behind
  them (labour typed straight onto an invoice) count in the totals and against their customer, and the page states
  how much that is — which is why the contract and job type tables can total less than the overall figure.
- **Try it:** sign in as `finance@cimmeriancrane.example`, raise and issue an invoice on a reviewed job with a part
  issued on it, then open `/reports/profitability`.
- **Tests** — 5 integration tests (`profitability.test.ts`: ex-GST revenue and the job's parts cost, a job's material
  booked once across two invoices, a draft excluded, an unattributed line reported as such, and a role without
  `report.financial` refused). No browser test walks the screen. **No migration.**

## Slice 31 — the customer portal

- **The `CUSTOMER` role finally signs in.** A `User` with a `customerId` (new nullable column, indexed, migration
  `20261030100000_slice31_portal_user`) lands on `/portal` after sign-in and is redirected there from `/dashboard`.
  `/admin/users` gains a customer picker, shown only when the role is Customer; a Customer login without one is
  refused when saved, and one that has none is scoped to nothing rather than to everything.
- **Read-only, by construction.** `CUSTOMER` holds `portal.read`, `crane.read`, `certificate.read` and
  `report.read.own` — no writes, and deliberately no `job.read.all` (which would make `jobReadWhere` unfiltered and
  leak the whole book). Every portal page is a server component calling read services.
- **Five pages:** `/portal` (open jobs, cranes, certificates due soon, recent work), `/portal/jobs` and
  `/portal/jobs/[id]`, `/portal/cranes`, `/portal/certificates`, `/portal/reports` (approved reports only, with the
  issued PDF link).
- **One scoping rule, not two.** The portal calls the same `listCranes`, `listCertificates` and `issuedPdfUrl` the
  office calls; the `customerId` branch already in every `xxxReadWhere` decides the rows. A job id belonging to
  another customer returns 404, not 403.
- **The way in is the customer link, not a capability.** Admin holds `ALL`, so `portal.read` would put a staff login
  on `/portal` and the first service call would throw. Each page runs `requirePortalPage()` (Next 15 renders a layout
  and its page in parallel, so the layout's redirect alone does not stop the page).
- **Try it:** sign in as `portal@cimmeriancrane.example` (first demo customer). Then sign in as Admin, open
  `/admin/users`, and give a second login a different customer to see the isolation.
- **Tests** — 8 integration tests (`portal.test.ts`: own jobs only, another customer's job 404s, own cranes via
  `listCranes`, approved-only reports, the overview counts, no foreign certificates, a login with no customer sees
  nothing, and a role without `portal.read` refused), plus unit tests on the capability set and the crane scope, and
  7 browser tests (`tests/e2e/portal.spec.ts`: sign-in lands on `/portal`, `/dashboard` redirects back, only their own
  jobs are listed, another customer's job 404s by URL, empty states, and a staff login is turned away).

## Slice 30 — SLA management and the renewal board

- **The company-wide targets are editable.** `/admin/sla` (Admin, via `sla.manage`) shows all four priorities with
  their response and resolution minutes in one form. Saving changes what `resolveSlaTargets` hands every **new** job;
  jobs already raised keep the deadline they snapshotted.
- **Nothing configured is stated, not hidden.** A priority with no stored row shows the built-in default with a
  *"Nothing configured — the built-in default is in force"* badge, so the screen never pretends an empty field is a
  zero-minute target. Every save is audit-logged per priority and labelled `Company-wide P1 target` in the viewer.
- **A renewal board, not a hidden date.** `/customers` now carries a **Contracts renewing** section above its filters,
  unaffected by the search and status filters: every live contract overdue or renewing within 90 days, soonest first,
  each with a date and a red *"N days overdue"* or amber *"in N days"* badge, linking to that customer's contracts.
- **Try it:** `/admin/sla` → change P1's resolution to 60 → save → raise a P1 ticket/job and watch the due time. Then
  open `/customers` to see the renewal queue (the seed has contracts dated around the demo period).
- **Tests** — 5 unit tests (`sla-targets.test.ts`: string coercion, resolution-not-quicker-than-response naming its
  field, fractional/zero/missing priorities refused, one target per priority in order) and a 6-case integration suite
  (`sla-management.test.ts`: the four-row write inside a rolled-back transaction with its audit rows and the resolver
  following, the fallback when a row is missing, four roles refused, the renewal window and ordering, retired contracts
  excluded, and the board readable by Dispatcher and Finance but not a technician).

## Slice 29 — contracts on the customer page

- **The agreed terms finally have a home.** A customer page's **Contracts** tab lists its contracts — kind,
  reference, term, renewal date, included visits, covered cranes and scope notes — with an add form and,
  per contract, an edit form and **Retire**.
- **The SLA numbers are the contract's.** Each contract carries its own response and resolution minutes per
  priority. Blank means "follow the company-wide target"; a pair is written as an `SlaPolicy` row carrying
  the contract's id, which is exactly the row `createJob` already reads — so a new job snapshots the
  contract's numbers, and changing the contract later never rewrites history.
- **Covers the account or named cranes.** Tick no cranes and the contract covers the whole customer (what an
  AMC usually is); tick some and it covers only those. A crane belonging to another customer is refused.
- **Retired, never deleted.** Jobs and tickets keep naming the contract; a retired one leaves the list and
  stops being picked for new jobs, and its SLA rows stay as the record of what was agreed. Renewals show an
  amber badge inside 90 days and a red one once overdue.
- **Try it:** open a customer → **Contracts** → *Add a contract* → tick a crane, give P1 a response and
  resolution, save. Then raise a P1 job for that customer's crane and compare its SLA due time with a job on
  a customer that has no contract.
- **Tests** — 13 unit tests (`contracts.test.ts`: blanks read as absent, UTC dates, both-or-neither and
  resolution ≥ response, checkbox de-duplication, the override map, the renewal window, crane coverage) and a
  5-case integration suite (`contracts.test.ts`: the SLA rows written per contract, a job snapshotting them
  and the rows cleared when the pair is blanked, another customer's crane refused, retire-not-delete, and
  finance reading but only Admin writing).

## Slice 28 — back-orders linked to jobs on hold

- **A parts hold now names the part.** Putting a job on hold with the *Awaiting parts* reason asks which
  catalogue part it is waiting for. The amber banner then says which part, how many are still owed, from
  whom and when — read from the open purchase order line, never stored as a flag of its own.
- **Both directions.** The part's own page lists the jobs standing still for it, so the storekeeper can
  order against a queue rather than a recollection.
- **Cleared when it moves.** Leaving an awaiting-parts hold clears the link; a part that is not in the
  catalogue is refused.
- **Try it:** open a scheduled job → *On hold* → reason *Awaiting parts* → pick a part. Then **Parts** →
  the part → the jobs waiting on it.
- **Tests** — a 5-case integration suite (`back-orders.test.ts`: the link recorded and audited and shown
  from both sides, an unknown part refused, the link cleared on leaving hold, the open lines that still
  owe some, and nothing once fully received).

## Slice 27 — the supplier book

- **Who the store buys from.** `/suppliers` lists every supplier — contact, phone, email, lead time and
  notes — with the parts that prefer it and its recent purchase orders. A part's supplier is chosen on the
  part form, and that is the group the reorder list files it under.
- **Price history is the orders themselves.** Each supplier shows the orders raised from it with their
  totals and dates, read from the `PurchaseOrder` rows rather than a second price table. What was paid is
  what the document says, so the two can never disagree.
- **Retired, never deleted.** A supplier still named by a part cannot be retired until those parts are
  pointed elsewhere — the form says how many and refuses. A retired supplier keeps its past orders and
  drops out of the part form's choices and of the reorder grouping.
- **Try it:** **Parts** → *Suppliers* → edit one of the three seeded suppliers and see the parts it
  supplies and the orders raised from it. Point a part at it on the part page, or clear the field to see
  the "no preferred supplier" group on *Reorder* grow.
- **Tests** — 6 unit tests (blank fields read as absent, an absent *Active* box means retired, the lead
  time as whole days, a bad email, and the storekeeper-only write) and a 5-case integration suite
  (`suppliers.test.ts`: the audit-rowed create and its duplicate-name refusal, the dispatcher's refusal,
  retiring a supplier a part still prefers and then allowing it once the part moves, a part pointed at a
  retired supplier, and the price history read back from its purchase orders).

## Slice 26 — stock take

- **Count a shelf, don't correct it by guesswork.** `/stock-takes` opens a session over one location — a
  warehouse, a bin, a van or a customer site — and snapshots what the books say for every line in scope (optionally
  narrowed to part numbers starting with a prefix). It is a **blind count** by default: the counter is not shown
  the system figure, because a count that matches the books is worth less than an honest one.
- **Count, review, recount.** `/stock-takes/[id]` lists every line with a counted field — blank means "not yet",
  which is not the same as zero — and, on a non-blind session, the system quantity and the running variance.
  Saving again is the recount. Once every line has a number the session moves to *Review* itself.
- **Approving posts the difference.** One correction per line that disagrees, through the same `adjustToCounted`
  the part page's count box uses: upward as an `ADJUST`, downward as a `WRITEOFF` with a reason, each carrying
  the count's `ST-YYYY-NNNN` reference. A line that already matches is left alone, so a delivery that arrived
  mid-count is reconciled rather than reversed. The page then becomes the read-only record of what was counted.
- **Try it:** **Parts** → *Stock takes* → *Open a count* on the seeded store, count a few lines, approve. The
  parts book's on-hand figures move and each part's movement list shows the adjustment with the reference.
- **Tests** — 10 unit tests (the variance sign and its rounding, the derived status, blank vs zero, a negative
  count) and an 8-case integration suite (`stock-takes.test.ts`: the opening snapshot, a downward correction
  posted once and the matching lines left alone, an upward correction needing no reason, the refusal of a second
  approval and of a half-counted session, one open session per location, a cancel posting nothing, the
  technician-counts / storekeeper-approves split, and an empty location).

## Slice 25 — reorder alerts and purchase orders

- **What to buy, from whom.** `/parts/reorder` takes everything below its reorder level and groups it by the
  supplier the catalogue prefers. Each part shows what is held, what it reorders at and a suggested quantity —
  the store's standing reorder quantity where it set one, otherwise enough to get back to the level. Parts with
  no preferred supplier are grouped together and named, with a link to set one.
- **Raising the order.** One button per supplier raises a numbered `PO-YYYY-NNNN` with those lines. Quantities
  are editable and blanking one leaves that part off; the cost is copied from the catalogue at that moment, so a
  later price change does not rewrite an order already sent.
- **Receiving moves the shelf.** The *On order* list shows every draft, sent and part-received order. A receipt
  posts one `RECEIVE` per line through `postMovement` — into one location, with an optional serial for a traced
  part — and advances the line's received quantity. The order's status is derived from what its lines have
  received: *Partly received* until every line is whole, then *Received*. More than a line still owes is
  refused, naming the remainder.
- **Try it:** **Parts** → *Reorder* — the seeded book has three suppliers and nine short parts. Raise an order
  from one group, then enter the quantities that arrived and post the receipt; the part's on-hand figure goes up.
- **Tests** — 17 unit tests (the suggested quantity, the status a receipt produces, what a line still owes, both
  forms, the permission split) and a 10-case integration suite (`purchase-orders.test.ts`: grouping and the
  exclusion of a restocked part, the numbered order with its cost snapshot and audit row, the refusal to order
  another supplier's part, the dispatcher's refusal, a receipt moving the level and the status, the serial kept,
  the over-receipt refusal writing nothing, no deliveries after the order is whole, and the open-order list).

## Slice 24 — serial and batch traceability

- **Which crane did this rope go on?** A part page now carries a **Serial and batch trace**: every serial or batch
  the ledger has seen for that part, how much of it is still held and at which locations, and every job it was
  issued to with that job's cranes. That is the question a recall asks, answered without a spreadsheet.
- **Derived, never typed.** A serial's position is worked out from the movements carrying it, using the same
  direction table that moves the shelf — so a trace and the stock figure cannot disagree.
- **Traced parts must say which one.** A part flagged *Trace by serial or batch* (wire rope, hooks, chain) can no
  longer be issued on a report without its serial. The phone checks it before queueing, the server checks it
  again and names the part, and the report stays on the phone until it is filled in.
- **A count keeps the serial, and an issue follows it.** A count correction posted against a serial moves the
  batch as well as the shelf, and a report that names a serial takes it out of the bin that actually holds it
  rather than the fullest one. A serial that somehow went out more times than it came in is flagged in red as
  *more issued than received*, with the fix named, rather than shown as a negative quantity.
- **Try it:** on a freshly seeded database, **Parts** → open a wire-rope line — the demo book flags rope, hooks and
  chain as traced and opens them as a batch — and the trace shows that batch and where it sits. On a database
  seeded before this slice, tick *Trace by serial or batch* on a part, receive some stock with a batch number,
  and the trace appears; the seed does not retrofit parts that already exist.
- **Tests** — 4 unit tests for the whereabouts arithmetic (receive/issue, transfer counted once, negative issue,
  three-decimal rounding), a 7-case integration suite (`traceability.test.ts`: whereabouts and issued jobs, the
  transfer case, a fully issued batch, a count that keeps its serial, an issue that follows its serial, an
  untraced part, the permission split), a report-submission case in `reports.test.ts` refusing a traced part
  with no serial, and `tests/e2e/parts.spec.ts`, which creates a traced part, receives a batch, transfers half
  of it and reads the trace back as the store and as a dispatcher.

## Slice 23 — stock locations and transfers

- **The store, the bins, the vans and the sites.** `/parts/locations` lists every place stock can be, what kind
  of place it is and what it currently holds. A bin can sit inside a warehouse. A location is retired, never
  deleted, because every movement that touched it keeps naming it — and one still holding stock cannot be
  retired until its stock is transferred out.
- **Stock moves between locations.** The part page carries a transfer form: from one location to another,
  posting a single `TRANSFER` row in the ledger and moving both levels. The source must hold what you move;
  unlike an issue, a transfer is refused rather than allowed to go negative.
- **Receiving finally offers everywhere.** The stock form used to list only the locations the part was already
  in, so stock could not be received into a new bin. It now offers every active location.
- **Try it:** **Parts** → *Stock locations* → add *Van 1* as a van; open a wire-rope line and transfer some of it
  from *Main store* to *Van 1*; the part shows two locations and the book's on-hand is unchanged.
- **Tests** — 6 unit tests (the transfer schema's both-ends rule and quantity, the location schema's checkbox
  and kind) and an 8-case integration suite (the audit row, the duplicate name, bin-inside-warehouse, the
  refusal to retire a location holding stock, the counts the list reports, a transfer moving both levels and
  leaving the total alone, the over-transfer refusal writing nothing, and the permission split).

## Slice 22 — the parts book and the stock ledger

- **A parts catalogue you can search.** `/parts` lists the book with part number, description, brand, what crane
  models it fits, on hand, the reorder level and the sell price. Search matches the number, the description or a
  crane model, and the brand dropdown narrows by maker.
- **"Below reorder" is a filter with a count.** A part with a level set and less than that on the shelf is
  flagged; a count at the top links straight to that view, which is the store's Monday morning list.
- **One part, in detail.** `/parts/[id]` shows on hand, the stock in each location, the part's own last twenty
  movements (with the job, the serial and where it went), and — for anyone holding `part.write` — the edit form.
- **The store posts movements, not totals.** *Received*, *Returned* and *Adjusted* are the three the screen
  offers. A count types what is on the shelf and the difference is written for you: up as an adjustment, down as
  a write-off. Nothing here lets you type a stock figure directly.
- **Underneath: the level finally moves.** Movements and the on-hand level are written by one function,
  `postMovement`, in one transaction. Issuing a part on a report now goes through it, so a part taken off the
  van for a job is no longer a ledger entry the shelf never noticed. Stock that was issued but never received
  goes negative and is shown in red rather than hidden.
- **Try it:** open **Parts** in the sidebar, filter to *Below reorder only*, open a line, receive ten into
  *Main store*, then fill in a report that uses the part — come back and watch on hand drop.
- **Tests** — 15 unit tests (the movement direction table, the reorder rule, the catalogue and stock-entry
  schemas, the filters) plus a 10-case integration suite (the permission split for technicians and finance, the
  duplicate part number, the search by crane model, the audit diff, a receipt moving the level, an issue moving
  it back, the count correcting both ways, and the refusal of a stock movement to finance), and an assertion in
  `reports.test.ts` that submitting a report now writes the level as well as the movement.

## Slice 21 — the accounting export, and Phase 2 proven end to end

- **The invoice book exports to accounting.** `/invoices` carries *Export invoices CSV* and *Export payments CSV*,
  which download a file (`/invoices/export?what=invoices|payments`) for a Xero or QuickBooks import. Amounts come from
  the issued invoice — its GST snapshot and its recorded payments — not from today's settings, so a file
  downloaded next year still says what the books said.
- **One seam, two formats later.** `AccountingExporter` in `src/server/accounting/accounting.ts` is the only thing
  the route knows about; a Xero or QuickBooks adapter is another implementation of it rather than a second route.
- **Phase 2 has an acceptance path.** `tests/e2e/phase2.spec.ts` walks the whole of it in one browser test: a
  compliance rule is added and adopted on a crane, owner changes raise the re-registration prompt, a certificate
  is uploaded and found on `/certificates`, a PM job is completed and its schedule rolls forward, the daily cron
  queues a reminder, a major finding becomes a follow-up job, a quote is accepted and invoiced, and the payment is
  recorded — then the two export files are checked.
- **It found two bugs, both now fixed.** The schedule form and the certificate form on a crane's own page posted
  no `craneId` (the dropdown only exists on `/schedules`), so every submission from a crane page was refused.
- **Tests** — 6 unit tests for the exporter (which invoices are exported, the header and one row per invoice in
  exact amounts, payments against their invoice, quoting a comma in a customer name, a header-only file) plus 2
  integration cases (a technician is refused; finance exports the billed invoice and its payments, and a filter
  that matches nothing yields a header-only file).

## Slice 20 — invoicing, GST and payments

- **An invoice is raised from a job that has been reviewed.** On a job page, *Raise an invoice* starts from the
  parts actually issued on that job — read from the stock ledger, so the bill and the delivery order describe
  the same parts — each at its sell price. You add labour lines by hand and edit anything before it goes out.
  A job that has not been signed off cannot be invoiced, and the screen is not offered for one.
- **GST is computed, never typed, and fixed the moment the invoice is issued.** Lines are rounded to the cent,
  summed, and GST applied once at the settings rate. Issuing re-reads the rate in force *and the amount it
  produces*, so a bill can never say 10% beside a charge worked out at 9%.
- **Issue, and the job moves on.** Issuing stamps the issue date, works out the due date from the customer's
  payment terms, moves the job `Reviewed → Invoiced` with its history row, and numbers the document
  `INV-YYYY-NNNN`. Voiding keeps the invoice and needs a reason.
- **Payments drive the status.** Record what came in, by what method, with a reference; the invoice becomes
  *Partly paid* or *Paid* because the money says so, not because someone chose a status. An overpayment is
  refused and says what is still owed — that is a credit note, which this slice does not do.
- **The invoice book.** `/invoices` lists every invoice with per-status counts, what is still outstanding, and
  *Overdue* on an unpaid issued invoice past its due date (worked out from the date, like a quote's expiry).
  The invoice itself shows the charges, the payments so far and what to do next, and downloads as a PDF headed
  *Tax invoice*.
- **Finance owns invoicing.** Only finance and admin can read or raise an invoice — dispatch, store and the
  field cannot — and the server refuses before it queries.
- **Try it:** take a seeded job through to *Reviewed*, raise an invoice from its parts, add a labour line, issue
  it, then record a part payment on the invoice page. The list is under **Invoices** in the sidebar.
- **Tests** — 18 unit tests (the status flow, the derived paid status, overdue at the timezone day boundary, the
  money arithmetic shared with quotes, the schemas, permissions, and the PDF's byte-stability) plus a 17-case
  integration suite covering numbering, the reviewed-job rule, the GST snapshot at issue, the job move and its
  history, draft-only editing, void rules, partial and full payment, the overpayment refusal, costing from stock
  movements, and the capability checks.

## Slice 19 — quotes and variations

- **A quote is raised from the job.** On a job page, *Raise a quote* takes lines of description, quantity and
  unit price, and marks a line as a *Variation* so extra work is visibly separate from the quoted scope. The
  job's open findings appear above the form; one click copies a recommendation into a variation line.
- **GST is computed, never typed.** Each line is rounded to the cent, the subtotal is their sum, and GST is
  applied once at the rate in the settings. The rate is saved on the quote, so a reprint months later shows the
  rate it was priced at.
- **Send, accept, decline.** Sending a draft puts it in front of the customer; their answer is recorded with an
  optional note. Accepting a quote on a job awaiting one moves that job `QUOTED → APPROVED` through the normal
  status machine, so the history row and the audit entry are the same event. Declining leaves the job where it is.
- **Expiry is the date, not a status someone has to remember to set.** A sent quote past its *valid until* shows
  as *Expired* everywhere, cannot be accepted, and cannot be sent once the date has already passed. Raising a
  replacement quote is the way forward.
- **Every quote is numbered `QTE-YYYY-NNNN` and downloads as a PDF** headed *Quotation* with the customer, job,
  validity, lines, totals and a plain statement that it is not a tax invoice. `/quotes` lists them all with
  sent/accepted/draft/expired counts; finance can read them but not raise one.
- **Also wired here:** completing a follow-up job now marks the finding it was raised for as *Rectified*, with an
  audit row, in the same transaction as the status change.
- **Try it:** open a seeded job, raise a quote, then send it — the job moves to *Quoted*. Accept it and it moves
  to *Approved*. The quotes list is under **Quotes** in the sidebar.
- **Tests** — 16 unit tests (the money arithmetic and rounding, the status flow, derived expiry at the timezone
  day boundary, the schemas, and the PDF's byte-stability) plus a 10-case integration suite covering numbering,
  GST, the job moves and their history, expiry refusals, draft-only editing, and the capability/scoping checks;
  one new integration test proves the completed follow-up job rectifies its finding.

## Slice 18 — delivery orders

- **The delivery order is built from what the store already issued.** On a job page, *Raise a delivery
  order* lists the parts recorded as issued on that job and not already on a DO. You tick the ones going
  out and set the terms — chargeable, warranty, or loan with an expected return date — and condition.
  There is no quantity box: the quantity is the movement's, so the paper and the stock ledger cannot
  disagree (CLAUDE.md rule 10).
- **One part, one document.** Raising the DO claims those stock movements in the same transaction, so a
  part cannot be put on a second DO. Trying is refused by part number.
- **Partial delivery works.** Record who took the parts, how many of each, and their signature. A van that
  brings three of five leaves the DO *Partly delivered*; a second handover fills in the rest and it becomes
  *Delivered*. The status is computed from the quantities, never typed.
- **Loan kit is chased and closed.** A loan line shows how many are still out. Recording the return moves
  the DO to *Returned* once everything is back. A chargeable or warranty line cannot be "returned" — it is
  the customer's.
- **Every DO is numbered `DO-YYYY-NNNN` from when it is raised and downloads as a PDF** with the parts,
  serials, terms, condition notes and the receiver's signature. It is rendered on demand: unlike an
  approved report it changes as it is receipted, and an unchanged one re-downloads byte for byte.
- **Try it:** a seeded technician issues a part on a job (the offline report's parts list does this), then
  open the job in the office and raise a delivery order from it.
- **Tests** — 20 unit tests (the derived status and outstanding-loan rules, the schemas, and the PDF
  renderer's byte-stability) plus a 13-case integration suite covering the foreign/re-used/non-issued
  refusals, partial then complete receipt, loan return, the capability checks, technician scoping, and the
  audit rows.

## Slice 17 — the load test and visual inspection reports, complete

- **The load test asks everything brief §6.3 asks for.** The test load; the radii tested with the SWL
  and the result at each; the instruments used with a load cell ID, its serial and its calibration due
  date; the pre-test and post-test examination; deflection and any abnormality; whether an Authorised
  Examiner attended and their name and firm; and the final outcome.
- **The visual inspection covers the same brief**: structure, safety devices, markings and load charts,
  wire rope and hook, operator controls, findings with a severity and recommendation each, photographs,
  and an overall condition rating of *Good / Fair / Poor*.
- **A lapsed calibration is pointed out, not blocked.** On the instruments table the phone compares each
  row against the equipment register **on the test date** and, when an instrument had gone out of date
  before it was used, shows an amber panel naming it and the date — and says plainly that the report can
  still be submitted, because a form that refuses to save on a phone with no signal is a lost report.
  The same check appears on the office report page when the reviewer opens it. An instrument the
  register has never heard of is left alone: hired test weights are normal.
- **The old reports still say what they said.** The two templates are **version 2**; anything signed
  under version 1 keeps its answers and re-renders exactly as issued. The seed moves the job type onto
  v2 only if it was still on v1 of the same template.
- **Try it:** raise a load test job, book a load cell whose calibration date is in the past (the
  schedule board's resource booking, or the database), fill the report on the phone with that cell's
  serial and a test date after it lapsed, and watch the amber panel appear.
- **Tests** — 9 unit tests (the two completed shapes, and six cases for the calibration check: a lapsed
  recorded date, an in-date one, a register that disagrees, a register with no date, an unknown serial,
  and no test date yet) and one integration test proving the phone's sync sends only the instruments
  booked on that technician's own jobs.

## Slice 16 — findings become follow-up jobs

- **A finding has a life after the report.** Each defect a report raises moves through *open →
  quoted → scheduled → rectified*, or ends *declined by the customer*. The state is shown on the
  report that raised it and in an **Open findings** section on the crane page, so "what is still wrong
  with this machine" is one screen.
- **One click raises the job.** *Raise a follow-up job* on a finding pre-fills the kind of work, the
  crane, a description drafted from the defect, and a priority from the severity (critical and major
  both start at P2 — a follow-up never pages dispatch for a crane the inspection already returned to
  service). The job carries `parentJobId`, the finding carries `followUpJobId`, and both the job and
  the link are written in one transaction, so a finding cannot point at a job that was never raised.
  The job page lists its follow-ups and the finding links to the job.
- **A refusal is a signed record.** *Customer declined this repair* takes their name, the date and a
  signature drawn on the screen, uploads it through the same signed-URL path the phone uses, and keeps
  it with the finding — visible on the report as "Declined by …, their signature". The status form
  cannot produce a decline; only that acknowledgement can.
- **Try it:** open a submitted report with a finding, move it to *Quoted*, then *Raise a follow-up
  job* and follow the link to the new job.
- **Tests** — 12 unit tests on the flow as data (transitions, terminal states, the priority cap, the
  status schema refusing a decline) and 10 integration tests (the audit row, an illegal move refused,
  technician scoping, a decline needing a signature and a recommendation, one follow-up job only,
  and the capability required to raise one).

## Slice 15 — the daily reminder scan

- **`/api/cron/daily` reminds the office before an obligation lapses.** Every live crane schedule is
  evaluated at its own offsets (90/60/30 days by default, configurable per schedule), then once when
  it is overdue. The reminder goes to every active Admin and Dispatcher, by email and as an in-app
  row, through the same fan-out a P1 uses.
- **It cannot send the same reminder twice.** Each send is claimed in `ReminderDispatch`, unique per
  schedule, threshold and due date, so a retried cron run is a no-op — and a schedule that is
  completed and rolled forward starts a fresh period.
- **It can raise the job as well as the reminder.** Tick *Raise a draft job when this becomes due* on
  a schedule and choose the kind of work; on the day it falls due, the scan creates a NEW job for that
  crane at the site, with normal numbering, SLA targets and an audit entry naming the schedule.
- **Try it:** create a schedule on a crane due in the next few weeks, then hit the endpoint with
  `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily` (the secret is
  optional in development) — the JSON reports how many schedules were evaluated and how many
  reminders and jobs it raised. In development the email is written to the server log.

## Slice 14 — compliance rules, adoption and re-registration prompts

- **`/admin/compliance`, the rulebook.** Every rule with its kind of crane, obligation, interval,
  whether an AE is required, its effective window, the source it came from, the date it was last
  reviewed and how many live schedules use it. Admins add and edit rules under
  `compliancerule.manage`; the standing notice — *Rules are configured by your team. Verify against
  current MOM requirements with your Authorised Examiner.* — is shown verbatim from
  `Setting.complianceNotice`.
- **Source and review date are required.** A rule cannot be saved without both, so a question about a
  crane can be answered with the circular it came from. Saving records who reviewed it.
- **A schedule can adopt a rule.** The crane's schedule form offers the rules in force for that kind of
  crane; choosing one copies its obligation and interval and records the citation on the schedule
  (`source = RULE`). The crane page shows "from '<reference>'" beside the obligation.
- **One rule at a time per crane type and obligation.** A second rule whose effective window overlaps
  a live one is refused — give the old rule an end date before adding its replacement.
- **"Re-registration may be required".** Changing a crane's owner of record or moving it to another
  site, or changing the customer's UEN, raises an amber prompt on the crane saying what changed and
  when. Anyone with `crane.write` can mark it as checked; the check goes into the audit log.
- **Try it:** as an Admin, open `/admin/compliance` and add a rule for an overhead crane and an annual
  examination, then open a crane of that type, add a schedule, and pick the rule — the interval comes
  from the rule. Edit the crane's owner and watch the prompt appear.

## Slice 13 — the certificate register and the compliance queue

- **Every crane's paper, on its page.** Kind, certificate number, issuer, issue date, expiry, next due,
  stated SWL and the linked job, with the scan itself downloadable. Under `certificate.write` the
  section adds, edits and archives a certificate; archiving is a soft delete, so the record, its file
  and its audit trail stay.
- **`/certificates`, the compliance queue.** Everything visible soonest-expiring-first, with search
  (asset tag, customer, site, number, issuer), an expiring bucket (overdue, 30, 60, 90, no date) and a
  kind filter, plus a count line. The dashboard's "Certificates expiring" tile reads the same service
  and links to the 30-day filter.
- **A statutory certificate stays distinct from our work.** Only the Authorised Examiner's certificate
  of test and examination is labelled "AE statutory certificate"; every other document is a "Supporting
  document". Our technicians' reports are company inspections and appear on the crane timeline, never
  in this register.
- **Uploading a scan** uses the same signed-URL flow as the phone's photographs — a PDF or an image up
  to 5 MB, stored in Supabase Storage (or local disk in development) with `FileKind.CERTIFICATE`.
- **Try it:** open a crane from `/cranes`, add a certificate with an expiry a few weeks away under
  *Certificates*, then open `/certificates` — it appears in the 30-day bucket and the dashboard tile
  counts it.

## Slice 12 — schedules on the crane page

- **A crane's obligations, on its own page.** Kind, interval, last done, next due, days remaining or
  overdue, and whether it was configured by hand or by a compliance rule. Under `schedule.manage` the
  section also adds a schedule and ends one per row — ending is a soft delete, so the record and its
  audit trail survive a past reminder or job that referred to it.
- **`/schedules`, the list the dashboard links to.** Everything visible soonest-due-first with search
  (asset tag, site, customer), a due bucket (overdue, 30, 60, 90, no date) and a kind filter, plus a
  count line at the top. Visible in the nav for anyone who may read cranes; a technician sees only the
  obligations on cranes they are assigned work at.
- **The dashboard tells the truth about it.** "Services / exams due" and "Schedules overdue" both read
  the schedule service rather than a query of their own, so a tile cannot disagree with the list it
  links to. Overdue is computed from the clock on every read — nothing stores it and no cron flips it.
- **Completing a job can complete the obligation.** The job's completion form offers the schedules on
  that job's cranes as checkboxes; ticking one records the work against the job's completion date (not
  "now") and moves the obligation on by its interval, in the same transaction as the status change.
- **Try it:** open a crane from `/cranes`, add a monthly service with a last-done date in the past, then
  look at `/schedules` — it appears under *overdue*. Complete a job at that crane and tick it, and the
  due date moves a month on.

## Slice 11 — the whole job, end to end

- **One path, proven instead of described.** `tests/e2e/happy-path.spec.ts` takes a P1 breakdown
  call from the phone onto a report and out as a customer PDF: record the ticket, triage it, turn it
  into a job, move it to the board, set the visit, assign a technician who holds the competency,
  dispatch it, sign in on the phone, cut the network, fill the report with a photo and both
  signatures, submit, reconnect, watch it sync, move the job through *in progress* and *completed*,
  approve the report and download the numbered PDF. It creates everything it uses and deletes it
  afterwards, and it runs in the desktop project only — the phone half at 390px and offline is
  `tests/e2e/report.spec.ts`, which already runs twice.
- **A demo estate to try it on** (`npm run seed`): 8 customers, 26 cranes with service and exam
  schedules, 30 completed jobs with issued reports on the crane timeline, 2 open P1 tickets on the
  board, and a parts store with 9 lines below reorder level. The full contents are under "Demo data"
  above.
- **Known limit:** "nearest qualified technician" is a competency check, not a distance — the data
  model has no technician location (`docs/ASSUMPTIONS.md` 81).

## Slice 10 — the job list, the dashboard and the audit log

- **The company-wide job list** at `/jobs` filters by search text (job number, customer, asset tag or
  PO reference), status, priority, SLA state, technician, kind of work and a visit-date range, and
  sorts by working order, newest first or visit date. Every control is a URL parameter, so a filtered
  list is a link somebody can send.
- **A six-week calendar** in the same screen, one square per local day, visits filed by their wall
  date in the operating timezone and P1s picked out in red.
- **Saved filters** under the list are yours alone: name the view you are looking at and it comes
  back as one click. Saving the same name again replaces it. They are not audited — renaming a
  personal view is not business data.
- **Export CSV** downloads exactly what the screen is showing, because both run the same query.
- **The office dashboard** answers the morning's questions — open P1s, SLA breaches, late visits and
  work awaiting invoicing, each a count that links to the list that answers it and says how it has
  moved since yesterday — then today's visits and who is on call now, then only the panels that have
  something in them: on-hold work by reason, the next 30 days of booked visits, services and exams
  due, and certificates expiring. A technician signing in sees their own entry point instead of a
  company-wide board. Environment state (database, timezone, clock, your capabilities) lives at
  `/admin/system`, not on the board.
- **The sidebar** is five destinations — Today, Work, Register, Money, Admin — and only the area you
  are in lists its pages; the others are one link each, with a dot when something inside them is
  unread. Fewer links on screen was the owner's note after the 31 Oct 2026 design review
  (`docs/UI-REVIEW.md`).
- **The audit log** at `/admin/audit` (Admin only, `audit.read`) searches every create, change and
  deletion by record type, record id and date, and shows what actually changed field by field. Jobs
  and cranes carry the same panel on their own pages, so "who changed what" is one click from the
  record.
- **Known limit:** the SLA filter is applied after the rows come back, over a 2,000-row cap, because
  "breached" is a function of a stored deadline and the clock rather than a column
  (`docs/ASSUMPTIONS.md` 75).

## Slice 9 — approving a report, and the document it becomes

- **A reports queue** at `/reports` (in the main nav for whoever holds `report.approve`) lists what
  the field has signed, oldest first, and what was sent back.
- **Approving issues a document.** One transaction assigns the next `RPT-2026-0001` number, renders
  the PDF with both signatures and the photographs embedded, stores it, locks the report, moves the
  job from COMPLETED to REVIEWED, and writes an audit entry for each. The customer is emailed
  afterwards — a dead mail server cannot undo an issued document, and `emailedToCustomerAt` left null
  is what `/api/cron/daily` retries.
- **The PDF is reproducible.** It is rendered from the template *version stored on the report* and
  the answers stored with it, with the document timestamps pinned, so an old report re-renders exactly
  as issued even after the office has superseded its template. The integration test proves it by
  re-rendering an approved report after a template change and diffing the SHA-256 against the stored
  file.
- **Nothing issued is edited.** A correction is an amendment: a copy of the answers with a reason,
  linked to the original, issued with its own number when approved. The original keeps its number and
  its PDF and is marked superseded. Only one amendment can be open at a time.
- **Sending one back** records a reason the technician sees, and never assigns a number.
- **The crane page's timeline is populated** with every report on that machine — numbered, dated, and
  flagged when it is an amendment.
- **To try it:** sign in as `dispatch@cimmeriancrane.example` / `cimmerian-dev-2026`, finish the
  phone report as Ahmad (above) so one is submitted, then open **Reports**, approve it, and follow the
  job and crane links. The PDF link is on the report page.
- **Tests** — 3 unit tests that pin the renderer's determinism and that a changed template version
  changes the document, 7 integration tests (number + stored PDF + job move, double approval refused,
  a technician refused the capability, sending back with a reason, amendment linking and superseding,
  one open amendment at a time) including the re-render diff, and an end-to-end test that approves a
  report through the UI and finds it on the crane timeline.

## Slice 8 — completing a report on the phone

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
  If the signal returns while a sync is still running, the second sync waits for the first rather than
  being dropped — otherwise the report the technician just finished can sit on the phone unsent.
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

## Slice 7 — the technician's phone

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

## Slice 6 — scheduling, dispatch and the on-call roster

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

## Slice 5 — tickets become jobs, and the job lifecycle

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
  SLA target, and jobs on hold. The fuller list, with every filter, the calendar, saving a view and
  the CSV export, arrived in slice 10.
- **Tests** — 16 unit tests for the transition map, hold rules, timestamp fields and job validation;
  17 integration tests for numbering, SLA snapshots, history and audit rows, one-way stamps,
  cross-customer and two-site refusal, conversion, capability checks and soft-deleted visibility.

## Slice 4 — job types, templates and tickets

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
  ticket: an in-app notification, an email through the adapter (console implementation in Phase 1),
  and — slice 36 — an SMS and a WhatsApp message where that user has a phone number recorded at
  `/admin/users`. Each channel is its own row, so a failed send is visible rather than swallowed, and
  the phone channels carry one line and a link rather than the full text. `SMS_DRIVER` and
  `WHATSAPP_DRIVER` default to `console`, which logs the message and records the row as sent; the
  named production drivers (`twilio`, `meta`) are declared and not yet implemented, and fall back to
  console with a warning so an alert is never silently lost.
- **Close, cancel and reopen**: both outcomes stamp `closedAt` and append the note to the ticket
  rather than replacing the triage decision. Reopening returns it to NEW with the clock running
  again — raising a duplicate instead would split the history.
- **Technician tickets**: a technician can raise a ticket and see the ones they raised, but not the
  intake board. `ticket.triage` stays with the office.
- **Tests** — SLA boundary arithmetic, ticket validation and transitions, the template catalogue, and
  integration coverage for numbering, audit rows, the one-way stamps, cross-customer crane checks,
  P1 fan-out and technician isolation.

## Slice 3 — sites and cranes

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

## Slice 2 — customers and contacts

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

## Slice 1 — authentication, roles and permissions

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

## Slice 0 — foundations

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
