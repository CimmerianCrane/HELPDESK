# PLAN-SLICES.md — every slice as built

The canonical record of each slice's fixed decisions, split out of `docs/PLAN.md` §7 so that §7
reads as a plan. The §7.x numbering is kept. Slice tables and phase notes are in `docs/PLAN.md`
§7.1–7.2 and §7.13–7.14.

## 7.3–7.12 The slices as built

### 7.3 Slice 12 — schedules on the crane page (**built**)

**Goal:** the schedules that already exist in the database become visible, editable and self-maintaining.

Fixed decisions for this slice (record any new ones in `ASSUMPTIONS.md` as items 84+):

1. **The schedule list and the crane page read through one service.** `listSchedules(context, filters)` spreads
   `craneReadWhere(context)`, so a technician sees only schedules on cranes they can read; the dashboard count at
   `dashboard.ts:118` is replaced by a call to the same service so the tile and the list cannot disagree (the slice-10
   lesson).
2. **"Mark schedule done" is explicit, not inferred.** Completing a job shows the schedules on that job's cranes with a
   checkbox; accepting one writes `lastDoneDate = job.completedAt` and `nextDueDate = lastDoneDate + intervalMonths` in
   the same transaction as the status change, audit-logged. A JobType → ScheduleType mapping is **not** invented in code
   — that mapping arrives with `ComplianceRule` in slice 14, which is the rule-2 requirement.
3. **Overdue is computed, never stored.** `nextDueDate < now` is the state; no `overdue` column, no cron to flip it.
   `nextDueDate` recomputation is a pure function (unit-tested) so the cron, the admin screen and the job completion all
   share it.
4. **No new dependency, no new capability.** `schedule.manage` already exists and is granted to Admin and Dispatcher;
   the form uses the existing `inputClass` / action-result pattern, not a new form library path.

Build order: `scheduleReadWhere` in `src/server/auth/scope.ts` → `src/server/schedules/schedules.ts` (list, create,
update, archive, `recomputeNextDue`, `markDone`) with unit tests for the pure recompute and integration tests for the
schedule, audit and technician-scope cases → actions in `src/app/(office)/schedules/actions.ts` → the crane page block
→ `/office/schedules` list + dashboard link → the completion checkbox on the job → seed unchanged (it already writes
schedules) → `npm run verify:full`.

**As built.** `craneScheduleReadWhere` (`scope.ts`); `src/server/schedules/recurrence.ts` (pure `addMonths`,
`recomputeNextDue`, `isOverdue`, `daysUntil`, `dueBucket`, 15 unit tests) and `src/server/schedules/schedules.ts`
(`listSchedules`, `schedulesForCrane`, `scheduleCounts`, `schedulesForJobCranes`, `createSchedule`, `updateSchedule`,
`archiveSchedule`, `markSchedulesDone`, `dueLabelFor`); `CraneSchedule.deletedAt` + migration `20261028100000`; the
crane page's Schedules section with per-row End and an add form; `/schedules` with the q / due / kind filters and the
counts line; the dashboard's two schedule tiles reading through `scheduleCounts`; and the completion checkboxes carried
by `transitionJob`'s own form. `markSchedulesDone` is called inside `transitionJob`'s transaction, so a completion and
the due dates it rolls forward commit together.

Two deviations from the text above, both deliberate: the checkbox lives in the **existing transition form** rather than
a separate "mark done" action (one write, one transaction — a second action would need its own permission check and its
own way to be called twice), and `markSchedulesDone` requires `schedule.manage` even though the caller is the same
dispatcher who is transitioning the job.

**Verified.** Migration `20261028100000_slice12_crane_schedules` is applied to the hosted database.
`npm run verify` (248 unit tests), `npm run test:integration` (205 tests), `npm run test:e2e` (35
passed, 2 skipped) and `npm run build` all pass, and `tests/e2e/happy-path.spec.ts` passes unmodified.
It shipped in the same commit as the pre-existing performance pass noted in `KICKOFF.md`, which the
commit message names so a later `git log` does not read it as schedules work. Slice 12 has one known
gap, recorded in `ASSUMPTIONS.md` 84: an archived schedule is invisible outside the audit log, because
`/schedules` has no "ended" view yet.

**One build trap found here, since fixed.** `npm run build` and `npm run dev` used to share `.next`, so
building against a live dev server corrupted both (the build died on
`Invariant: no direct app page entry found for /login`, then every dev route 500s). Next.js 16 now
separates them natively — `next dev` writes `.next/dev` and a build still lands in `.next` where
Vercel expects it — so the `distDir` switch this fix originally used is gone from `next.config.ts`,
and stopping the dev server first is no longer needed. `npm run dev:stop` stops whatever holds the dev port, for the remaining case — a schema
change still needs the dev server restarted, because it keeps serving the Prisma engine it started
with.
### 7.4 Slice 13 — certificates and the compliance dashboard (**built**)

**Goal:** the `Certificate` model stops being a table nothing writes. A crane's paper — the AE's
certificate of test and examination, load test certificates, calibration and registration documents —
gets a register, a queue sorted by what is about to lapse, and a dashboard count that agrees with it.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 88–91):

1. **One service behind every screen.** `src/server/certificates/certificates.ts` is the only query
   path: the crane page, `/certificates` and the dashboard tile all read through it, so the tile cannot
   say "two expiring" while the list shows three. `certificateReadWhere` follows `craneReadWhere`, so a
   technician sees certificates on cranes they are assigned work at and nobody else's; office roles
   with `crane.register.read` see the register. Writes need `certificate.write`, which already existed.
2. **The effective date is `expiryDate ?? nextDueDate`**, computed on every read through the existing
   `dueBucket` (overdue / 30 / 60 / 90 / later / none). Nothing stores "overdue". `expiryDate` is what
   the tile has always counted; `nextDueDate` is the fallback for a renewal that falls before expiry.
3. **Company inspection stays distinct from a statutory certificate.** Only
   `STATUTORY_TEST_EXAMINATION` is labelled "AE statutory certificate"; every other type is a
   "Supporting document". Both the crane section and `/certificates` say in words that our reports are
   company inspections and appear on the timeline, never in this register (CLAUDE.md rule 3).
4. **Uploads reuse the signed-URL route, not a server action.** `/api/files/upload-url` now branches
   on `kind: 'CERTIFICATE'`, checks `certificate.write`, creates a `File` row owned by the crane
   (`entity: 'Crane'`, `kind: FileKind.CERTIFICATE`) and returns the same short-lived upload URL the
   phone uses. The certificate write then verifies the file is a certificate for that same crane. The
   form uploads on file selection, so a scanned PDF never passes through a function body.

Build order: `certificateReadWhere` → `src/lib/validation/certificates.ts` → the service (list,
per-crane, counts, create, update, archive) → actions → `/certificates` → the crane page section →
the dashboard tile → integration tests → docs.

**As built.** `src/server/certificates/certificates.ts` (`listCertificates`, `certificatesForCrane`,
`certificateCounts`, `createCertificate`, `updateCertificate`, `archiveCertificate`,
`certificateDueDate`, `certificateDueLabel`); `certificateReadWhere` in `scope.ts`;
`src/lib/validation/certificates.ts` (types, labels, date rules, upload schema);
`src/components/office/certificate-forms.tsx`; the crane page's Certificates section with add, edit and
archive; `/certificates` with a q/due/kind filter and a count line; the nav link; the dashboard's
"Certificates expiring" tile now counting the 30-day window through `certificateCounts` and linking to
`/certificates?due=30`; and the upload branch in `src/server/storage/files.ts` (PDF and images allowed
for `CERTIFICATE` only). **No migration was needed** — the `Certificate` model, its `deletedAt` and the
`FileKind.CERTIFICATE` enum value all already existed. New integration coverage:
`tests/integration/certificates.test.ts` (7 tests: audit on create, technician scoping, soft delete,
changed-fields-only update, bucket counts, a role without `certificate.write`, and a linked job that
does not cover the crane).

**Known limit, not a gap in this slice:** `Certificate` has no Prisma relation to `File` (only
`fileId`), so the list resolves file names and signed links in one batched lookup rather than an
`include`. Adding a relation would be a schema change for a lookup this cheap; revisit if certificates
ever need to be joined through files.
### 7.5 Slice 14 — compliance rules, adoption and the re-registration prompt (**built**)

**Goal:** `ComplianceRule` stops being a model with a capability nobody consumes. Rule 2 — intervals,
AE requirements and legal references are data, editable by Admin, each carrying its source and review
date — becomes provable in the UI, and a crane's obligations can cite a rule instead of being typed
free-hand.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 92–97):

1. **`ComplianceRule` itself needed no schema change.** `sourceReference` was already `String`
   (required at the database level) and `reviewedAt` already existed. The brief's "required
   `reviewedAt`" is enforced in Zod, where the form lives, so the column stays nullable and a rule
   written by an earlier slice or by a script is not retro-invalidated. The only migration adds the
   two `Crane` prompt columns.
2. **Two capabilities, deliberately different.** `compliancerule.manage` (Admin only) reads and
   writes the rulebook — that is the configuration itself. A dispatcher configuring a crane only
   needs `schedule.manage` on `rulesForCraneType`, which returns the in-force rules for one crane
   type so they can be adopted. The nav link follows `compliancerule.manage`, which also keeps the
   `/admin/*` layout's `user.manage` gate honest: only an Admin ever reaches the page.
