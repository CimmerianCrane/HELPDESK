# ASSUMPTIONS-LOG.md — assumptions 62–264, in numeric order

The running log split out of `docs/ASSUMPTIONS.md`, which keeps the reasoning framework and the
Phase 1 questions. Items keep the numbers they were given; a heading appears where a slice added a
batch. Continue this list numerically — the next item is 265.

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
115. **A quote's expiry is computed, not stored.** `EXPIRED` means a `SENT` quote whose `validUntil` day key is
    behind today's in the operating timezone — the same doctrine as an overdue certificate or a lapsed SLA. There
    is no nightly job to run, and the stored status cannot disagree with the date. The consequence accepted: a
    quote lapses silently, with no email to the customer, because nothing sweeps the list.
116. **A quote belongs to a job, and the customer comes from the job.** `Quote.jobId` is required. "Quote from a
    set of findings" is a prefill on the job's form (the job's open findings become drafts of lines), not a
    separate customer-level quote. This keeps the accept → `QUOTED` → `APPROVED` move unambiguous: there is
    exactly one job to move.
117. **Finance may read quotes; only dispatch and admin may write them.** Quoting is a commercial offer made by
    the people running the job, so `quote.write` stays where it was. Finance gets the new `quote.read` because
    it needs the total before invoicing. The capability and `quoteReadWhere` move together — a grant without a
    scope filter would be a bug under CLAUDE.md rule 1.
118. **Quoting a finding does not change the finding's status.** The prefill copies the finding's recommendation
    into a line marked as a variation; moving a finding to `QUOTED` is the report flow's decision and needs
    `finding.write`, which a dispatcher does not hold. The form says so rather than implying otherwise.
119. **The GST rate is snapshotted on the quote when it is saved**, in `Quote.gstRate` (a new additive column,
    like `Invoice.gstRate`). The alternative — back-computing a rate from the stored amounts — shows 9.01% on
    a rounded subtotal, which is worse than storing four decimals. Editing a draft reprices it at the rate in
    force at that save.
120. **A quote may be raised with any validity date, but not sent once that date has passed.** Raising it records
    the offer; sending it is the act of putting it in front of the customer, so a lapsed one is refused with the
    date named rather than mailed as already-expired. The same rule stops an expired quote being accepted: the
    office raises a fresh one.
121. **Only a reviewed job can be invoiced.** `createInvoice` refuses any job that is not `REVIEWED`, naming its
    status. Billing is the step after the paperwork is signed off: a job still in progress has not necessarily
    used the parts or hours the office is about to charge for, and a job reworked after review would be billed
    twice. The job's costing is a prefill the office edits, so this gates *when* a bill is raised, not what it
    says.
122. **The job moves `REVIEWED → INVOICED` when the invoice is issued, not when the draft is raised.** A draft can
    sit for days and be deleted; the transition is the moment the bill exists. If the job has moved on by then
    (completed without an invoice, cancelled), it is left where it is — `canTransition` decides, so the history
    says the invoice went out but the job's own record is not rewritten to pretend it was still reviewed.
123. **Issuing re-snapshots the GST rate *and* the amounts it produces together.** A draft stores the rate it was
    priced at, but the issue date is when the customer is charged GST. Re-snapshotting `gstRate` alone would
    print "GST (10%)" beside an amount computed at 9%; the service recomputes `gstAmount` and `total` from the
    stored subtotal at the issue rate, in the same update.
124. **`amountPaid` is derived from the payment rows, never posted.** Recording a payment sums the existing
    payments, writes the sum back, and derives the status (`paidStatusFor`): nothing gives the status a way to
    disagree with the money. `PART_PAID` and `PAID` are consequently not moves a person makes, which is why
    `ALLOWED_INVOICE_TRANSITIONS` gives them no exits — an invoice with money on it is voided by a credit note,
    not this slice.
125. **An overpayment is refused, not netted.** A payment that would take the total above the invoice's own amount
    is refused with the amount still owed named. A credit note is out of scope, and a negative balance (money owed
    *to* the customer) is a different document that this slice would misrepresent as a bill.
126. **Job costing reads `StockMovement` at sell price, and writes nothing.** The `ISSUE` movements on the job are
    the same rows a delivery order prints and stock is reconciled from (CLAUDE.md rule 10), so the invoice and
    the paperwork cannot describe different parts. The lines it produces are a prefill — the office edits them,
    adds labour lines by hand — and the stored invoice keeps the lines as written, so a later price change cannot
    rewrite a bill that has gone out.
127. **The job link lives on the invoice lines, because `Invoice` has no `jobId`.** The schema was designed with
    `InvoiceLine.jobId` optional and no column on the invoice, so `invoicesForJob` filters `lines: { some: {
    jobId } }`, the job header shows the first line's job, and editing a draft carries the job each replacement
    line forward. An invoice raised from two jobs would show both under each job's list, which is the honest
    answer rather than a chosen "owner" job.
128. **Finance issues and reads invoices; no other office role does.** An invoice is money owed and a statement to
    a customer, so `invoice.read`/`invoice.write` sit with finance and admin alone — dispatch raises quotes and
    cannot raise the bill that follows one. `invoiceReadWhere` gives finance its exact audience; the caller's
    capability is checked before the scope filter is even built, so a technician gets `ForbiddenError` rather
    than an empty list.
129. The **job move on issue is written by the invoice service, not `transitionJob`.** `transitionJob` requires
    `job.transition`, which finance does not hold; the invoice service writes the status, its `invoicedAt` stamp
    and its `JobStatusHistory` row itself, inside the invoice's transaction, after checking the same
    `canTransition` map. The alternative — granting finance `job.transition` — would let it move any job to any
    state, which is a much larger grant than invoicing needs.
