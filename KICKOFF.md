# KICKOFF.md — the original brief, and where the build stands

**Point a fresh session at this file first.** It holds the kickoff brief exactly as it was given,
including the phase plan (§12) and the definition of done (§14), followed by the Phase 1 slice table
and the state of the build. Everything else is in the repository:

| File | Holds |
|---|---|
| `CLAUDE.md` | Conventions, stack, commands, domain glossary, and the rules that must never be violated |
| `docs/PLAN.md` | Architecture, data model, screen list, the canonical slice table, testing strategy, risks |
| `docs/ASSUMPTIONS.md` | Every assumption made where the brief was silent |
| `README.md` | How to run it, and what works today |

---

## Where the build stands

**Phase 1, slice 9 next.** Slices 0–8 are built, verified against the live Supabase database and
committed (slice 8 is `164a72a`). Phases 2–4 have not been started. **Stop after slice 9; do not begin
slice 10 in the same session unless asked.**

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
| 9–11 | not started |

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
**Not yet built:** report approval, locking, amendment and PDF (9), broader lists and dashboards
(10), and the end-to-end happy path (11).

Decisions that depart from the brief as written, all already in the code and in `docs/PLAN.md`:

- **Hosting is Vercel**, which replaced three of the brief's defaults: there is no pg-boss worker
  (Vercel Cron calls `/api/cron/daily` with `CRON_SECRET`), PDFs will use `@react-pdf/renderer`
  rather than Playwright/Chromium, and uploads go to Supabase Storage rather than local disk or S3.
- **The database is hosted Supabase** (region `ap-northeast-2`). `docker-compose.yml` is still in the
  repository but unused.
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
database round trip is ~700–900 ms (Seoul), so round-trip count in hot paths matters, and
`test:e2e` runs a single worker for that reason. The service worker is off under `npm run dev` on
purpose, so offline behaviour — including the offline half of the technician e2e test — is checked
against `npm run build && npm start`.

### The Phase 1 slices

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

---

## Slice 8 is done — resume at slice 9

**Goal of slice 9:** approval, locking and PDF — a submitted report becomes a document with a number, an
approval trail and an amendment path. The canonical description is `docs/PLAN.md` §6 (slice 9) and the
slice table above; the brief section is §12.7.

What already exists, so slice 9 builds on it rather than beside it:

| Need | Where it is |
|---|---|
| Report validation, submission, `reportsForJob` | `src/server/reports/reports.ts`, `src/lib/validation/reports.ts` |
| Outbox application and idempotency | `src/server/tech/outbox.ts`, `POST /api/tech/sync` |
| Photo and signature storage | `src/server/storage/storage.ts`, `src/server/storage/files.ts` |
| The phone form, its draft and its queue | `src/components/tech/report-form.tsx`, `src/offline/db.ts`, `src/offline/outbox.ts` |
| The template shape a PDF must render | `src/lib/templates/schema.ts` |
| `report.approve` / `report.amend` capabilities (Admin, Dispatcher) | `src/server/auth/permissions.ts` |
| Document numbering — `nextDocumentNumber(tx, 'REPORT')` already works | `src/server/documents/sequence.ts` |
| Email adapter (`console` \| `smtp`) and the in-app + email fan-out pattern | `src/server/email/email.ts`, `src/server/notify/notify.ts`, `src/server/schedule/dispatch.ts` |

Facts slice 8 settled that slice 9 inherits (`docs/ASSUMPTIONS.md` items 52–61): a submitted report is
`SUBMITTED` and immutable; `Report.data` holds the template answers plus a reserved `checklist` key;
findings exist as rows and inside `data.findings`; parts used are `StockMovement` rows; photos and
signatures are `File` rows attached to the job; and the `disk` driver's `signedDownloadUrl` still throws,
which the PDF is the first thing to need.

Four things slice 9 must **add** — none of them exist yet:

1. **`@react-pdf/renderer` is not installed.** It is the one dependency slice 9 is allowed (PLAN §2); add
   it and nothing else.
2. **There is no reports queue.** `src/app/(office)/` has no `reports/` directory; submission is reached
   only from the phone. The approval screen, the approve/return action and the amendment action are new.
3. **The crane timeline is still a placeholder** (`src/app/(office)/cranes/[id]/page.tsx:192`) that says
   reports will appear there. Populate it, then delete the sentence.
4. **The disk download route.** `signedDownloadUrl` for `disk` needs a GET counterpart to
   `/api/files/store` (HMAC token, same signing secret) so the PDF can embed photos in dev and tests.

The `Report` model already carries every field approval needs — `documentNumber`, `pdfFileId`, `approvedAt`,
`approvedById`, `amendmentOfId`, `amendmentReason`, and `ReportStatus.AMENDED` — and `FileKind.REPORT_PDF`
exists, so slice 9 should need no migration. If it does, add one; never edit an applied migration.

**The test PLAN §9 calls for and slice 9 must write:** re-render an approved report after a template change
and diff it against the original, proving the render function is selected by `Report.templateVersion` and
the stored `data`, not by the template as it stands today.

**Known trap on this machine:** `tests/e2e/report.spec.ts` deletes and recreates the report on one seeded
breakdown job (Ahmad's). A slice-9 e2e that approves a report on that same job will collide with it, and
neither is safe against a shared database.

---

## The kickoff brief (verbatim)

Everything below this line is the brief as it was given. It has not been edited.

---

# Project brief: Cimmerian Crane Services — Helpdesk & Job Management App

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