3. **Adopting a rule copies its kind and interval.** `createSchedule`/`updateSchedule` resolve the
   rule, verify its `craneType` matches the crane and that `isRuleInForce` says yes today, then write
   `source = 'RULE'`, `ruleId`, and the rule's `scheduleType`/`intervalMonths`. The form's own values
   are ignored when a rule is chosen — a citation that does not describe the cadence is worse than
   none. The kind of obligation cannot change on an existing schedule at all.
4. **One rule in force per `craneType × scheduleType`.** `assertNoOverlap` refuses a new or edited
   rule whose effective window overlaps a live one, with the message telling the office to end the
   old rule first. Two live rules would leave `CraneSchedule.ruleId` recording whichever was adopted
   first.
5. **The re-registration reminder is a stored prompt on the crane**, not a `Notification` row: there
   is no in-app notification inbox anywhere in the app, so a notification would be invisible. Owner
   change and site move are detected in `updateCrane`; a customer UEN change fans out to every live
   crane under that customer through `raiseReregistrationPrompt`. `acknowledgeReregistration` clears
   it and audits the check. The wording says "may be required" — only the AE can say for certain.
6. **No seeded rules.** Seeding an interval would be inventing a regulatory fact (CLAUDE.md rule 2),
   so the screen ships with an empty state that says what adopting a rule does.

**As built.** `src/server/compliance/rules.ts` (`listComplianceRules`, `rulesForCraneType`,
`createComplianceRule`, `updateComplianceRule`, batched `adoptedCounts`, `findOverlap`);
`src/lib/validation/compliance.ts` (schemas plus the pure `isRuleInForce`);
`/admin/compliance` with the notice verbatim, the rule table (state, dates, adopted count, inline
edit) and an add form; `src/components/office/compliance-forms.tsx`; the rule select on the crane's
schedule forms; `ScheduleSummary.ruleId`/`ruleReference`/`requiresAE` and the citation on the crane
page; the amber re-registration banner and its acknowledge button; `reregistrationRequiredAt`/
`reregistrationReason` on `Crane` (migration `20261028200000`); `ComplianceRule` in the audit
viewer's entity list, links and labels. New coverage: `tests/unit/compliance.test.ts` (9) and
`tests/integration/compliance.test.ts` (9).

**Known limit:** ending a rule does not rewrite the schedules already citing it. A schedule keeps its
copied interval and its `ruleId`, which is the honest record of what it was based on; the rule simply
stops being offered for new adoptions. Re-pointing existing schedules is a deliberate edit, not a
cascade.

**Carry-over — queue these, do not lose them.** Each was noticed while building slice 14 and is small
enough to ride along with the slice that touches the same file:

1. **A Playwright path for `/admin/compliance`.** The screen is proven by its services and by the
   integration suite, but no browser test walks it — add rule → adopt it on a crane → change the
   owner → see the prompt → mark it checked. Slice 17 edits the report form and template
   definitions, not a rule screen, so take this with whichever slice next touches
   `/admin/compliance`. Put it in `tests/e2e/` as its own spec; it must not touch the seeded
   estate destructively (build its own customer/crane, as every post-slice-11 spec does).
2. **A way to see ended rules.** `listComplianceRules` returns everything, but the admin table shows
   no state filter, so a rulebook that has superseded three rules reads as three dead rows. Same gap
   as slice 12's ended schedules (§7.3): a filter, not new architecture.
3. **Re-pointing the schedules that cite a superseded rule**, if the office asks for it. Deliberately
   not built — it would rewrite intervals on live obligations. It belongs behind an explicit action
   that lists the schedules first, never a cascade on saving an end date.
### 7.6 Slice 15 — the reminder engine in the daily cron (**built**)

**Goal:** `CraneSchedule.nextDueDate` stops being a number the dashboard computes from. The daily cron
evaluates every live schedule at its own offsets, tells the office, and — when the office asked for it
— raises the job.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 98–101):

1. **One claim makes the run idempotent.** `ReminderDispatch` is unique on
   `(scheduleId, offset, period)`. `period` is the due date as a day in the operating timezone, so a
   schedule that is completed and rolled forward starts a new period. The claim uses
   `INSERT … ON CONFLICT DO NOTHING` rather than create-and-catch: a failed statement aborts a
   surrounding Postgres transaction, and the claim and the draft job it permits should commit together.
2. **"The account owner" is Admin + Dispatcher.** No per-customer owner exists, and inventing one is a
   product question. The reminder uses the P1 fan-out unchanged, through a new
   `notifyOfficeOfReminder` export rather than a second send loop.
3. **A job needs a kind of work the office chose.** `CraneSchedule.draftJobTypeId` is picked on the
   schedule form and required whenever the box is ticked. Which job completes which obligation is not
   mapped in code (rule 2, and slice 12's decision 2 stands). The job is raised only on or after the
   due date, with no actor, the job type's default priority, normal SLA targets, and an audit entry
   naming the schedule.
4. **Two limits, stated rather than hidden.** A threshold missed during an outage is not backfilled
   (the next still-open one fires), and "overdue" fires once per period rather than daily — the
   dashboard's overdue count is the ongoing signal.

**As built.** `src/server/reminders/reminders.ts` (`runScheduleReminders`, `remindForSchedule`,
`reminderOffsetFor`, `reminderScheduleSelect`); `notifyOfficeOfReminder` and a shared `fanOut` in
`src/server/notify/notify.ts`; `createSystemJob` and the extracted `insertJob` in
`src/server/jobs/jobs.ts`, so a cron job gets the same numbering, SLA snapshot and status history as
any other; the draft-job-type select on the schedule form and its two server call sites; the cron route
now runs the scan and reports it; migration `20261028300000_slice15_reminders` (`draftJobTypeId` plus
the `ReminderDispatch` table). New coverage: `tests/unit/reminders.test.ts` (6) and
`tests/integration/reminders.test.ts` (6).

**Known limit:** the in-app `Notification` rows the fan-out writes are still invisible — there is no
inbox screen anywhere in the app yet (`ASSUMPTIONS.md` 96 and 100). Email is the channel that works
today; an inbox is its own slice, and would serve P1 alerts and reminders together.
### 7.7 Slice 16 — findings and one-click follow-up jobs (**built**)

**Goal:** a defect a report raised stops being a line in a PDF. It has a state, it is visible on the
crane it is against, and the office can turn it into the job that fixes it in one click.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 102–105):

1. **Declining goes through its own action, not the status form.** `updateFindingStatusSchema` does not
   accept `DECLINED_BY_CUSTOMER`; that state is reachable only via `acknowledgeDecline`, which demands a
   name, a date and an uploaded signature `File`. The status machine itself (`ALLOWED_FINDING_TRANSITIONS`
   in `src/lib/validation/findings.ts`) is pure data and unit-tested; a declined or rectified finding is
   terminal — nothing reopens it.
2. **A follow-up job is created inside the finding's transaction.** `createFollowUpJob` calls
   `createJob(..., tx, { parentJobId })` with the open transaction, so the job, the finding's
   `followUpJobId` and its move to `SCHEDULED`, and `Job.parentJobId` all commit together. A second click
   refuses: the finding already names a job.
3. **The priority comes from severity and is capped at P2.** CRITICAL and MAJOR both map to P2; a P1
   would page dispatch for a crane the inspecting visit already returned to service. The form pre-fills
   the derived priority and leaves it editable.
4. **The decline note is written to the audit trail, not a column.** `Finding` has no note field; the
   service reads the newest `UPDATE` entry's `after.note` back for display.

**As built.** `src/lib/validation/findings.ts` (statuses, labels, transitions, `canMoveFinding`,
`isFindingOpen`, `priorityForSeverity`, the three Zod schemas and the signature upload schema, 12 unit
tests); `findingReadWhere` in `scope.ts` (the finding follows its report); `src/server/findings/findings.ts`
(`findingsForCrane`, `findingsForReport`, `getFinding`, `updateFindingStatus`, `acknowledgeDecline`,
`createFollowUpJob`, `describeFinding`); the parent/follow-up linkage and `followUpSelect` in
`src/server/jobs/jobs.ts`; the `FINDING_SIGNATURE` branch in `src/server/storage/files.ts`; the three
forms in `src/components/office/finding-forms.tsx`; the actions in `src/app/(office)/reports/actions.ts`;
the Findings section on the report page, "Open findings" on the crane page, and "Follow-ups" on the job
page; `Finding` in the audit viewer's label lookup. New coverage:
`tests/unit/findings.test.ts` (12) and `tests/integration/findings.test.ts` (10). **No migration** — every
column, both relations and `File.findingId` already existed.

**Known limit:** ~~a finding's status is not yet driven by the job that fixes it~~ — **closed by slice 19**
(§7.10): `transitionJob` to `COMPLETED` writes the job's `SCHEDULED` follow-up findings to `RECTIFIED`, with
one audit row each, in the same transaction as the status change.
### 7.8 Slice 17 — the load test and visual inspection templates (**built**)

**Goal:** the two templates that carry legal weight are complete against brief §6.3, and a load test
cannot be signed with an instrument whose calibration had lapsed on the day of the test without the
person filling it in being told.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 106–108):

1. **A new version, never an edit.** The two definitions are published at `version: 2`; the seed creates
   `LOAD_TEST-v2` and `VISUAL_INSPECTION-v2` and repoints the job type at them. Approved reports that
   were filled under v1 stay on v1 and still re-render as issued.