130. **The accounting export writes dates as `YYYY-MM-DD`.** The screens use `DD/MM/YYYY`, which is right for
    people and ambiguous to an importer — `03/04/2026` is two different days depending on who reads it. The day
    is computed in the operating timezone (`dayKey`), so an invoice issued at 09:30 Singapore time is filed on
    the day the office saw, not the UTC date before it.
131. **Only billed money is exported: `ISSUED`, `PART_PAID`, `PAID`.** A draft is still being edited and a void
    invoice is not a bill; neither belongs in a ledger. The panel on `/invoices` states the rule above the link
    so the file cannot surprise the person who downloads it.
132. **The export states the ledger, not today's settings.** Amounts, the GST rate and the paid total are the
    stored ones — a re-export months later shows what the customer was charged, not what the current rate would
    compute. The file does no arithmetic of its own; it reads `listInvoices` and formats.
133. **The export is not audited.** It is a read, not a business mutation, and `AuditAction` has only
    `CREATE | UPDATE | DELETE`. Adding `EXPORT` would need a migration to put "someone looked at the ledger" in
    the same trail as "someone voided a bill", which dilutes the trail rather than strengthening it.
134. **The export is two documents behind one route**, `?what=payments` for the second, and both honour the
    invoice book's own `q`/`status` filters. `AccountingExporter` is the seam: the Xero/QuickBooks push renders
    the same `InvoiceExportRow`/`PaymentExportRow` shapes rather than adding a second export path.

135. **One function writes stock, and it writes the movement and the level together.** `postMovement` in
    `src/server/inventory/stock.ts` is the only writer of `StockMovement` and `StockLevel`, because a movement
    whose level the app does not apply is a ledger nobody can trust — which is what the app had until slice 22,
    when the seed was the only path that wrote a level. Item 58 recorded issuing "with no source location" as a
    temporary state; it ends here.
136. **Stock is allowed to go negative.** A signed field report is never refused because the shelf count is one
    short; the level goes negative and both parts screens say "more issued than received" in red. The
    alternative — refusing the report — loses field data to a stock error, which CLAUDE.md rule 11 forbids.
137. **A stock adjustment carries the counted quantity, not a difference.** The person counting says what is on
    the shelf. An upward difference posts as `ADJUST`; a downward one as `WRITEOFF`, since `WRITEOFF` already
    means stock left without a sale and a two-directional `ADJUST` would need a second sign convention.
138. **The store screen posts `RECEIVE`, `RETURN` and `ADJUST` only.** `ISSUE` is written where the part was
    consumed (the report) and `TRANSFER` needs a second location to be meaningful — slices 23 and 26.
139. **On-hand is computed, never stored** — the sum of `StockLevel` rows read with the part — for the same
    reason overdue dates and quote expiry are derived: a stored total is a second truth that drifts.
140. **The catalogue is not tenant data, so it has no row filter.** Every role holding `part.read` sees the same
    book; the capability is the whole check, and the split that matters is read vs write. Finance was given
    `part.read` to value what it holds and nothing more.
141. **A part number is unique and survives archiving.** The column is unique, so an archived part still holds
    its number; the form says so and asks for it to be restored rather than letting a unique violation reach the
    screen as an unreadable error. There is no restore action yet — archiving a part is not built either.

142. **A location is retired, never deleted, and one holding stock cannot be retired.** Every movement keeps
    naming the location it touched (rule 4), so `isActive` is the soft delete; retiring one with stock still on
    it is refused, and the form says to transfer it out first — which is the moment the shelf and the figure
    are reconciled.
143. **A transfer names both ends.** A receipt falls back to the store and an adjustment works out its own
    direction, but a movement with no source is a receipt and one with no destination is a write-off, so a
    transfer with either end blank is refused rather than guessed.
144. **A transfer larger than the source holds is refused, naming what it holds.** This is the opposite of an
    **issue**, which may take a level negative (item 136): an issue is a signed field document that must not be
    lost, while a transfer is a store action with the shelf in front of the person.
145. **A bin's parent must be a warehouse, checked in the service.** `Location.parentId` has never been a foreign
    key, so the rule lives where it can be tested: the parent must exist and must be a `WAREHOUSE`.
146. **`stock.move` gates a transfer, and locations are not tenant data.** A technician holds `stock.move`
    already (issuing and returning parts), so a van-to-bin move is theirs too; finance reads the book and moves
    nothing. Locations, like the catalogue, have no row filter.
147. **A serial's position is derived from its movements, never stored.** The trace applies the same direction
    table `postMovement` uses to move `StockLevel`, to only the rows carrying that serial. Storing "where serial
    X is" would be a second place to fall out of step with the shelf.
148. **A traced part cannot be issued without a serial; an untraced one may carry one.** `trackSerialOrBatch` is
    what makes traceability a promise, and a rope nobody can follow to a crane defeats it. The server refuses
    and names the part, so the report stays on the phone and is fixed in the van rather than arriving incomplete.
149. **The phone is sent which parts are traced.** The sync bundle carries `trackSerialOrBatch`, so the form can
    say the field is needed and refuse to queue the report without it, with no signal; it is the same courtesy
    the calibration register makes.
150. **The trace reads every serialled movement for one part.** It is unbounded on purpose: a serial's
    balance computed from part of its history would answer "where is it" wrongly, and that is the question the
    screen exists for. If a real catalogue line ever makes it slow, the window belongs on the serial.