2. **The repoint is narrow, and runs once.** The seed moves a job type only when it still points at an
   *older version of the same template* (`code` shares the `<key>-v` prefix). A job type pointed at
   something else is the office's decision and is left alone.
3. **The calibration check is template data.** `TemplateSection.calibration` names the test-date field,
   the instrument label, the serial and the due-date column; `calibrationWarnings(template, data,
   register)` is a pure function that reads no clock. Nothing in code names a column of the load test.
4. **It warns and never blocks.** The phone shows an amber panel under the instruments table, and the
   office report page runs the same check on the dates as recorded. A serial the register has never
   heard of is silent — hired test weights are normal.

**As built.** `LOAD_TEST` v2 (test load, radii with SWL and result per radius, instruments with load
cell ID / serial / calibration due, pre- and post-test examination, deflection, AE attendance with name
and firm, outcome) and `VISUAL_INSPECTION` v2 (structure, safety devices, markings and load charts, wire
rope and hook, operator controls, findings by severity, photos, overall condition Good/Fair/Poor);
`CalibrationCheck` and `calibrationWarnings` in `src/lib/templates/schema.ts`; the
`calibrationResources` set on the sync bundle (`src/server/tech/my-jobs.ts`), scoped through
`resourceReadWhere` to instruments booked on the technician's own jobs, cached in Dexie
(`src/offline/db.ts`, now `version(3)`); the amber panel in `src/components/tech/report-form.tsx`; the
same warnings on `src/app/(office)/reports/[id]/page.tsx`. New coverage: `tests/unit/templates.test.ts`
(the two v2 shapes, and six `calibrationWarnings` cases), `tests/integration/tech.test.ts` (the bundle
carries only the technician's own instruments). **No migration** — `Resource.calibrationDueDate` and the
Dexie cache are both already there.

**Known limit:** the register reaches the phone only for instruments booked on that technician's jobs.
An unbooked instrument falls back to the date typed on the form, which is the honest source anyway.
### 7.9 Slice 18 — delivery orders (**built**)

**Goal:** the paper that travels with the parts comes from the same rows that took them out of the store, so
the delivery and the stock ledger cannot describe different amounts (brief §6.5, CLAUDE.md rule 10).

Fixed decisions (recorded as `ASSUMPTIONS.md` items 109–114):

1. **A line names its `StockMovement`.** `DeliveryOrderLine.movementId` is a unique, nullable FK to the `ISSUE`
   movement, and raising the DO writes `StockMovement.deliveryOrderId` in the same transaction. The form never
   takes a quantity: it ticks rows the server read from the ledger.
2. **Partial delivery is one additive column.** `DeliveryOrderLine.receivedQuantity` is a running total; the
   status is derived from it (`deliveryStatusFor`), never posted.
3. **Receiving writes no movement.** The issue already happened. A second movement would double-count the part
   against the job.
4. **Numbered at raise, rendered on demand.** The signer at the gate signs a numbered document, so
   `DO-YYYY-NNNN` is allocated when it is raised. A DO mutates as it is receipted, so it has no immutable
   version to store; the renderer pins its dates so an unchanged DO is byte-stable.
5. **Only loan kit comes back, and `RETURNED` is terminal.**

**As built.** `src/server/delivery-orders/delivery-orders.ts` is the one read/write path —
`deliveryOrdersForJob` and `getDeliveryOrder` (scoped through the new `deliveryOrderReadWhere`, which follows
the job), `issuedPartsForJob` (unclaimed `ISSUE` movements on the job), `createDeliveryOrder` (re-reads every
movement under the job, refuses a foreign, non-issue or already-claimed one by part number, allocates the
number, snapshots the lines, claims the movements, audits), `receiveDeliveryOrder`, `returnDeliveryOrder` and
`renderDeliveryOrder`. `src/lib/validation/delivery-orders.ts` holds the schemas and the two pure rules.
`src/server/documents/delivery-order.ts` is the fixed-layout renderer; `GET /api/delivery-orders/[id]/pdf`
downloads it. The receiver signature reuses the signed-URL upload route under a new `DELIVERY_SIGNATURE` kind.
The job page gains a Delivery orders section: each DO with its lines, ordered/received/terms and PDF link,
then the raise form (unticked list of issued parts), the receipt form (SignaturePad, per-line running total)
and the loan-return form, all gated on the new `deliveryorder.write` capability (dispatcher and storekeeper).

**Migration:** `20261028400000_slice18_delivery_orders` — adds `DeliveryOrderLine.movementId` (unique index, FK)
and `receivedQuantity` (default 0). Additive only.

**Known limit:** a DO raised from a job with no stock movements has nothing to offer, so the form explains that
the parts appear once a report records them. There is no screen for a customer-level DO without a job — the
schema allows it (`jobId` is nullable) but the brief's flow always starts from a job.
### 7.10 Slice 19 — quotes and variations (**built**)

**Goal:** an estimate reaches the customer as a numbered document whose total is computed from its lines, and
the customer's answer moves the job — not a note in someone's inbox (brief §4.2, §12).

Fixed decisions (recorded as `ASSUMPTIONS.md` items 115–120):

1. **A quote always belongs to a job.** `Quote.jobId` is required and the customer is read through the job, so
   a quote cannot name one customer and a job that belongs to another. Quoting straight from a set of findings
   is a prefill on the job's form, not a second source of truth.
2. **Expiry is derived, never written.** `EXPIRED` is `SENT` plus a `validUntil` whose day key (in the operating
   timezone) is behind today's. There is no nightly sweep and no stored status to disagree with the date.
3. **`Quote.gstRate` is snapshotted at save**, like `Invoice.gstRate`: a reprint shows the rate it was priced at,
   and the displayed rate is the stored one rather than one inferred from the rounded amounts.
4. **Only a draft is editable, and editing reprices.** Sending is the point the offer leaves; after that the
   lines are fixed. A draft edit deletes and recreates its lines at the current settings rate.
5. **The job moves through its own status machine.** Sending a quote on a `TRIAGED` job calls
   `transitionJob(..., 'QUOTED')`; accepting one on a `QUOTED` job calls `transitionJob(..., 'APPROVED')`, in the
   same transaction as the quote change, so history and audit agree. A quote sent from a job in any other state
   changes only the quote — the machine still decides what a job may do.
6. **Finance reads, dispatch writes.** A new `quote.read` capability lets finance see quotes and gives
   `quoteReadWhere` its exact audience; `quote.write` stays with dispatch and admin.

**As built.** `src/lib/validation/quotes.ts` holds the pure rules — `ALLOWED_QUOTE_TRANSITIONS`/`canMoveQuote`,
`effectiveQuoteStatus`, and `quoteTotals`, which does integer-cent arithmetic: each line rounds to the cent,
the subtotal is the sum of those, GST is computed on the rounded subtotal and rounded once. The three Zod
schemas and the filter live there too. `src/server/quotes/quotes.ts` is the one read/write path:
`quotesForJob`, `listQuotes` (status derived before filtering, with per-status counts) and `getQuote` scoped
through the new `quoteReadWhere`; `createQuote` (job under `jobReadWhere`, current `gstRate`, number from
`nextDocumentNumber(tx, 'QUOTE')`, lines and totals written, CREATE audited), `updateQuote` (stored status must
be `DRAFT`), `transitionQuote` (refuses `EXPIRED` and a lapsed send by name, then the job move) and
`renderQuote`. `src/server/documents/quote.ts` is the fixed-layout PDF with a "not a tax invoice" notice, and
`GET /api/quotes/[id]/pdf` downloads it. The office gains `/quotes` (counts, q/status filters) and
`/quotes/[id]` (lines with a Variation tag, totals, what happens next, draft editing); the job page gains a
Quotes section with a raise form prefilled from the job's open findings. **The slice-16 carry-over is wired:**
a job moving to `COMPLETED` writes its `SCHEDULED` follow-up findings to `RECTIFIED` with one audit row each,
inside the same `withAudit` transaction (`src/server/jobs/jobs.ts`), because the dispatcher holds no
`finding.write` and this is the job transition's own write.

**Migration:** `20261028500000_slice19_quotes` adds `Quote.gstRate DECIMAL(5,4) NOT NULL DEFAULT 0`. Additive only.

**Known limits.** A quote is always raised from a job; there is no customer-level quote screen (the schema would
allow one, but nothing in the brief asks for it). Quoting a finding prefills a line and does not change the
finding's status, because that belongs to the report flow and to `finding.write`, which dispatch does not hold.
Declining a quote leaves the job at `QUOTED` — what happens to a declined job is the office's call, and no
requirement names a state for it. Expiry is derived, so nothing emails the customer when a quote lapses.
### 7.11 Slice 20 — invoicing, GST and payments (**built**)

**Goal:** the work that was signed off becomes a bill the customer can pay, and the office can see what is owed
and overdue (brief §5, §12).

Fixed decisions (recorded as `ASSUMPTIONS.md` items 121–129):

1. **Only a reviewed job can be invoiced.** Billing follows the paperwork's sign-off; a job still in progress
   has not necessarily used what it would be charged for.
2. **Job costing is a prefill read from `StockMovement`.** The `ISSUE` movements on the job — the same rows the
   delivery order prints — become lines at sell price; labour is typed. The stored invoice keeps the lines as
   written, so a later price change cannot rewrite a bill that has gone out.
3. **The GST rate *and the amounts it produces* are snapshotted at issue.** Re-snapshotting the rate alone would
   print a percentage that disagrees with the amount beside it.
4. **`amountPaid` is the sum of the payment rows**, and `PART_PAID`/`PAID` follow from it (`paidStatusFor`), so a
   status cannot disagree with the money. An overpayment is refused by name — a credit note, not a negative
   balance.
5. **Issuing moves the job `REVIEWED → INVOICED`** in the same transaction, checked against `canTransition`. It is
   written by the invoice service rather than through `transitionJob`, because finance does not hold
   `job.transition` — granting that would let it move any job to any state.
6. **Finance issues and reads invoices; no other office role does.** `invoice.read`/`invoice.write` are checked
   before `invoiceReadWhere` is built, so a technician gets a refusal rather than an empty list.

**As built.** `src/lib/validation/invoices.ts` holds the pure rules — `ALLOWED_INVOICE_TRANSITIONS`/`canMoveInvoice`,
`paidStatusFor`, `balanceCents`, the derived `isInvoiceOverdue` (day keys in the operating timezone, like a
quote's expiry), `isInvoiceEditable`/`isInvoicePayable`, `INVOICE_STATUS_LABELS`, and the Zod schemas for lines,
create, update, void and payment. The money arithmetic moved to `src/lib/validation/money.ts`
(`documentTotals`, `centsToDecimalString`, `pricedLines`) and `quotes.ts` now re-exports it, so an invoice and
the quote that preceded it cannot price the same lines differently. `src/server/invoices/invoices.ts` is the one
read/write path: `invoicesForJob`, `listInvoices` (per-status counts and total outstanding), `getInvoice` and
`jobCosting` scoped through the new `invoiceReadWhere`; `createInvoice` (refuses a non-`REVIEWED` job by name,
allocates `INV-YYYY-NNNN` with `nextDocumentNumber(tx, 'INVOICE')`, writes lines and totals, audits),
`updateInvoice` (draft only, carrying the job forward from the replaced lines), `transitionInvoice`
(issue/void only, void needs a reason and is refused once paid) and `recordPayment` (integer cents, sums into
`amountPaid`, derives the status). `src/server/documents/invoice.ts` is the fixed-layout PDF, headed "Tax
invoice" and still carrying the company-document caveat, downloaded through `GET /api/invoices/[id]/pdf`. The
office gains `/invoices` (counts, q/status filters, outstanding total) and `/invoices/[id]` (charges, totals,
payments, what happens next, the payment form), the job page gains an Invoices section with a "Raise an invoice"
form prefilled from the job's issued parts, the nav gains **Invoices**, and the audit viewer labels and links
an invoice. The dashboard's "awaiting invoicing" tile now points at the work that answers it.

**Migration:** none. `Invoice`, `InvoiceLine`, `Payment`, `InvoiceStatus`, `PaymentMethod` and
`DOCUMENT_PREFIXES.INVOICE = 'INV'` were designed in Phase 1 and already in the database.

**Known limits.** There is no credit note: an invoice with money against it cannot be voided and an overpayment
cannot be taken, both of which the messages say. The customer page has no Invoices tab (the job page and
`/invoices` are the two screens). Payment has no proof-of-payment upload — the method and reference are what is
recorded. No e2e walks the invoices screen; the integration suite is what proves it.
### 7.12 Slice 21 — the accounting export and the Phase 2 acceptance path (**built**)

**Goal:** the money the business has billed leaves the app in a file an accounting system can read, and one
browser run proves the whole of Phase 2 still joins up (brief §12, §14).

Fixed decisions (recorded as `ASSUMPTIONS.md` items 130–134):

1. **Only billed invoices are exported** — `ISSUED`, `PART_PAID`, `PAID`. A draft is still being edited and a
   void invoice is not a bill; the panel on `/invoices` says so above the link.
2. **The file states the ledger, not today's settings.** Amounts and the GST rate are the ones stored on the
   invoice and snapshotted at issue, so a re-export months later shows what the customer was charged.
3. **Dates are `YYYY-MM-DD`.** The app's own `DD/MM/YYYY` is for people; an importer reading `03/04` cannot tell
   March from April.
4. **Two documents, one link each** — `?what=payments` switches file. Both run the invoice book's own `q`/`status`
   filters, so a filtered screen and the file it offers describe the same subset.
5. **The export is not audited.** It is a read, not a business mutation, and `AuditAction` has no entry for one.
   Widening the enum for a report would put "someone looked at the ledger" in the same trail as "someone voided a
   bill".
6. **The seam is `AccountingExporter`.** The service builds two row shapes; a driver renders them. A Xero or
   QuickBooks push is a second driver over the same rows, not a second export path.

**As built.** `src/server/accounting/accounting.ts` holds the pure row builders (`invoiceExportRows`,
`paymentExportRows`), the CSV driver (`createCsvExporter(timeZone)`) and `exportAccounting(context, raw, client)`.
It reads through `listInvoices` and `getSettings` — the same calls the screen makes — and does no arithmetic of
its own: money goes through `centsToDecimalString`, dates through `dayKey` in the operating timezone, payments
are sorted oldest-first and their methods spelled out. `GET /invoices/export` mirrors `/jobs/export`: 401 without
a session, 403 with a sentence for a role without `invoice.read`, `﻿` BOM, CRLF, `Content-Disposition:
attachment`, `no-store`. `/invoices` gains an **Accounting export** panel with the two links, carrying the current
filters.

`tests/e2e/phase2.spec.ts` is the Phase 2 acceptance path: a compliance rule is added on `/admin/compliance`
(carry-over 1, §7.5), adopted on a crane, the owner is changed and the re-registration prompt cleared, a
certificate is uploaded and shows in the certificate book, a PM job is completed and rolls the schedule forward,
`/api/cron/daily` queues the reminder, an approved report's finding becomes a follow-up job, that job is quoted
and the quote accepted (job to `APPROVED`), and the reviewed PM job is invoiced, issued, paid, and both
accounting files download. It runs in the desktop project only.

**Two bugs the acceptance path found, both fixed here.** The "Add a schedule" and "Add a certificate" forms on
the crane page never sent `craneId` — the dropdown is replaced by the crane, and no hidden field carried it — so
both submitted with "Choose a crane." and could not succeed from that page. The certificate form is only ever
rendered on a crane's page; the schedule form now posts the crane as a hidden field when it is not offering the
dropdown.

**Migration:** none.

**Known limits.** CSV only — no Xero/QuickBooks driver yet, by design. There is no export of credit notes
(there are none) and no date-range filter: the export follows the invoice book's filters, and the book has none.
The acceptance spec signs in as ADMIN throughout; the per-role answers are the integration suite's job
(`exportAccounting` refuses a technician, tested in `invoices.test.ts`).

## 7.13 Slices 22–28 as built

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

## 7.15–7.24 Slices 29–38 as built

### 7.15 Slice 29 — contracts on the customer page (**built**)

**Goal:** the SLA numbers a customer actually agreed to could not be entered. `Contract` and contract-scoped
`SlaPolicy` rows had been in the schema since Phase 1, `createJob` had read them since slice 5, and the customer page
had shown a disabled Contracts tab — but the seed was the only thing that could write one.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 179–185):

1. **The targets are `SlaPolicy` rows carrying the contract's id, never `Contract.slaOverrides`.** The JSON column is
   dead: nothing reads it, and two records of one negotiated number can only disagree — while a job snapshots its
   deadline from whichever one it read. It stays unused rather than being filled in "for consistency".
2. **Blank means "follow the company-wide row".** A priority is one row with both numbers or no row at all; the form
   never shows a number the contract has not agreed to, and saving replaces the contract's rows wholesale, so clearing
   a pair removes the row rather than zeroing it.
3. **Both numbers or neither.** `SlaPolicy` holds a response and a resolution per row, so half a pair would leave the
   other undefined at the moment it matters; the schema refuses it and says so on the response field.
4. **Reads ride on `customer.read`, writes on `sla.manage`.** A contract is a view of the customer and is part of what
   dispatch and finance need to see; changing an agreed target is the capability that has guarded targets since
   Phase 1 and was unused until now (Admin-only today).
5. **Covered cranes are this customer's live cranes, checked in the service.** No cranes ticked means the whole
   account — what an AMC usually is — and named cranes mean only those. The ids are validated against `craneReadWhere`
   and the customer inside the transaction, because a tampered form could otherwise attach another customer's crane.
6. **Retire, never delete.** Jobs and tickets keep naming the contract; a retired one (`deletedAt`) drops out of
   `insertJob`'s lookup and out of the page, while its `SlaPolicy` rows stay as the record of what was agreed.
7. **The renewal badge is derived, not stored** — 90 days, the same window certificates use, in whole UTC days.

**As built.** `src/lib/validation/contracts.ts` holds the pure rules (`createContractSchema`, `slaOverridesFrom`,
`renewalState`, `contractCoversCranes`, the type labels). `src/server/contracts/contracts.ts` holds
`listCustomerContracts`, `contractCraneOptions`, `createContract`, `updateContract` and `retireContract` — the first
domain folder in `src/server/` for Phase 4. The customer page gains a Contracts section (list, renewal badge, term,
coverage, agreed targets, notes; per-contract Retire and Edit; an "Add a contract" form, everything written behind
`sla.manage`), and its Contracts tab becomes an anchor. Three server actions sit in the customer page's `actions.ts`,
and the audit viewer labels a `Contract` and links it to `/customers/<id>#contracts`. `insertJob` now chooses the
newest live contract that actually **covers the job's cranes**, so a crane-specific contract stops leaking onto jobs
for the customer's other cranes.

**Migration:** none. `Contract`, `ContractType`, `SlaPolicy` and its `@@unique([priority, contractId])` were designed
in Phase 1 and already applied.

**Known limits.** `insertJob` now picks the latest-starting live contract that covers the job's cranes (an
account-wide contract covers everything), but where two candidates cover the same job the later start still wins
outright — there is no precedence between an AMC and a warranty arranged on the same crane. There is no company-wide
`/contracts` list; the renewal queue of slice 30 sits on the customer list (§7.16), and the ticket
SLA board still reads company-wide rows only — a ticket has no contract. `priceSchedule` and included visits are stored
and shown but not yet used by quoting or invoicing. No browser test of the Contracts panel; the integration suite proves
the SLA rows, the job snapshot, the cross-customer crane refusal, the retire and the permissions.