151. **A count correction carries the serial when the counter names one.** The trace and the level are two
    renderings of one ledger, so an `ADJUST`/`WRITEOFF` that moved the shelf but not the batch would let them
    disagree — the one thing slice 24 promised (item 147). A serial is not required to count, only kept.
152. **An issue takes the location that holds the named serial.** When the report names one, the source is the
    bin or van that serial is actually in, read from its movements; the fullest bin is the fallback for no
    serial or one never received, and it stays a guess rather than a refusal (item 136).

153. **The suggested order quantity is the store's, then the arithmetic.** A part with a `reorderQty` is suggested
    that amount; without one, enough to bring the shelf back to the reorder level (which handles a negative shelf
    correctly). The store's number wins because it knows about a supplier's pack size.
154. **Below-reorder parts are grouped by preferred supplier, and the unassigned group is named.** A purchase order
    requires a supplier, so a part with none is listed with a link to the part and no raise form — the screen says
    what to fix rather than hiding the part or inventing a supplier.
155. **The raising form posts quantities, never prices.** Description and cost are re-read from the catalogue inside
    the transaction and snapshotted on the line, so a stale page cannot price an order and a later price change
    does not rewrite an order already sent.
156. **A blank quantity leaves a part off the order.** Every short part in a supplier's group is offered with its
    suggested quantity; blanking or zeroing one is the store saying "not this one". Nothing is deleted.
157. **A receipt larger than the line still owes is refused, naming the remainder.** An issue may take a level
    negative because a signed field report must not be lost (item 136); a receipt is a store action with the
    delivery in front of the person, and the extra belongs on the store's own receipt form.
158. **A purchase order's status is derived from its lines.** `DRAFT` until something arrives, `PARTIAL` while
    lines are short, `RECEIVED` when every line is whole. Nothing sends or cancels a PO yet, so `SENT` and
    `CANCELLED` are unused.
159. **A PO receipt is one `RECEIVE` per line through `postMovement`, carrying `purchaseOrderId`, into one
    location.** The order's running quantity and the shelf are the same arrival. A serial is recorded when the
    store types one, so a traced part received on a PO stays traceable. `purchaseorder.write` belongs to the
    storekeeper and Admin.

160. **A stock take's system quantity is a snapshot; approval reconciles to the live shelf.** The session copies
    what each line held when it opened, so the review shows the difference the counter worked against. Approving
    re-reads the live level and posts the difference to what is actually there — so a delivery that arrived
    during the count is reconciled, not reversed. A line that already matches at approval is skipped, not refused.
161. **A variance is counted less system, from one function.** Positive means stock the books did not have. The
    review table, the approved record and the posted movement all call `varianceFor`, so a sign cannot be flipped
    in one of three places and silently double the error the count exists to fix.
162. **A stock take posts through `adjustToCounted`, the same writer as the part page's count box.** Upward as
    `ADJUST`, downward as `WRITEOFF`, each carrying `stockTakeId` (item 137, applied). There is no second
    correction path.
163. **A partial count cannot be approved, and a write-off needs a reason.** Approving with any line uncounted
    would write off the lines nobody looked at. A downward difference with no reason anywhere on the session is
    refused; a line that carries its own reason keeps it.
164. **A stock take's status is derived from its lines.** `DRAFT` until something is counted, `COUNTING` while
    lines remain, `REVIEW` once every line has a count (a zero counts), `APPROVED`/`CANCELLED` after that.
    An approved count cannot be cancelled: it is the record the ledger was reconciled against.
165. **One open session per location; an empty location still gets a session.** Two counts of one shelf produce
    two answers and one argument. A location with nothing in it opens an empty session whose approval posts
    nothing — "we counted the van and it was empty" is a result worth recording.
166. **`stock.move` counts, `stocktake.approve` approves.** A technician counts a van but cannot write stock off;
    the storekeeper and Admin approve; finance reads the book and does neither. The capability was already in the
    map, unused, until this slice.
167. **A supplier's price history is the purchase orders raised from it, not a separate price table.** What the
     store paid is what the document it sent says; a `SupplierPrice` table would be a second record of the same
     number, free to disagree with it.
168. **A supplier is retired (`deletedAt`), never deleted.** The parts that prefer it and the orders raised from it
     keep naming it. A retired supplier drops out of the part form's choices and the reorder grouping but stays on
     its own page and on its past orders.
169. **Retiring a supplier that a part still prefers is refused, saying how many.** A part whose preferred supplier
     is retired lands in a reorder group nothing can order from — the state slice 25's unassigned group warns
     about, reached invisibly.
170. **A part may not prefer a retired supplier**, checked in the service on create and update, so a stale form
     cannot make an orderless part.
171. **`preferredSupplierId` lives on the part form.** The reorder grouping has always read it and no screen could
     set it; the form takes the active suppliers as an optional prop.
172. **Reads ride on `part.read`, writes on `supplier.write`.** The book is a view of the catalogue, not a separate
     register, and a role that could write without reading would edit what it cannot see. `supplier.write` has been
     in the permission map since slice 22 and is the storekeeper's and Admin's.
173. **Supplier names are unique**, as location names are: two "Sin Heng"s in a dropdown is a support call.
174. **A job names at most one part it is waiting for**, a nullable `Job.onHoldPartId`. A hold that waits on two parts
     is a job the store is waiting for two deliveries on; the second is visible on the part's own page and in the
     note, and a join table for it would be a feature nobody asked for yet.