### 7.16 Slice 30 — SLA management and the renewal board (**built**)

**Goal:** the company-wide targets the app counts every job's clock from were seed-only — no screen could change them —
and a contract's renewal date was visible only on that customer's own page, so nothing answered "what runs out next".

Fixed decisions (recorded as `ASSUMPTIONS.md` items 186–192):

1. **The company-wide targets are one screen, `/admin/sla`, holding all four priorities.** Response and resolution side
   by side, the same two numbers `resolveSlaTargets` reads when a job is created. One form because the four rows are one
   policy, and saving them one at a time invites a half-applied pair.
2. **The write is `findFirst` then update-or-create, never `upsert`.** Company-wide rows have `contractId = NULL`, and
   Postgres treats NULLs as distinct in a unique key, so `upsert`'s `where` cannot name the row. An inactive row edited
   here is brought back rather than duplicated.
3. **No company row is deleted and no number zeroed.** A priority with no row falls back to `DEFAULT_SLA_POLICIES` in
   code; the screen shows the built-in number with a badge saying so, rather than an empty field. The form refuses a
   number below one.
4. **Resolution may not be quicker than response, checked per priority in the schema.** The one property that makes an
   SLA mean anything, refused on the field it belongs to.
5. **Each priority that changed writes its own audit entry**, in the same transaction as the write, and the audit viewer
   labels it `Company-wide P1 target` and links to `/admin/sla`.