175. **A part may only be named on an `AWAITING_PARTS` hold**, enforced in the schema and cleared whenever the job
     leaves that hold. A weather hold naming a brake would put the store's attention on a part the job is not short of.
176. **"When it lands" is not stored.** It is the `expectedAt` of the open purchase order line still owing the part, read
     when the job page renders — the same derive-don't-store rule as quote expiry and overdue schedules.
177. **`PurchaseOrderLine.backOrderedQuantity` stays unused.** The outstanding quantity (ordered less received, on an
     open order) already *is* the back-order; a second number could only disagree with it.
178. **"Late" is counted in whole days in the operating timezone**, because an order past its date is a problem to
     chase rather than a plan to restate.
179. **A contract's targets are `SlaPolicy` rows carrying the contract's id, not `Contract.slaOverrides`.** The JSON
     column is dead — nothing reads it — and two records of one negotiated number can only disagree while a job
     snapshots from whichever it read. The column stays unused rather than being filled "for consistency".
180. **A blank priority follows the company-wide target.** The form never shows a number the contract has not agreed
     to, and saving replaces the contract's rows wholesale, so clearing a pair removes the row rather than zeroing it.
181. **A priority carries both numbers or neither**, because `SlaPolicy` is one response and one resolution per row; a
     half pair would leave the other number undefined at the moment it matters.
182. **Contract reads ride on `customer.read`, writes on `sla.manage`.** Dispatch and finance need to see the agreed
     terms; changing a target is the capability that has guarded targets since Phase 1, unused until now.
183. **A contract covers this customer's cranes only, checked in the service.** No cranes ticked means the whole
     account (usually an AMC); named cranes mean only those. The ids are validated against the customer inside the
     transaction, because a tampered form could otherwise attach another customer's crane.
184. **A contract is retired (`deletedAt`), never deleted.** Jobs and tickets keep naming it, so a retired contract
     leaves the list and `insertJob`'s lookup but keeps its SLA rows as the record of what was agreed.
185. **A renewal badge uses 90 days, counted in whole UTC days** — the same window certificates use — and is derived
     on read, never stored.
186. **The company-wide SLA targets are edited on one screen, `/admin/sla`, all four priorities at once.** The four rows
     are one policy; saving them one at a time invites a half-applied pair. Writing them is `sla.manage`, the capability
     that has guarded targets since Phase 1.
187. **A company-wide target row is found with `findFirst` and then updated or created, never `upsert`ed.** Company rows
     carry `contractId = NULL`, and Postgres treats NULLs as distinct in a unique key, so `upsert` cannot name the row.
     An inactive row edited here is reactivated rather than duplicated.
188. **A priority with no company row keeps the built-in default, and the screen says so.** `DEFAULT_SLA_POLICIES` is the
     code fallback `resolveSlaTargets` already had; showing the built-in number with a "nothing configured" badge is
     truthful, while a blank field would suggest no target exists. No row is ever deleted or zeroed from the screen.
189. **Resolution may not be quicker than response, refused per priority in the schema.** A pair where the resolution
     clock ends before the response clock is not a target; both are whole minutes, at least one, at most a year.
190. **The renewal board lives on `/customers` and ignores that page's filters.** An overdue renewal hidden because the
     list is filtered to "prospect" would be the one failure the board exists to prevent. It reuses the 90-day window
     and `renewalState` of slice 29, applied in the query as well, so the board and the customer page cannot disagree.
191. **The renewal board rides on `customer.read` and `customerReadWhere`.** It sits on the customer list, so anything
     that can open that page can see it, and nothing else can; no separate capability was invented for it.
192. **Editing a company-wide target does not touch jobs already raised.** A job snapshots its deadline at creation, as
     it always has; a correction therefore shows on new jobs only. Changing history is what amending a report is for.

193. **A portal login is a `User` with `role = CUSTOMER` and a nullable `customerId`, not a separate account table.** The
     existing password login, rate limiter, session invalidation and deactivation all apply to it unchanged; a second
     table would have needed a second of each. Several logins may belong to one customer (site contact, accounts contact).
194. **`CUSTOMER` holds exactly four capabilities: `portal.read`, `crane.read`, `certificate.read`, `report.read.own`.**
     The last three are the existing capabilities, so the portal calls the same crane and certificate services the office
     does. `job.read.all` is not granted, because `jobReadWhere` treats it as "unfiltered" and the portal's job list is
     narrowed by the `customerId` branch instead. No write capability is granted at all.
195. **A `CUSTOMER` login with no `customerId` is refused, not scoped to nothing silently.** That is the one shape a
     half-finished admin save leaves behind, and a portal that reads "you have no jobs" for it would hide the mistake.
196. **The customer picker is required when the role is CUSTOMER and refused for every other role.** A staff account
     carrying a `customerId` would be narrowed to that customer's data by the `customerId` branches in scope.ts, which is
     a data leak rather than a spare field. The chosen customer must be live (`deletedAt = null`), checked in the service.
197. **The portal lists only `APPROVED` reports.** A submitted report has no document number and no issued PDF; showing a
     customer an unfinished page is the failure mode this filter exists to prevent. The filter is in `portalReports`, not
     in the scope, because a technician's `report.read.own` deliberately does reach drafts.
198. **The portal is read-only: no ticket raising, no invoice or quote access.** Brief §3 lists "raise tickets" as a
     customer capability, and PLAN §7.14 scoped this slice to jobs, cranes, certificates and reports. Raising a ticket is
     a write path with its own intake questions and is left to a later slice rather than bolted onto a read-only portal.