6. **The renewal board sits on `/customers`, where PLAN §7.14 put it, and ignores the list's filters.** An overdue
   renewal hidden because the list happens to be filtered to "prospect" is the one failure this board must not have.
   It lists live contracts overdue or renewing within the same 90-day window, soonest first, each linking to the
   customer's `#contracts` section.
7. **The window is applied in the query and again by slice 29's `renewalState`**, so the board and the customer page
   cannot disagree about the same contract. Days are whole UTC days; overdue is negative.

**As built.** `src/lib/validation/sla.ts` holds `companySlaSchema` and `companyTargetsFrom`. `src/server/sla/sla.ts`
gains `getCompanySlaTargets` (seeded rows merged with the code fallback, so the screen never shows a blank) and
`updateCompanySlaTargets`; `src/server/contracts/contracts.ts` gains `listUpcomingRenewals`. The `/admin/sla` page and
its `CompanySlaForm` client component are new, the nav gains **Service levels** behind `sla.manage`, and `/customers`
gains the renewals section above its filters. The audit viewer learns the `SlaPolicy` entity.

**Migration:** none. `SlaPolicy` and its `@@unique([priority, contractId])` were designed in Phase 1 and already
applied.

**Known limits.** The board is a queue, not a workflow: no acknowledge, snooze or reminder email, and a contract with no
renewal date is absent from it entirely. Editing a target changes what **new** jobs count down from; jobs already raised
keep the deadline they snapshotted, by design, so a correction is invisible on them. Reads ride on `customer.read`, so
the board is reachable by Admin, Dispatcher and Finance and not by a technician — no separate capability was added. The
screen also sits under the admin layout, which refuses any role without `user.manage`; both capabilities are Admin-only
today so the two gates agree, but a future role holding `sla.manage` alone would see the nav link and the refusal panel.
No browser test of `/admin/sla` or the board; the integration suite proves the four-row write and its audit, the fallback,
the role refusals, the window and ordering, and the exclusion of retired contracts.

### 7.17 Slice 31 — the customer portal (**built**)

**Goal:** the `CUSTOMER` role has existed since Phase 1 and could not sign in to anything. The scope filters in
`scope.ts` already had a `customerId` branch in every one of them; `AuthContext.customerId` was hard-wired to `null`
and `ROLE_CAPABILITIES.CUSTOMER` was an empty list, so none of it was reachable.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 193–199):

1. **`User.customerId`, not a second account table.** A portal login is a `User` with `role = CUSTOMER` and one nullable
   FK to `Customer`. It reuses the existing password login, rate limiter, session invalidation on password reset and
   deactivation, all of which a `PortalUser` table would have had to reimplement. Several logins may share one customer
   (a site contact and an accounts contact), which the FK permits.
2. **The role gains exactly four capabilities and no writes.** `portal.read`, `crane.read`, `certificate.read`,
   `report.read.own` — the last three are the *existing* capabilities, so the portal reaches the same crane, certificate
   and report services the office does and the scope filter decides the rows. `job.read.all` is deliberately absent: it
   would make `jobReadWhere` return an unfiltered query for a customer.
3. **The portal adds no second query where one exists.** `listCranes`, `listCertificates` and `issuedPdfUrl` are called
   as they are. Only the jobs list is read directly, and only because `listJobs` is gated on `job.read.all`. A query
   written for the portal alone is a second place for the scoping rule to be wrong.
4. **`portal.read` is the gate, and a `CUSTOMER` login without a customer is refused.** `requirePortalCustomer` asserts the
   capability and throws `ForbiddenError` when `customerId` is null, so a half-finished admin save produces a refusal
   rather than a portal narrowed to `DENY` and reading as "you have no jobs".
5. **The customer picker is required for CUSTOMER and refused for every other role**, in the schema (`withCustomerRule`)
   and in the service (`assertCustomerExists`). A staff account carrying a `customerId` would be narrowed by the
   `customerId` branches to one customer's data — a leak, not an harmless extra field. The customer must be live.
6. **Only `APPROVED` reports.** `portalReports` filters on status as well as scope: a submitted report has no document
   number and no PDF, and showing a customer an unfinished page is worse than showing none.
7. **A customer login never sees the office or technician shells.** The office layout redirects a role with
   `portal.read` and no `dashboard.office` to `/portal`; the login page sends a customer to `/portal` rather than
   `/dashboard`. In the other direction the portal gate is the **customer link**, not `portal.read`: Admin holds
   `ALL`, so a capability check would wave a staff login onto `/portal` and the first service call would throw — a
   500 where a redirect belongs. Every portal page runs `requirePortalPage()` from
   `src/app/(portal)/guard.ts`, because Next 15 renders a layout and its page in parallel and the layout's
   `redirect()` does not stop the page running.
8. **The portal is read-only by construction, not by hiding buttons.** There is no `portal.write` capability and every
   page is a server component that calls read services. Raising a ticket is the obvious next capability and is
   deliberately not in this slice.

**As built.** `prisma/schema.prisma` gains `User.customerId` (nullable, indexed, `ON DELETE SET NULL`) and `Customer.users`;
`20261030100000_slice31_portal_user` is the additive migration. `src/server/auth/context.ts` reads `customerId` from the
database like the role, so revoking it takes effect on the next request. `src/server/auth/permissions.ts` gives
`CUSTOMER` its four capabilities. `src/server/portal/portal.ts` (new domain) holds `requirePortalCustomer`,
`portalJobs`, `portalJob`, `portalReports` and `portalSummary`. `src/app/(portal)/` is a fourth route group with its own
shell and five pages — `/portal` overview, `/portal/jobs`, `/portal/jobs/[id]`, `/portal/cranes`, `/portal/certificates`,
`/portal/reports`. `/admin/users` and `/admin/users/[id]` gain the customer picker and show the customer beside the role.
The seed gains one portal login (`portal@cimmeriancrane.example`, the first demo customer) behind the same demo gate as
every other demo row.

**Migration:** `20261030100000_slice31_portal_user` — one nullable column, its FK and an index. Additive only.
**Applied** to the hosted database, and confirmed directly against it (the column is nullable, `User_customerId_idx`
exists). It is required rather than optional: `getAuthContext` selects `User.customerId` on every request, so the app
fails on sign-in without it.

**Verified.** `npm run verify` (430 unit tests, 0 lint errors) · `npm run test:integration` (355 tests, 31 files, of
which 8 are `tests/integration/portal.test.ts`) · `npm run test:e2e` (45 passed, 2 offline-only skipped) ·
`npm run build`.

**Known limits.** No "raise a ticket" from the portal (brief §3 lists it; it is a write path and a separate slice). No
invoice or quote access — the portal is scoped to jobs, cranes, certificates and reports, per PLAN §7.14. The customer
sees a job's status and dates but not its findings or internal notes. There is no per-login audit of what a customer
looked at; reads are not audited anywhere in this app, for any role. The browser test (`tests/e2e/portal.spec.ts`)
covers sign-in and landing, the `/dashboard` → `/portal` redirect, the jobs list showing only their own jobs, another
customer's job 404ing by URL, the empty states of certificates and reports, and a staff login being sent back out of
`/portal`; the integration suite is what proves cross-customer isolation of jobs, cranes, certificates and reports, the
approved-only filter, and the fail-closed behaviour of a login with no customer.
### 7.18 Slice 32 — profitability reporting (**built**)