199. **One demo portal login is seeded (`portal@cimmeriancrane.example`), attached to the first demo customer, behind the
     same demo-data gate as every other invented row.** It shares the published demo password and is skipped on any
     database that is not local unless `SEED_DEMO_USERS=true`, so it can never land in a real register.

200. **Profitability costs parts only — labour is not costed.** No hourly or per-job labour cost exists in the data model;
     `Technician` has no rate and an invoice's labour line is sell price, not cost. The report therefore subtracts the
     `ISSUE` movements' `unitCost` from invoice subtotals and labels the column "Parts cost", never "cost of sale", so the
     margin is not read as gross profit. Adding `Technician.hourlyCost` and an hours source is the one place to extend it.
201. **Revenue is the invoice subtotal excluding GST**, on `ISSUED`, `PART_PAID` and `PAID` invoices only, dated by
     `issueDate` — a draft is not a bill and a void invoice never was, and the day money became receivable is the issue
     date rather than the creation or payment date.
202. **A job's material is booked once, to the period its invoice falls in.** A job billed on two invoices, or invoiced after
     its parts were issued, contributes its whole material cost to the invoice window in which it first appears — so a job
     invoiced in March for February parts shows both in March rather than splitting cost across periods. A job that has not
     been billed at all contributes nothing, because unsold material is work in progress, not a loss.
203. **Invoice lines with no job behind them are counted in the totals and against their customer, but in no contract or
     job type.** Labour typed straight onto an invoice has no job to attribute. The screen says how much that is rather
     than inventing a "No job" row, so the reason the three tables do not reconcile is on the page.
204. **The report is a read behind `report.financial` (finance and admin).** It is not audited and exports nothing yet; the
     slice is the report, and a CSV of it can reuse the accounting export's seam if asked.

205. **A technician's time on the tools is the `IN_PROGRESS` span from `JobStatusHistory`, not a new hours table.** The
     history is append-only and timestamps every move, so a visit's duration is already recorded; a second table of
     typed hours would be a second opinion about the same fact. A job that was held and resumed sums the segments,
     excluding the hold.
206. **Time on the road runs dispatch to completion**, so it carries the travel either side of the visit and any hold in
     between. A job with no `DISPATCHED` row falls back to the on-site span rather than inventing travel.
207. **A job's hours are shared between the technicians on it**, not credited to each in full. The report counts the job
     once in its total.
208. **Hours are booked to the day the job completed.** A job still in progress has no known total, so it contributes
     nothing until it finishes — which makes the most recent days read low, and the screen says so.
209. **Available hours are Monday–Friday, 09:00–17:00, less leave that overlaps those hours.** No shift pattern and no
     public-holiday table exist in the system, and the brief never asked for one. The working calendar is a code
     constant with a `shortcut:` comment naming where to move it if the office works shifts. *If wrong:* the denominator
     is the only thing that changes; the worked hours are unaffected.

210. **The calibration register is the existing `Resource` table, not a new `Calibration` model.** Those rows are what the
     scheduler books and what the load test's instruments table names, and `calibrationDueDate` has been on them since
     Phase 1. A second table holding the same dates would be a second opinion, and the register, the booking warning
     and the report could disagree.
211. **A calibration certificate is a `File` with `kind = CERTIFICATE`, `entity = 'Resource'`, `entityId` = the
     equipment.** It accepts the same types and 5 MB limit as a crane certificate — a scanned lab report is a scanned
     document — and the service refuses a file uploaded for any other item, so one piece of equipment cannot show
     another's paperwork.
212. **The certificate is attached on edit, not on create.** The upload's storage key names the resource's id, and a new
     item has no id until it is saved. The form says so and offers the file field only on an existing item, rather than
     creating the row twice or inventing a placeholder id.
213. **Calibration writes are `resource.write`, held by the storekeeper; dispatch keeps `resource.read`.** The store
     maintains the kit's paperwork and dispatch books it. Retiring is the `RETIRED` status, refused while the item is
     booked on an unfinished job and naming those jobs; the row is kept, because jobs, bookings and the audit trail
     name the equipment forever.

214. **The round starts at whichever visit is scheduled first, not at a depot.** No depot, base or workshop address
     exists in the system, and moving the first visit to shorten the drive would be a reschedule dressed as a
     suggestion. The rest are ordered from the fixed first stop. *If wrong:* a starting point becomes one more input to
     `planRoute`, not a rewrite.
215. **Route optimisation is a read and writes nothing.** The order is advice the dispatcher acts on by dragging cards;
     there is no `Route` row, no audit entry, and no visit is moved. *If wrong:* saving a round is a new table, not a
     change to this one.
216. **Nearest neighbour followed by 2-opt, with the start pinned.** Exact shortest-path is factorial; a working day is
     under a dozen stops and this is within a few per cent, instantly and deterministically. Ties break on the order the
     caller supplied, so the same day always plans the same round.
217. **Distance is a great-circle line and drive time assumes 30 km/h.** Nothing records road distance, traffic or a
     travel-time matrix, and adding a mapping provider is a dependency and an API key the brief never asked for. Both
     caveats are on the screen. *If wrong:* road distance replaces one function, `distanceKm`, and the rest of the
     ordering is unchanged.
218. **A site with no coordinates is set aside, not dropped.** The round lists those visits in an amber block naming the
     job and the fix. Silently omitting a visit because its map pin is missing would make work invisible, which is worse
     than an incomplete round.

219. **SMS and WhatsApp carry P1 alerts only.** The brief names them for P1 alerting (§4.3) and nowhere else. Dispatch,
     obligation reminders and the rest stay in-app and by email: a dispatch to a technician is already a push to the app
     they work in, and a reminder that rings a dispatcher's phone about a service due in 60 days would train them to
     ignore the channel before the P1 that matters arrives. *If wrong:* `fanOut` already takes the switch —
     `phoneChannels: true` on another caller is one line, and `dispatch` (which builds its own rows) would need the same
     treatment.
220. **A phone alert is one line and a link, not the notification body.** SMS is billed per 160-character segment and a
     dispatcher reads it on a lock screen. The row stores the short text, so the log of what was sent matches what was
     sent. *If wrong:* the length is `phoneText` in `notify.ts`, not a schema change.
221. **No phone number, no phone row.** A recipient with a blank `User.phone` gets no SMS or WhatsApp row, rather than a
     row that can never be sent. A dispatcher who has not been given a mobile has one to enter at `/admin/users`; this is
     not a broken channel and does not read as one.
222. **The drivers are declared and not built.** `SMS_DRIVER` accepts `twilio` and `WHATSAPP_DRIVER` accepts `meta`,
     and both fall back to the console driver with a warning — the same shape `EmailAdapter` took with SMTP in Phase 1.
     The seam is the deliverable; choosing a gateway is a purchasing decision and needs credentials nobody has supplied.
     *If wrong:* one file, `src/server/notify/message.ts`, gains a real `send`; nothing else changes.

223. **Xero first, via a custom connection, and nothing else until asked.** The brief names "Xero/QuickBooks" as one
     item. Xero's custom connection is a client-credentials grant: one org, no consent screen in the app, no refresh
     token to store — which is what makes it possible on Vercel without an OAuth callback nobody has built. QuickBooks
     is a second driver behind the same interface when asked. *If wrong:* `createXeroDriver` is the file; the seam and
     the `Invoice.externalRef` record do not change.
224. **The accounting system computes the GST; the bill's total is the check.** Lines go to Xero at their unit prices
     with the org's tax type (`XERO_TAX_TYPE`, env), so GST lands in the right box for filing rather than as a
     description line. The invoice was priced at a rate snapshotted on its issue date, so the push compares Xero's
     returned total against the stored one and reports a mismatch instead of marking it pushed — a bill in Xero for a
     different amount is worse than a bill not in Xero. *If wrong:* both GST arrangements are wrong for filing anyway,
     and a manual fix is one invoice in Xero's UI.
225. **A bill is marked pushed only after the system returns its id, and pushing twice sends nothing twice.** The
     `externalRef` write is guarded on `null`, and the request carries `Idempotency-Key: cimmerian-<invoice number>`,
     so a retried press returns the same Xero invoice rather than creating a second. `externalRef` and
     `externalPushedAt` on `Invoice` are the record. *If wrong:* a failed write leaves the bill unpushed and the next
     press retries it — the safe direction.
226. **A failed push is a report, not a rollback.** The live calls happen outside the transaction; each success is
     written in its own, so one refused bill cannot undo the fifteen that went through. The screen lists what was
     pushed, what was already there, and the first reason anything was refused. Payments are not pushed — invoices
     only — so a bill's balance in Xero is whatever Xero computes from its own payments.

227. **A notification is addressed to one person, and the inbox is read through that id.** `notificationReadWhere`
     returns the caller's `userId` and there is no capability that widens it — an inbox is not a book. An Admin opening
     a dispatcher's alerts would see the same P1 twice and lose track of their own badge. *If wrong:* the filter is one
     branch in `scope.ts`; a support screen that reads another person's inbox is a deliberate addition, not a fix.
228. **Marking somebody else's notification read is `NotFound`, not `Forbidden`.** The caller is not meant to know that
     the row exists at all; a 403 confirms it does. This is the same choice `my-jobs.ts` makes for another technician's
     job (slice 7).
229. **The inbox lists in-app rows and failed deliveries only.** A sent email or SMS carries the same text as an in-app
     row already on the screen, so listing it would say everything twice. A failed one *is* listed, with its reason,
     because a dead mail server visible only in a log is what the inbox was built to stop.
230. **The unread and failed counts are of the whole inbox, not the filtered list.** A badge that shrank when the reader
     switched to the Unread tab would be counting the tab, not the work.
231. **The badge counts the rows the inbox actually shows.** An email row is written beside every in-app row and its
     `readAt` is never set, so counting every null would make one P1 read as "2 unread" beside one visible row. The list,
     the badge and Mark all read share one `VISIBLE`/`VISIBLE_UNREAD` condition — in-app, or a failed delivery. An
     integration test pins it.

232. **The paper is two documents, and the Service Report is its own row, one per job.** The technician fills a
     **Servicing checklist form** per crane — an ordinary `Report` whose job type carries `JobType.isServiceReport` —
     and the visit's **Service Report** is a separate `ServiceReport` row, `@@unique([jobId])`. It belongs to the
     visit, not to a crane: it is built from every crane's checklist, its prose is edited after submission, and it
     carries its own `SR…` number. Folding it into the per-crane report would give one table two owners and two
     lifecycles. *If wrong:* the row is additive and one job's reports could be re-parented to it; nothing in the
     checklist forms changes either way.
233. **A grade is stored in `Report.data.grades`, keyed by `ChecklistItem.code`, with the line's wording snapshotted in
     it.** It sits beside the reserved `checklist` key because the two are two halves of one paper line, and the snapshot
     is what lets an old report render exactly as signed once the checklist template is superseded (rule 5). No new
     table and no new column on `ChecklistAnswer`. *If wrong:* the data is JSON a migration can reshape; the snapshot is
     the part that must stay either way.