**Goal:** revenue and cost were both already in the system — invoices on one side, the stock ledger's costs on the
other — and nothing put them side by side. This is the first Phase 4 slice that does not add a screen for entering
something; it reads what the business has already recorded.

**The finding that shaped it:** only **parts cost** is recorded. `StockMovement.unitCost` on every `ISSUE` row is what
the part cost us, and `jobCosting` already sums it for the invoice prefill. Labour is *sold* on invoices but never
*costed* — `Technician` has no rate and nothing records hours. So the report is revenue less material, and the column is
labelled **Parts cost** rather than "cost of sale" so a margin here is not read as gross profit. `ASSUMPTIONS.md` 200.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 200–204):

1. **Revenue is the invoice subtotal, ex-GST**, on `ISSUED`, `PART_PAID` and `PAID` only, dated by `issueDate`. A draft is
   not a bill and a void one never was; the issue date is the day the money became receivable.
2. **Cost is booked to the job, once, in the window its invoice falls in.** A job invoiced on two invoices does not have
   its material counted twice; a job invoiced in March for February parts shows both in March. Unsold material contributes
   nothing — work in progress is not a loss.
3. **A line with no job is counted but not attributed.** Labour typed straight onto an invoice lands in the totals and
   against its customer; the page reports how much that is rather than inventing a "No job" contract or job type.
4. **All sums are in integer cents**, quantity read in thousandths before multiplying by the cost in cents, so a 0.1 + 0.2
   of wire rope cannot leave a float in a margin.

**The shape.** `src/server/reports/profitability.ts` is one service, `profitabilityReport(context, filters)`, gated on
`report.financial` (finance and admin) and scoped with `invoiceReadWhere` + `jobReadWhere` so the two halves of rule 1 both
apply. `/reports/profitability` is the screen: a from/to pair of issue dates, a totals row, and three tables — by customer,
by contract, by job type — each sorted by revenue, with the margin in red when negative and "—" where there is no
revenue to take a percentage of. The nav gains **Profitability**, shown only to roles that hold the capability.

**No migration.** Everything read is a column that has existed since Phase 1 (invoices) and Phase 3 (the ledger).

**Known limits.** Labour is not costed, which is the whole caveat above. There is no CSV export of the report and no
browser test of the screen; the integration suite (`tests/integration/profitability.test.ts`) is what proves the grouping,
the ex-GST revenue, the single booking of a job's material, the exclusion of drafts, the unattributed line, and the role
refusal. Purchase orders are deliberately not read: an order is not a cost of a job until a part is issued from it.
### 7.19 Slice 33 — technician utilisation (**built**)

**Goal:** the hours the business has already recorded — every job's status history — turned into the question a
dispatcher actually asks, "who is busy and who is idle", against the time they had to be busy with.

**The finding that shaped it:** there is no hours table and no shift pattern. `JobStatusHistory` is append-only and
timestamps every move (rule 7), so a visit's duration is already in the data; what is not in the data is what a
technician's *available* time was. Nothing in the brief asked for a roster, so the denominator is a fixed weekday.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 205–209):

1. **On the tools is `IN_PROGRESS` to the next change, summed over visits.** A job held overnight counts the afternoon
   before the hold and the morning after it, not the night. That is what makes the report useful for a job that was
   parked awaiting parts.
2. **On the road is `DISPATCHED` to `COMPLETED`**, so travel either side of the visit is included. A job that was
   never dispatched falls back to the on-site span, understating travel rather than inventing it.
3. **A crew shares a job's hours.** Two technicians on one visit get half each; crediting both would double-count the
   work. The job total counts the job once.
4. **Hours count on the day the job completed.** A job still in progress has hours but no known total, and billing it
   to a period it may leave is how a report starts disagreeing with itself. The screen says the recent days read low.
5. **The denominator is Monday–Friday 09:00–17:00 in the operating timezone, less leave booked inside those hours.**
   A fortnight off is 80 hours, not 336 — leave measured on the same clock as the days it removes.

**The shape.** `src/server/reports/utilisation.ts` is one service, `utilisationReport(context, filters)`, gated on
`report.financial` and scoped with `jobReadWhere`. `jobClock` and the working-calendar helpers are exported and pure,
so `tests/unit/utilisation.test.ts` pins the hold arithmetic, weekend skipping and leave clipping without a database.
`/reports/utilisation` is the screen: a from/to pair defaulting to the last 30 days, a totals line, and one table —
jobs, on the tools, on the road, leave, available, utilisation % — busiest first. The nav gains **Utilisation** next to
Profitability, gated the same way.

**No migration.** Everything read is a column that has existed since Phase 1 (`JobStatusHistory`, `Unavailability`,
the job's own stamps).

**Known limits.** The working calendar is fixed in code (a `shortcut:` comment names where to move it), there is no
public-holiday table, and no CSV export. No browser test walks the screen; `tests/integration/utilisation.test.ts` is
what proves the spans, the crew split, the leave subtraction, the exclusion of unfinished jobs and the role refusal.

### 7.20 Slice 34 — equipment calibration tracking (**built**)

**Goal:** the equipment the schedule already books — test weights, load cells, vans and tools — given the one date
that matters about it: when its calibration runs out, and what has already lapsed.

**The finding that shaped it:** nothing new had to be modelled. `Resource.calibrationDueDate` and
`Resource.calibrationFileId` have existed since Phase 1, the scheduler warns when a lapsed item is booked (slice 6),
and the load test's instruments table already names it (slice 17). What was missing was a screen that owns the date,
so the office can record a new certificate instead of only being warned about the old one.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 210–213):

1. **The register is the `Resource` table, not a new `Calibration` model.** The scheduler books those rows and the
   load test reads them; a second table of the same dates could only disagree with both.
2. **A calibration certificate is a `File` with `kind = CERTIFICATE`, owned by the equipment** (`entity = 'Resource'`,
   `entityId` = the resource). It takes the certificate register's accepted types and 5 MB limit, so a scanned lab
   report uploads exactly as a crane certificate does. Only the owner differs.
3. **The certificate is attached on edit, not on create.** The upload's storage key names the resource id, and a new
   item has no id yet; the form says "save the item first, then attach its certificate" rather than inventing a
   two-step create.
4. **Writes are `resource.write`, held by the storekeeper.** Dispatch keeps `resource.read` — it books the kit but does
   not maintain its paperwork. Retiring is the `RETIRED` status, refused while the item is booked on an unfinished job
   (naming the job numbers), because a technician would otherwise turn up without it.
5. **The date windows are the certificate register's**: overdue, 30, 60 and 90 days, derived on read from the same
   `dueBucket` helper, so the two registers cannot bucket the same date differently.

**The shape.** `src/server/calibrations/calibrations.ts` is one service: `listCalibrations` (search, kind and bucket
filters; soonest first, undated last), `calibrationCounts`, `calibrationDueLabel`, `createResource` and
`updateResource`. Every read spreads `resourceReadWhere` and every write takes the capability, like the rest of
`src/server`. The certificate upload is a new `CALIBRATION` flavour on the existing signed-URL route, and
`src/lib/validation/calibrations.ts` holds the Zod schemas and the two label maps. `/calibrations` is the screen:
counts, the filter row, one table (equipment, state, due date, bucket, certificate, edit), and an "Add equipment"
panel for the storekeeper. The nav gains **Calibrations** after Certificates, gated on `resource.read`.

**No migration.** Both columns have existed since Phase 1; the `File` row is the only thing written, and its table is
already there.

**Known limits.** There is no calibration history — replacing the certificate overwrites `calibrationFileId`, so the
audit trail is the record of what was there before. No browser test walks the screen;
`tests/integration/calibrations.test.ts` is what proves the audit rows, the file-ownership refusal, the retirement
guard, the bucket counts and the role refusal.

### 7.21 Slice 35 — route optimisation (**built**)

**Goal:** the board answers "who is going where, and when", but not "in what order". A dispatcher with four visits
on one side of the island and one on the other had no way to see the drive.

**The finding that shaped it:** the coordinates were already there. `Site.latitude`/`longitude` have existed since
Phase 1, the site form edits them, and nothing read them. No migration, no new model.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 214–218):

1. **The round starts at whichever visit is scheduled first.** There is no depot in the system, and reorder the first
   stop would be a reschedule dressed as a suggestion. The rest are ordered from there; the dispatcher moves cards to
   act on it.
2. **It is a read, and writes nothing.** No `Job` row is touched, no audit entry is written. The order is advice; the
   board's drag is the action.
3. **Nearest neighbour, then 2-opt.** Exact TSP is brute force; a working day is under a dozen stops and this lands
   within a few per cent instantly. Ties break on the caller's order so the same day always plans the same round.
4. **Straight-line distance and one average speed (30 km/h).** Nothing knows road distance or traffic. The screen says
   both rather than presenting a guess as a measurement, and the time is labelled an estimate.
5. **A site with no coordinates is set aside, not silently dropped.** It is listed in an amber block naming the job and
   the fix — add latitude and longitude on the site — so a missing map pin cannot make a visit invisible.

**As built.** `src/server/schedule/routes.ts` is the pure half: `distanceKm` (haversine, IUGG mean radius) and
`planRoute` (nearest neighbour, then 2-opt with the start point pinned, returning the order, each leg and the total).
`src/server/schedule/routes-service.ts` reads the day's jobs under `jobReadWhere` and `job.schedule`, drops the ones
whose site has no coordinates into `unlocated`, and plans the rest — a technician filter narrows it to one person's day.
`/schedule` gains a **Round for &lt;day&gt;** section under the board: the ordered list with position, job, site, customer,
address, the kilometres from the stop before, and the first stop's time, plus a total and an estimated drive. The seed
now gives every demo site approximate coordinates, so the round is populated in the demo book.

**No migration.** Both columns have existed since Phase 1; the seed writes them on sites it creates.

**Known limits.** No map view — the brief's map is still unbuilt, and this is a list. No mileage claim: the distance is
a straight line, so it under-reads the road by however much the streets bend. The average speed is a constant, not a
setting. The round is one day; a week's tour is not planned. No browser test walks the section;
`tests/integration/routes.test.ts` proves the ordering, the day window, the technician filter, the unlocated block and
the role refusal, and `tests/unit/routes.test.ts` proves the geometry and that the plan is never worse than the order it
was given.

### 7.22 Slice 36 — WhatsApp and SMS adapters (**built**)

**Goal:** brief §4.3 promises that a P1 reaches a dispatcher "in-app + email in Phase 1; SMS/WhatsApp via adapter later".
The `NotificationChannel` enum has carried `SMS` and `WHATSAPP` since Phase 1 and nothing ever wrote one. A dispatcher
taking a crane-down call is standing on a site, not at a desk, and email is what they read on Monday.

**The finding that shaped it:** there was nothing to build but the seam. `src/server/notify/notify.ts` already had one
fan-out, one row per channel, and an adapter-shaped hole where the gateway goes — `EmailAdapter` with a console driver
and SMTP named but unbuilt is the pattern the whole app follows.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 219–222):

1. **P1 alerts only.** That is the one place the brief names the channels. Dispatch and obligation reminders stay
   in-app and by email; ringing a phone about a service due in 60 days would train the office to ignore the channel.
2. **One short line and a link, not the notification body.** SMS is billed per 160-character segment and read on a lock
   screen, so the row stores what was actually sent rather than the email text it was abbreviated from.
3. **No phone number, no phone row.** A recipient with a blank `User.phone` gets no row at all, so the fan-out never
   records a send that cannot happen. `User.phone` has existed since Phase 1 and is editable at `/admin/users`; this is
   the first code to read it.
4. **The drivers are declared, not built.** `SMS_DRIVER=twilio` and `WHATSAPP_DRIVER=meta` are accepted and fall back to
   console with a warning, exactly as `EMAIL_DRIVER=smtp` does. The seam is the deliverable; picking a gateway needs
   credentials and a purchasing decision that does not exist yet.
5. **A send returns a result and never throws.** A dead gateway must not roll back the ticket that raised the alert —
   the row records `failedAt` and the error, and the in-app copy still reaches the dispatcher.

**As built.** `src/server/notify/message.ts` is the new seam: `MessageAdapter`, `consoleMessageAdapter`, and
`messageAdapter(channel)` resolving `SMS` and `WHATSAPP` separately so one can be wired before the other. `fanOut` in
`notify.ts` gained a `phoneChannels` switch, a `phoneText`, and per-channel sending that records each outcome
separately; `alertRecipients` now selects `phone`. `notifyDispatchers` turns the switch on with a one-line body; the
reminder fan-out leaves it off. `src/lib/env.ts` gains `SMS_DRIVER`/`WHATSAPP_DRIVER` (both `console` by default) and
`.env.example` documents them. The seed gives the two demo accounts a P1 alerts reach (Admin and Dispatcher) a phone
number, and backfills a blank one on an existing demo account without ever overwriting a number the office entered.

**No migration.** `NotificationChannel` already had both values and `User.phone` already existed.

**Known limits.** A number is stored as typed — nothing validates E.164 or normalises whitespace, so a gateway will
need a `to` normaliser in the same file. There is still no notification inbox screen (`ASSUMPTIONS.md` 100), so the
in-app rows these sends sit beside remain visible only through the audit trail; that gap is unchanged and still worth
closing before the channels multiply. `tests/unit/message-adapters.test.ts` pins the fallback and the never-throws rule;
`tests/integration/tickets.test.ts` proves the row set (in-app + email for everyone, SMS + WhatsApp only for the holder
of a number), that every row is stamped sent, and that the phone body is the short alert; no browser test walks it.

### 7.23 Slice 37 — Xero/QuickBooks integration (**built**)

**Goal:** the brief asks for "an accounting-export adapter (CSV first; Xero/QuickBooks later)" (§5). Slice 21 built the
CSV, and left `AccountingExporter` as the seam — but it rendered *files*, and the office still copied a spreadsheet into
Xero by hand.

**The shape it took:** a second seam beside the exporter, `AccountingPushDriver`, with the same contract every adapter in
this app follows (`EmailAdapter`, `MessageAdapter`): a send **returns** a result and never throws. The exporter renders
the rows; the driver posts them. Neither knows the other's format.

Fixed decisions (recorded as `ASSUMPTIONS.md` items 223–226):

1. **Xero first, through a custom connection.** A client-credentials grant against one authorised org, so there is no
   OAuth callback and no refresh token to store on Vercel. `ACCOUNTING_DRIVER=none` by default: the CSV remains the only
   way money leaves an unconfigured app, and the screen offers the press only where it can work.
2. **Xero's total is checked against the bill's.** Lines go at their unit prices with the org's `XERO_TAX_TYPE`, so GST
   is computed where it is filed. The invoice was priced at the rate snapshotted on its issue date, so a returned total
   a cent away is reported as a failure to check, not recorded as pushed.
3. **`Invoice.externalRef` is written only after the system returns an id.** `externalPushedAt` sits beside it. The write
   is guarded on `NULL`, so a second press cannot replace the reference with a second id.
4. **`Idempotency-Key: cimmerian-<number>`.** A retry is the same request, so the dropped-response case — Xero created
   the bill, the reply was lost — returns the existing invoice rather than billing twice.
5. **Failures are the return value, not an exception.** Live calls happen before any write; each success is written in
   its own transaction with its own audit row. One refused bill cannot undo the fifteen that went through.

**As built.** `src/server/accounting/push.ts` holds `AccountingPushDriver`, `nonePushDriver`, `createXeroDriver` and
`xeroInvoiceBody` (pure, unit-tested). Token and tenant are fetched once per run and cached for the process.
`pushInvoicesToAccounting` lives in `accounting.ts` beside the export: it reads the same `listInvoices` rows, filters to
`ISSUED`/`PART_PAID`/`PAID` with no `externalRef`, pushes each and records the outcome — behind `invoice.write`, since it
writes into someone else's books. `invoiceExportRows` gained the charge lines (a push sends them; the CSV keeps its one
description cell). `InvoiceSummary` carries `externalRef`/`externalPushedAt`, `InvoiceList` a count of billed-and-unpushed
which the screen shows above the button. `/invoices` gains the **Accounting system** panel, `/invoices/[id]` says which
reference it went under, and `.env.example` documents the six variables.

**Migration:** `20261030200000_slice37_accounting_push` adds `Invoice.externalRef TEXT` and
`Invoice.externalPushedAt TIMESTAMP(3)`. Additive only — **applied with `npx prisma migrate deploy`**, which the
auto-mode classifier refuses; it was run with approval.

**Known limits.** No live Xero call was made — no credentials were available, so the payload is pinned by unit tests and
the driver is unverified against a real tenant. Only invoices are pushed: payments are not, so a bill's balance in Xero
is what Xero computes from its own payments. Nothing is ever *pulled* back — a change made in Xero (credit note,
write-off) is invisible here. The custom connection covers one organisation; a business with several Xero orgs needs
the OAuth flow this deliberately avoids. `XERO_TAX_TYPE` defaults to `SR` and an AU org uses `OUTPUT2`, which the total
check turns from a silent misposting into a visible refusal. No browser test walks the push; the integration suite
proves the skip-twice rule, the partial-failure retry, the null guard and the role refusal with a recording driver.

**Verification note.** This slice was recorded as built but was **not actually verified**: the migration had never been
applied, so `Invoice.externalRef` did not exist and 22 integration tests and the `phase2` e2e failed the moment anyone
ran the suite. Applying it exposed two further faults in the slice's own tests — both raised a second invoice on a job
that issuing the first had moved out of `REVIEWED`, which the service correctly refuses. Each now uses its own job. All
four gates are green as of slice 38: 463 unit, 390 integration, 53 e2e (2 offline-only skipped), build.

### 7.24 Slice 38 — the notification inbox (**built**)

**Goal:** close the gap recorded twice — `ASSUMPTIONS.md` 96 and 100, and PLAN §7.5 and §7.22 — that the `IN_APP` rows
the fan-out has written since Phase 1 were invisible. A P1 wrote a row, a reminder wrote a row, a dispatch wrote a row,
and nothing read one back; email was the only channel that reached anybody, and the SMS and WhatsApp rows slice 36 added
sat beside rows nobody could see either.

**The shape it took:** a read service and one screen. No table, no column, no migration, and no new writer — `notify.ts`
remains the only thing that creates a notification, and this shows what it wrote.

Fixed decisions (recorded as `ASSUMPTIONS.md` 227–230):

1. **A notification is addressed to one person and the inbox is read through that id.** `notificationReadWhere` returns
   `{ userId: ctx.userId }` and spreads nothing else, because there is no "all notifications" capability to widen it to.
   An Admin opening a dispatcher's inbox would see the same P1 twice and lose track of their own count.