234. **Ungraded is `null`, never `0`, and the scale is 1–5 with words attached.** 5 As new, 4 Good, 3 Serviceable,
     2 Repair soon, 1 Failed. Anything outside 1–5 is refused by the schema and again by the service, so a phone with a
     stale rule and the server agree on the refusal. A form that read "not looked at" as "failed" would be worse than
     the paper it replaced. *If wrong:* the labels are one constant in `validation/reports.ts`; rewording is safe,
     changing the scale would make old and new reports incomparable and is a new grading scheme, not an edit.
235. **Every *answered* checklist line must be graded; a line left completely blank need not be.** Answered means a
     result, a measurement or a note. Requiring every line would force a grade on a component nobody inspected, and
     requiring none would let the form be submitted with no ratings at all. The check lives in `submitReport`, so it
     holds whatever the phone does. *If wrong:* it is one filter in the service, and loosening it changes no stored
     report.
236. **The SR number is issued on approval and carries the approval month, in the operating timezone.** `SR2606001` is
     the first Service Report approved in June 2026; a report signed 31 May and approved 1 June is June's first. This is
     the rule `RPT-…` already follows, and the number is issued once, as the document becomes immutable. *If wrong:* the
     office would want the visit month instead — one line in `approveServiceReport` reading the job's completion date;
     reports already issued keep their numbers.
237. **The monthly counter is one `DocumentSequence` row keyed `SR:<yymm>`, not a new table or a per-month column.**
     `nextServiceReportNumber` uses the same atomic `INSERT … ON CONFLICT … RETURNING` the yearly sequences use, so the
     month rolls over by itself and two concurrent approvals cannot share a number. The key embeds the month because a
     month must restart at 001. *If wrong:* a wrong key is a row to delete while nothing has been issued against it;
     after the first issue the key is history.
238. **Only the seeded `PM` type's reports are graded, and the flag is office-owned data, not code.**
     `prisma/seed-templates.ts` sets `isServiceReport` on `PM`, and the seed flips an existing row on once, never off,
     so an office decision to unset it survives the next seed. A second servicing type is a row edit. *If wrong:* it is
     a boolean on a row an admin changes; no code change either way.
239. **The office may reword the generated prose but not restructure the Service Report.** `buildServiceReportContent`
     writes one sentence per graded part, worst first; `saveServiceReport` keeps whatever the office wrote, but a part
     with no sentence is refused, so an edit cannot blank one out, and there is no way to add a part, change a crane or
     change a grade. Wording is judgement; the list of parts is what the technicians inspected, and changing it after
     the visit would make the document claim an inspection that did not happen. *If wrong:* adding or removing a part is
     a deliberate change to the content contract and the service, not an edit the office can make on the page.
240. **The tablet layout is one wider column, not a two-pane router.** At `md` the shell goes to `max-w-4xl` and
     job cards and the report form form two columns; there is no list/detail split and no sidebar. A two-pane
     router is a parallel-route rewrite of a navigation that already works with a back tap, and it can be added
     later without undoing this. *If wrong:* the layout is Tailwind classes on three files.
241. **The installed app opens in `standalone`, orientation `any`.** `standalone` is the window-without-chrome the
     owner asked for; `fullscreen` would hide the clock and battery through an eight-hour shift. Landscape is how a
     crane gets inspected, so nothing is locked. *If wrong:* one line each in the manifest route.
242. **The tablet's login and sign-out stay inside `/m/`.** `/m/login` reuses the website's form and server action;
     an expired session or a sign-out lands there rather than `/login`, which is outside the manifest scope and
     opens Chrome. The cost is that the deep link is lost — login always returns to `/m/jobs`. *If wrong:* widening
     it means carrying `next` through the redirect the gate already computes.
243. **Signing out clears Dexie and Cache Storage, but not an expired session.** The two-step prompt guards the
     pending queue. An expired session cannot safely clear anything (it would delete unsent reports), so cached
     data stays readable through the offline fallback until someone signs in. Accepted while tablets are assigned
     to one technician. *If wrong:* the fix is per-user cache partitioning, not a bigger clear.
244. **Icons are committed PNGs from `scripts/make-icons.ts`, not SVG or build-time rendering.** Chrome accepts SVG,
     but the TWA/Play path and Android's launcher want exact raster sizes and a real maskable square, and a
     build-time image render would add Chromium to every deploy for three files. *If wrong:* re-run the script.
245. **The install card shows even when `beforeinstallprompt` never fires.** It then points at Chrome's own
     "Add to Home screen" instead of offering a button. The plan said to hide it; hiding it installs nothing,
     and the fallback is the same advice a technician would get from the browser anyway. It is on `/m/jobs`
     only and dismissal lasts 30 days. *If wrong:* one condition on the card and one e2e assertion.
246. **A new build never activates itself.** `skipWaiting: false` and a banner that needs a tap; a closed app
     updates on its cold start. An open report can then never ask a new build for JavaScript it did not load.
     `reloadOnOnline` is off so Serwist cannot reload the page behind the banner's back. *If wrong:* the setting
     and one message handler in `src/app/sw.ts`.
247. **The session is 24h for everybody, not only installs.** Auth.js sets `maxAge` per provider, not per
     device, so the tablet's shift-long session and the office's are the same token lifetime. The cost is
     bounded because `getAuthContext()` re-reads the user from the database on every request: a deactivation or
     role change still takes effect on the next page load. *If wrong:* one line in `src/server/auth/config.ts`.