2. **Cross-user marking is `NotFound`, not `Forbidden`.** A 403 confirms the row exists and that its id is real; a
   person has no reason to know a stranger's alert exists.
3. **The list shows in-app rows and failed deliveries, nothing else.** A sent email or SMS repeats the text of an in-app
   row already on the screen. A *failed* one is shown with its reason, because a dead mail server that only appears in a
   log is the failure this gap was about.
4. **The counts are the whole inbox, not the filtered list.** The badge must not change size depending on which tab the
   reader happens to be on.
5. **The badge counts the rows the screen shows, not every row with a null `readAt`.** `fanOut` writes an email twin
   beside every in-app row, and an email row's `readAt` never changes — so counting nulls naively would show "2 unread"
   beside one visible alert. The list, the count and Mark all read share one `VISIBLE` condition.

**As built.** `src/server/notifications/inbox.ts` holds `VISIBLE`/`VISIBLE_UNREAD` (the one condition the list, the badge and
Mark all read share), `listInbox` (newest first, last 100, optional unread-only), `markNotificationRead`,
`markAllNotificationsRead` and `unreadNotificationCount`. `notification.read` is a new
capability held by Admin, Dispatcher, Technician, Storekeeper and Finance — every role a notification can be addressed
to; the customer portal role does not hold it. `notificationReadWhere` joins the scope filters, returning
`{ userId }` and widening to nothing. Marking read goes through `withAudit` like every other mutation, so each row has
an `UPDATE` audit entry; `Notification` joins the viewer's entity list and label map (labelled by its title, linking to
`/inbox`). `/inbox` is the screen, its page and one shared `InboxList` component; the office nav gains **Inbox** with an
unread badge.

**On auditing a read flag.** A notification row itself is not audited — `notify.ts` writes it without one, because it is
an operational record, not a business one. Marking one read *is* audited, since CLAUDE.md rule 6 says every mutation
goes through `withAudit` and a reader's view state is still a write. The cost is real: **Mark all read** writes one
audit row per row it clears, so a backlog of fifty alerts is fifty audit entries. That is the honest reading of the rule
and it is what was built; if the audit log gets noisy, excluding this one UI-state write is the change, and it should be
made deliberately rather than by quiet omission.

**No migration.** `Notification`, its channel enum and the `(userId, readAt)` index have existed since Phase 1.

**Known limits.** A technician holds `notification.read` but the phone shell has no inbox tab, and `/inbox` renders the
office layout — a phone-shaped inbox is a later screen, not a second page to drift from this one. The list is capped at
the last 100 and has no search. There is no "mark read on open", so a P1 read in the inbox stays unread until a button is
pressed; the alert is also delivered by email and (for a P1) phone, so the badge is a reminder rather than the
notification itself. Nothing is ever deleted from the inbox. **Mark all read writes one audit row per cleared
notification**, which is the rule-6 reading but noisy on a large backlog (see above).

## 7.25 Slice 39 — the Service Report (**built**)

The owner's request: technicians already do a **Service Report** on paper. Corrected while building — the paper is two
documents, not one:

- The **Servicing checklist form** is what a technician fills in at the site, **per crane**: every component graded
  1–5 with a short comment ("lining at 1.8 mm, replace next visit"). It is the working record — signed, no number.
- The **Service Report** is one document for the visit. It turns those graded forms into prose, a section per crane
  and a paragraph per part, and it is the document that is numbered `SR2606001`: `26` year, `06` month, `001` the
  month's running number. It is issued as `SR2606001` for the first Service Report of June 2026.

**Fixed decisions.**

1. **A Servicing checklist form is a `Report`, unchanged.** One per crane, as reports already were. The job type gets
   `JobType.isServiceReport`, which makes its reports graded. Approval, the template-version snapshot, the signature
   and `RPT-…` numbering are untouched — a checklist form is not a numbered document.
2. **The grades live in `Report.data.grades`, keyed by `ChecklistItem.code`.** Beside the reserved `checklist` key,
   because the two are two halves of one line on the paper form. Each entry is `{ grade, comment, label }`, the `label`
   snapshotted at submission so an issued checklist re-renders as signed (rule 5). No new column on `ChecklistAnswer`.
3. **The scale is 1–5 with meaning attached.** 5 As new, 4 Good, 3 Serviceable, 2 Repair soon, 1 Failed. Ungraded is
   `null`, never `0` — a form that cannot tell "not looked at" from "failed" is worse than paper.
4. **Every *answered* checklist line must be graded.** Answered means a result, a measurement or a note. The check is in
   `submitReport`, so a phone that skips it is refused the same way. Grading a report whose type is not a Service
   Report is refused too.
5. **The Service Report is its own row, one per job** — `ServiceReport`, `@@unique([jobId])`. It belongs to the visit,
   not to a crane: a report is signed against one crane and carries a signature; this is built from the checklists,
   covers all of them, and its prose is editable until it is issued. Three differences that would have made one table
   serve two documents badly.
6. **The prose is generated from the grades and the office may reword it.** `buildServiceReportContent` writes one
   sentence per graded part — `Hoist brake: Grade 2 of 5 — Repair soon. Lining at 1.8 mm, replace next visit.` — sorted
   worst first, and `saveServiceReport` keeps whatever the office wrote instead. A part with no sentence is refused, so
   an edit cannot blank one out.
7. **SR numbering happens on `approveServiceReport`, in the approval month, via `DocumentSequence`.** The counter is one
   row keyed `SR:<yymm>` (`SR:2606`), incremented with the same atomic `INSERT … ON CONFLICT … RETURNING` the yearly
   sequences use. The per-crane report keeps `RPT-…`.
8. **A crane with no graded checklist blocks the issue.** It is listed as missing on the job page and named in the
   refusal. An ungraded checklist has not been filled in, and a report listing a crane nobody looked at is a lie.

**As built.** `JobType.isServiceReport` (migration `…_service_report_grades`); the `grades` column contract in
`src/lib/validation/reports.ts`; the answered-line gate and label snapshot in `submitReport`; the per-crane
**Servicing checklist** screen (`GradeInput` in `ReportForm`) and the grade table on its PDF; the `ServiceReport` table
and `ServiceReportStatus` (migration `…_service_report_documents`); the content contract and prose generator in
`src/lib/validation/service-report.ts`; `serviceReportForJob`, `saveServiceReport`, `approveServiceReport` and
`serviceReportPdfUrl` in `src/server/service-reports/service-reports.ts`; the PDF in
`src/server/documents/service-report.ts`; the **Service Report** panel and editor on `/jobs/[id]`; the download route
`/api/jobs/[id]/service-report/pdf`; `formatServiceReportNumber` / `nextServiceReportNumber` in
`src/server/documents/sequence.ts`.

**On the month in the number.** It is the **approval** month, not the visit month, because that is when the number is
issued — the rule `RPT-…` follows too. If the office wants the visit month instead, that is one line in
`approveServiceReport`.

**Known limits.** Grading is per checklist line, so a component the checklist does not declare has no grade box — the
checklist is the definition of "every component". Only `PM` is flagged. A Service Report has **no amendment path**:
once issued it refuses edits, and correcting one means the same manual route as any other issued document until an
amendment slice covers it. The office can edit a sentence but not add a part, change a crane or change a grade.

**Migration status.** Both migrations — `20261031100000_service_report_grades` and
`20261031110000_service_report_documents` — were applied with `npm run db:deploy` on 31/10/2026, and the full
integration suite passes against them.

 `VISIBLE`/`VISIBLE_UNREAD` (the one condition the list, the badge and
Mark all read share), `listInbox` (newest first, last 100, optional unread-only), `markNotificationRead`,
`markAllNotificationsRead` and `unreadNotificationCount`. `notification.read` is a new
capability held by Admin, Dispatcher, Technician, Storekeeper and Finance — every role a notification can be addressed
to; the customer portal role does not hold it. `notificationReadWhere` joins the scope filters, returning
`{ userId }` and widening to nothing. Marking read goes through `withAudit` like every other mutation, so each row has
an `UPDATE` audit entry; `Notification` joins the viewer's entity list and label map (labelled by its title, linking to
`/inbox`). `/inbox` is the screen, its page and one shared `InboxList` component; the office nav gains **Inbox** with an
unread badge.

**On auditing a read flag.** A notification row itself is not audited — `notify.ts` writes it without one, because it is
an operational record, not a business one. Marking one read *is* audited, since CLAUDE.md rule 6 says every mutation
goes through `withAudit` and a reader's view state is still a write. The cost is real: **Mark all read** writes one
audit row per row it clears, so a backlog of fifty alerts is fifty audit entries. That is the honest reading of the rule
and it is what was built; if the audit log gets noisy, excluding this one UI-state write is the change, and it should be
made deliberately rather than by quiet omission.

**No migration.** `Notification`, its channel enum and the `(userId, readAt)` index have existed since Phase 1.

**Known limits.** A technician holds `notification.read` but the phone shell has no inbox tab, and `/inbox` renders the
office layout — a phone-shaped inbox is a later screen, not a second page to drift from this one. The list is capped at
the last 100 and has no search. There is no "mark read on open", so a P1 read in the inbox stays unread until a button is
pressed; the alert is also delivered by email and (for a P1) phone, so the badge is a reminder rather than the
notification itself. Nothing is ever deleted from the inbox. **Mark all read writes one audit row per cleared
notification**, which is the rule-6 reading but noisy on a large backlog (see above).