248. **A 401 from the outbox stops the run and is not counted.** A dead session would otherwise burn a finished
     report's retry count until it read as broken once the technician signed back in. The queue stays exactly as
     it was, and the sync line offers sign-in rather than Retry. *If wrong:* the count comes back in
     `keepFailed` and the banner shows the upload path instead.
249. **Background Sync resolves on refusals and rejects only what can pass.** Rejecting a `sync` event tells Chrome
     to retry with backoff, so the worker rejects only for a network error, 5xx or 429; a 401/403 or a 4xx
     refusal resolves and tells the page instead. Retrying a permanently refused report for days wastes battery
     and never succeeds. *If wrong:* `isRetryableError` in `src/offline/outbox.ts`, plus its unit test.
250. **Everything outside `/m/` and `/_next/` is `NetworkOnly` in the worker.** The previous `defaultCache` set
     cached `/api/tech/sync` (under a 24h rule) and office documents, on a worker registered at scope `/`. Losing
     the cache costs an office page its offline view, which the plan never promised; keeping it meant serving a
     plausible-looking stale bundle. *If wrong:* delete the first `runtimeCaching` entry in `src/app/sw.ts`.
251. **The page stays the primary uploader.** Background Sync is Chrome-on-Android and best-effort — Doze or a
     force-stop delays it — so `online` still flushes on the page and the worker is the fallback for a pocketed
     tablet. Both run the same queue through one Web Lock, so ordering holds either way. *If wrong:* nothing;
     the page path alone was already correct, and the worker is additive.

## Slice 43 — push when a job is dispatched

252. **A `WEB_PUSH` notification row is written per subscription actually reached, not per recipient.** A
     technician with no installed app is not a broken channel, the same rule as a dispatcher with no phone
     number getting no phone row. *If wrong:* write a failed row per technician in `dispatchJob`'s push
     block.
253. **404 and 410 disable a subscription; every other failure only counts.** The endpoint is gone for good
     (the app was uninstalled), so it stops being sent to and the row stays as the record. A push service that
     is briefly down is not a dead tablet, so a 5xx increments `failureCount` and leaves the row enabled.
     *If wrong:* the `gone` branch in `sendPushToUsers`.
254. **A subscription belongs to the caller and an endpoint can be reassigned.** The subscribe body names
     nobody, and an endpoint already registered is upserted to the new user — a shared tablet that changes
     hands must stop sending the old technician's alerts. *If wrong:* drop `userId` from the upsert's
     `update` in `subscribePush`, which turns a shared tablet into a leak.
255. **Push is off until all three VAPID variables are set.** Matching `EMAIL_DRIVER`, a deployment without
     them behaves exactly as before; nothing throws and no dispatch fails. The card on `/m/jobs` does not
     render, so nobody is asked for permission that would buy nothing. *If wrong:* `pushConfigured()` and the
     card's `publicKey` prop.
256. **Sign-out ends the tablet's alerts before it clears the cache.** The local `unsubscribe()` and the
     `DELETE` are both best-effort, because failing to leave somebody signed in on a shared tablet is the
     worse outcome. *If wrong:* `dropPushSubscription` in `src/components/tech/tech-sign-out.tsx`.

## Slice 44 — scan a crane QR label

257. **The label's shape lives in `lib/cranes/qr.ts`, not beside the generator.** The generator needs
     `node:crypto` and is server-only; the scanner and the report form both run on the tablet. The server
     module re-exports `isCraneQrValue` and `craneQrPayload`, so the split costs no call-site change.
     *If wrong:* move them back and make the client bundle pull a Node module — the build will say so.
258. **Only the token reaches the tablet, not the full label URL.** The client compares what it parsed to
     `TechCrane.qrValue`, so shipping `craneQrPayload(...)` as well would be a second source of truth in
     the cache for no gain. *If wrong:* add the field in `toDetail` and compare on it.
259. **Any host is accepted in a scanned URL; only the path is read.** Labels printed under an old domain
     keep working, and a token that is not in the tablet's cache matches nothing, so a hostile URL buys
     nothing. *If wrong:* the `new URL` branch of `craneQrValueFromPayload`.
260. **A bare token is accepted, in any case.** A damaged label gets typed in, and a keyboard may produce
     lower case; rejecting it would send the technician back to squinting at the QR. *If wrong:* drop the
     `toUpperCase()` line and require the manual box to carry the exact token.
261. **A scan on the job sheet opens the report for that crane, or jumps to the visit it is cached
     under.** It never guesses: a token on no cached job says so. This is the offline path — a crane
     assigned after the last sync is deliberately not scannable. *If wrong:* the fallback branch in
     `handleScan`, `src/components/tech/job-sheet.tsx`.
262. **"Verify crane label" confirms; it never switches the report's crane.** A report belongs to the
     machine it was opened for, and moving it mid-fill is how a crane's history goes wrong. *If wrong:*
     the different-crane branch in `verifyLabel`, `src/components/tech/report-form.tsx`.
263. **`JobSheet` is a client component now.** It renders the scanner overlay and reads Dexie for the
     other-visit lookup; it is already rendered by both a server page and the client-only offline shell.
     *If wrong:* move the scan action into its own small client component and leave `JobSheet` server.
264. **The camera is Chromium/Android only and HTTPS only, and a mobile camera is not testable in CI.**
     Where `BarcodeDetector` is absent the action does not render and the typed code box is the whole
     entry path; the parser is the part with a unit test because it is the part that can be wrong.
     *If wrong:* `detectorSupported()` in `src/components/tech/qr-scanner.tsx`.
