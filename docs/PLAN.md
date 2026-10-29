# PLAN.md — Cimmerian Crane Services Helpdesk

Architecture, data model, screens and build plan. Conventions and non-negotiables live in `../CLAUDE.md`.
Assumptions where the brief was silent live in `ASSUMPTIONS.md`.

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

Prisma schema below. Conventions applied throughout:

- `String @id @default(uuid(7))` (time-sortable), `createdAt`/`updatedAt` on everything, `createdById` on business
  entities, `deletedAt DateTime?` where soft-delete makes sense.
- Money `Decimal(12,2)`, quantities `Decimal(12,3)` (parts are measured in metres/kg), all times UTC.
- `AuditLog` is append-only and written by the service layer, never by callers.
- Enums for closed sets; lookup tables (`JobType`, `ComplianceRule`, `SlaPolicy`, `Setting`) for things Admin edits.

The schema is written for **all four phases** now so we don't rewrite it later. Models only used by Phase 2+ are marked
in the section headings; Phase 1 implements a subset.

### 3.1 Enums

```prisma
enum Role            { ADMIN DISPATCHER TECHNICIAN STOREKEEPER FINANCE CUSTOMER }
enum CustomerStatus  { PROSPECT ACTIVE DORMANT }
enum ContactRole     { SITE_CONTACT ACCOUNTS SAFETY_OFFICER DECISION_MAKER }
enum PreferredChannel{ PHONE EMAIL WHATSAPP SMS }

enum CraneType       { OVERHEAD GANTRY JIB MOBILE TOWER HOIST OTHER }
enum CraneStatus     { IN_SERVICE RESTRICTED OUT_OF_SERVICE DECOMMISSIONED }
enum ScheduleType    { MONTHLY_SERVICE ANNUAL_EXAMINATION LOAD_TEST HOIST_EXAMINATION LIFTING_GEAR_EXAM REGISTRATION_OTHER OTHER }
enum ScheduleSource  { MANUAL RULE }

enum ContractType    { AMC ADHOC WARRANTY RENTAL }
enum TicketSource    { PHONE EMAIL WHATSAPP WEB PORTAL }
enum TicketStatus    { NEW TRIAGED CONVERTED CLOSED CANCELLED }

enum Priority        { P1 P2 P3 P4 }
enum JobStatus       { NEW TRIAGED QUOTED APPROVED SCHEDULED DISPATCHED IN_PROGRESS ON_HOLD COMPLETED REVIEWED INVOICED CLOSED CANCELLED }
enum OnHoldReason    { AWAITING_PARTS AWAITING_CUSTOMER_ACCESS AWAITING_QUOTE_APPROVAL AWAITING_AE WEATHER OTHER }

enum ReportStatus    { DRAFT SUBMITTED APPROVED AMENDED }
enum FindingSeverity { CRITICAL MAJOR MINOR OBSERVATION }
enum FindingStatus   { OPEN QUOTED SCHEDULED RECTIFIED DECLINED_BY_CUSTOMER }
enum CertificateType { STATUTORY_TEST_EXAMINATION LOAD_TEST CALIBRATION COMPETENCY REGISTRATION LIFTING_GEAR_EXAM REPAIR_MODIFICATION_RECORD }

enum EquipmentType   { VEHICLE TEST_WEIGHT LOAD_CELL TOOL }
enum EquipmentStatus { AVAILABLE IN_USE MAINTENANCE RETIRED }

enum MovementType    { RECEIVE ISSUE RETURN TRANSFER ADJUST WRITEOFF }
enum ChargeType      { CHARGEABLE WARRANTY LOAN }
enum DeliveryStatus  { DRAFT ISSUED DELIVERED PARTIAL RETURNED }
enum StockTakeStatus { DRAFT COUNTING REVIEW APPROVED CANCELLED }
enum PaymentMethod   { CASH PAYNOW BANK_TRANSFER CHEQUE CARD }

enum NotificationChannel { IN_APP EMAIL SMS WHATSAPP }
enum AuditAction         { CREATE UPDATE DELETE }
enum FileKind            { PHOTO REPORT_PDF CERTIFICATE QUOTE INVOICE SIGNATURE IMPORT OTHER }
```

### 3.2 Identity, people and settings

```prisma
model User {
  id            String   @id @default(uuid(7))
  email         String   @unique
  name          String
  passwordHash  String
  role          Role
  phone         String?
  isActive      Boolean  @default(true)
  lastLoginAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  technician    Technician?
  notifications Notification[]
  auditLogs     AuditLog[]
  @@index([role, isActive])
}

model Technician {
  id             String   @id @default(uuid(7))
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id])
  employeeNo     String?  @unique
  phone          String?
  colour         String?          // schedule board colour
  isOnCall       Boolean  @default(false)
  competencies   Competency[]
  unavailability Unavailability[]
  jobs           JobTechnician[]
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model Competency {
  id           String   @id @default(uuid(7))
  technicianId String
  technician   Technician @relation(fields: [technicianId], references: [id])
  name         String            // "Electrical", "Rigging", "Load test competent", brand-specific
  certificateNo String?
  issuer       String?
  issuedDate   DateTime?
  expiryDate   DateTime?
  fileId       String?
  file         File?    @relation(fields: [fileId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([technicianId, expiryDate])
}

model Unavailability {                       // leave, training, sickness
  id           String   @id @default(uuid(7))
  technicianId String
  technician   Technician @relation(fields: [technicianId], references: [id])
  startAt      DateTime
  endAt        DateTime
  reason       String?
  createdAt    DateTime @default(now())
  @@index([technicianId, startAt])
}

model Setting {                              // editable by Admin; never env, never constants
  key         String   @id                // timezone, currency, gstRate, reminderOffsets, ...
  value       Json
  description String?
  updatedById String?
  updatedAt   DateTime @updatedAt
}

model DocumentSequence {                     // JOB-2026-0001, RPT-2026-0001, DO-…, INV-…
  key        String @id                      // e.g. "JOB:2026"
  prefix     String
  nextValue  Int    @default(1)
  updatedAt  DateTime @updatedAt
}
```

**Soft delete and `createdById`** are repeated on every business model in the sections below; they are only spelled out
here to keep the listing readable. `createdById` is `String?` with a `User` relation.

### 3.3 Customers and sites (Phase 1)

```prisma
model Customer {
  id            String   @id @default(uuid(7))
  legalName     String
  tradingName   String?
  uen           String?                       // change of UEN triggers a re-registration reminder (Phase 2)
  billingAddress Json?                        // structured: line1, line2, city, postcode, country
  paymentTerms  Int?                          @default(30) // days
  creditStatus  String?
  status        CustomerStatus @default(PROSPECT)
  notes         String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdById String?
  deletedAt   DateTime?

  contacts   Contact[]
  sites      Site[]
  cranes     Crane[]
  contracts  Contract[]
  tickets    Ticket[]
  jobs       Job[]
  quotes     Quote[]
  invoices   Invoice[]
  @@index([status, legalName])
}

model Contact {
  id            String   @id @default(uuid(7))
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  siteId        String?
  site          Site?    @relation(fields: [siteId], references: [id])
  name          String
  role          ContactRole
  phone         String?
  email         String?
  preferredChannel PreferredChannel @default(PHONE)
  isPrimary     Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt   DateTime?
  @@index([customerId, role])
}

model Site {
  id             String   @id @default(uuid(7))
  customerId     String
  customer       Customer @relation(fields: [customerId], references: [id])
  name           String
  address        Json?
  accessNotes    String?
  inductionRequirements String?
  operatingHours String?
  latitude       Decimal? @db.Decimal(9,6)
  longitude      Decimal? @db.Decimal(9,6)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt   DateTime?

  contacts Contact[]
  cranes   Crane[]
  tickets  Ticket[]
  jobs     Job[]
  @@index([customerId])
}
```

### 3.4 Cranes, schedules and compliance (Phase 1 model, Phase 2 fills it out)

```prisma
model Crane {
  id                String   @id @default(uuid(7))
  siteId            String
  site              Site     @relation(fields: [siteId], references: [id])
  customerId        String
  customer          Customer @relation(fields: [customerId], references: [id])
  assetTag          String   @unique          // internal ID
  qrValue           String   @unique          // printed label; deep-links to the crane page
  type              CraneType
  brand             String?
  model             String?
  serialNumber      String?                   // serial / distinctive number
  swlKg             Decimal  @db.Decimal(10,2)
  yearOfManufacture Int?
  statutoryRegistrationNo String?
  registrationDate  DateTime?
  ownerEntity       String?                   // owner of record; change ⇒ re-registration reminder
  locationOnSite    String?
  hourMeter         Decimal? @db.Decimal(12,1)
  status            CraneStatus @default(IN_SERVICE)
  restrictedReason  String?                   // required when status = RESTRICTED
  restrictedAt      DateTime?
  restrictedById    String?
  notes             String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdById String?
  deletedAt   DateTime?

  schedules    CraneSchedule[]
  certificates Certificate[]
  jobs         JobCrane[]
  reports      Report[]
  findings     Finding[]
  tickets      Ticket[]
  @@index([customerId, status])
  @@index([siteId, status])
  @@index([serialNumber])
}

model CraneSchedule {                          // one recurring obligation for a crane
  id             String   @id @default(uuid(7))
  craneId        String
  crane          Crane    @relation(fields: [craneId], references: [id])
  scheduleType   ScheduleType
  intervalMonths Int?
  lastDoneDate   DateTime?
  nextDueDate    DateTime?
  source         ScheduleSource @default(MANUAL)
  reminderOffsetsDays Int[] @default([90, 60, 30])
  ruleId         String?                       // set when source = RULE
  rule           ComplianceRule? @relation(fields: [ruleId], references: [id])
  autoCreateDraftJob Boolean @default(false)
  notes          String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt      DateTime?                     // slice 12: ended obligations are soft-deleted
  @@index([nextDueDate])
  @@index([craneId, scheduleType])
}

model ComplianceRule {                         // CONFIGURATION. Never hard-code a regulatory fact.
  id             String   @id @default(uuid(7))
  craneType      CraneType
  scheduleType   ScheduleType
  intervalMonths Int?
  requiresAE     Boolean  @default(false)      // statutory exam by an Authorised Examiner vs our own inspection
  isActive       Boolean  @default(true)
  effectiveFrom  DateTime?
  effectiveTo    DateTime?                     // e.g. superseded circulars: keep both rows, no code change
  sourceReference String                       // free text: circular no., date reviewed. REQUIRED.
  reviewedAt     DateTime?
  reviewedById   String?
  notes          String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  schedules CraneSchedule[]
  @@index([craneType, scheduleType, isActive])
}

model Certificate {
  id              String   @id @default(uuid(7))
  craneId         String
  crane           Crane    @relation(fields: [craneId], references: [id])
  type            CertificateType
  certificateNumber String?
  issuer          String?                      // AE name / firm for statutory certificates
  issueDate       DateTime?
  expiryDate      DateTime?
  nextDueDate     DateTime?
  statedSwlKg     Decimal? @db.Decimal(10,2)
  jobId           String?
  job             Job?     @relation(fields: [jobId], references: [id])
  fileId          String?
  file            File?    @relation(fields: [fileId], references: [id])
  notes           String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt   DateTime?
  @@index([craneId, type])
  @@index([expiryDate])
}
```

### 3.5 Contracts, tickets and jobs (Phase 1)

```prisma
model Contract {
  id             String   @id @default(uuid(7))
  customerId     String
  customer       Customer @relation(fields: [customerId], references: [id])
  type           ContractType
  reference      String?
  startDate      DateTime?
  endDate        DateTime?
  renewalDate    DateTime?
  scopeNotes     String?
  includedVisits Int?
  priceSchedule  Json?
  slaOverrides   Json?                          // per-priority response/resolution overrides
  coveredCranes  Crane[]  @relation("ContractCranes")
  tickets        Ticket[]
  jobs           Job[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt   DateTime?
  @@index([customerId, renewalDate])
}

model Ticket {
  id          String   @id @default(uuid(7))
  number      String   @unique                 // TKT-2026-0001
  source      TicketSource
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  siteId      String?
  site        Site?    @relation(fields: [siteId], references: [id])
  craneId     String?
  crane       Crane?   @relation(fields: [craneId], references: [id])
  contractId  String?
  contract    Contract? @relation(fields: [contractId], references: [id])
  description String
  priority    Priority @default(P3)
  status      TicketStatus @default(NEW)
  reportedAt  DateTime @default(now())
  respondedAt DateTime?
  closedAt    DateTime?
  triageNotes String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdById String?

  attachments File[]
  jobs        Job[]
  @@index([status, priority, reportedAt])
  @@index([customerId, status])
}

model JobType {                                // seeded, editable by Admin
  id                    String  @id @default(uuid(7))
  code                  String  @unique        // PM, BREAKDOWN, VISUAL_INSPECTION, LOAD_TEST, ...
  name                  String
  description           String?
  defaultPriority       Priority @default(P3)
  defaultChecklistTemplateId String?
  defaultReportTemplateId    String?
  requiredDocumentTypes Json?                  // e.g. ["LOAD_TEST_CERTIFICATE"]
  isActive              Boolean @default(true)
  sortOrder             Int     @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  jobs Job[]
}

model Job {
  id             String   @id @default(uuid(7))
  number         String   @unique              // JOB-2026-0001
  ticketId       String?
  ticket         Ticket?  @relation(fields: [ticketId], references: [id])
  parentJobId    String?                       // follow-up jobs generated from findings
  parentJob      Job?     @relation("FollowUps", fields: [parentJobId], references: [id])
  followUps      Job[]    @relation("FollowUps")
  jobTypeId      String
  jobType        JobType  @relation(fields: [jobTypeId], references: [id])
  customerId     String
  customer       Customer @relation(fields: [customerId], references: [id])
  siteId         String
  site           Site     @relation(fields: [siteId], references: [id])
  contractId     String?
  contract       Contract? @relation(fields: [contractId], references: [id])

  status         JobStatus @default(NEW)
  priority       Priority
  onHoldReason   OnHoldReason?                 // REQUIRED when status = ON_HOLD (enforced in service + DB check)
  onHoldNote     String?

  scheduledStart DateTime?
  scheduledEnd   DateTime?
  slaResponseDue DateTime?                     // computed at creation from SlaPolicy, snapshot so it is auditable
  slaResolveDue  DateTime?
  reportedAt     DateTime?
  respondedAt    DateTime?
  onSiteAt       DateTime?
  restoredAt     DateTime?
  completedAt    DateTime?
  reviewedAt     DateTime?
  invoicedAt     DateTime?
  closedAt       DateTime?

  customerPoRef  String?
  description    String?
  internalNotes  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdById String?
  deletedAt   DateTime?

  cranes      JobCrane[]
  technicians JobTechnician[]
  resources   JobResource[]
  statusHistory JobStatusHistory[]
  reports     Report[]
  certificates Certificate[]
  stockMovements StockMovement[]
  deliveryOrders DeliveryOrder[]
  quoteLines  QuoteLine[]
  invoiceLines InvoiceLine[]
  files       File[]
  notifications Notification[]
  @@index([status, scheduledStart])
  @@index([customerId, status])
  @@index([priority, status])
  @@index([scheduledStart, status])
}

model JobCrane {
  jobId   String
  craneId String
  job     Job   @relation(fields: [jobId], references: [id])
  crane   Crane @relation(fields: [craneId], references: [id])
  @@id([jobId, craneId])
}

model JobTechnician {
  jobId        String
  technicianId String
  job          Job        @relation(fields: [jobId], references: [id])
  technician   Technician @relation(fields: [technicianId], references: [id])
  isLead       Boolean    @default(false)
  assignedAt   DateTime   @default(now())
  assignedById String?
  @@id([jobId, technicianId])
  @@index([technicianId, jobId])
}

model JobStatusHistory {                      // append-only; every status change, attributed and timestamped
  id          String   @id @default(uuid(7))
  jobId       String
  job         Job      @relation(fields: [jobId], references: [id])
  fromStatus  JobStatus?
  toStatus    JobStatus
  reason      String?
  onHoldReason OnHoldReason?
  changedById String?
  changedAt   DateTime @default(now())
  @@index([jobId, changedAt])
}

model SlaPolicy {                             // editable by Admin; priority × optional contract override
  id              String   @id @default(uuid(7))
  priority        Priority
  contractId      String?
  responseMinutes Int
  resolutionMinutes Int
  isActive        Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([priority, contractId])
}

model Resource {                              // vehicles, test weights, load cells bookable on jobs
  id           String   @id @default(uuid(7))
  name         String
  type         EquipmentType
  serialNumber String?
  locationId   String?
  calibrationDueDate DateTime?
  calibrationFileId  String?
  status       EquipmentStatus @default(AVAILABLE)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  jobResources JobResource[]
  @@index([type, status])
}

model JobResource {
  jobId      String
  resourceId String
  job        Job      @relation(fields: [jobId], references: [id])
  resource   Resource @relation(fields: [resourceId], references: [id])
  startAt    DateTime?
  endAt      DateTime?
  @@id([jobId, resourceId])
}
```

> **`ON_HOLD` requires a reason.** Postgres `CHECK` constraint added in the migration
> (`status <> 'ON_HOLD' OR on_hold_reason IS NOT NULL`) *and* validated in the status-transition service, so it holds
> even if some future code path forgets. The brief calls this out twice; belt and braces is warranted.

### 3.6 Templates, reports and findings (Phase 1)

```prisma
model ChecklistTemplate {
  id        String @id @default(uuid(7))
  code      String
  name      String
  jobTypeId String?
  version   Int    @default(1)
  isActive  Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  items ChecklistItem[]
  @@unique([code, version])
}

model ChecklistItem {
  id          String @id @default(uuid(7))
  templateId  String
  template    ChecklistTemplate @relation(fields: [templateId], references: [id])
  section     String                      // hoist, trolley, bridge/boom, brakes, wire rope, hook…
  code        String
  label       String
  resultType  String                      // PASS_FAIL_NA | NUMBER | TEXT | YES_NO
  unit        String?                     // mm, kg, m
  requiresMeasurement Boolean @default(false)
  sortOrder   Int @default(0)
  @@unique([templateId, code])
}

model ReportTemplate {
  id        String @id @default(uuid(7))
  code      String
  name      String
  jobTypeId String?
  version   Int    @default(1)
  bodyHtml  String                        // versioned; an old report always re-renders as issued
  schema    Json                          // Zod-described shape of Report.data, used to validate on submit
  isActive  Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  reports   Report[]
  @@unique([code, version])
}

model Report {
  id             String   @id @default(uuid(7))
  jobId          String
  job            Job      @relation(fields: [jobId], references: [id])
  craneId        String
  crane          Crane    @relation(fields: [craneId], references: [id])
  templateId     String
  template       ReportTemplate @relation(fields: [templateId], references: [id])
  templateVersion Int

  data           Json                          // validated against template.schema on submit
  status         ReportStatus @default(DRAFT)

  technicianSignedById String?
  technicianSignedAt   DateTime?
  technicianSignatureFileId String?
  technicianSignerName String?

  customerSignerName String?
  customerSignerDesignation String?
  customerSignedAt   DateTime?
  customerSignatureFileId String?
  customerDeclinedReason String?                // "declined / unavailable" path

  safeToOperate  String?                        // YES | NO | WITH_RESTRICTIONS
  documentNumber String?  @unique               // assigned on approval, e.g. RPT-2026-0001
  pdfFileId      String?
  pdfFile        File?    @relation("ReportPdf", fields: [pdfFileId], references: [id])

  amendmentOfId  String?                        // corrections create a new version linked to the original
  amendmentOf    Report?  @relation("Amendments", fields: [amendmentOfId], references: [id])
  amendments     Report[] @relation("Amendments")
  amendmentReason String?

  submittedAt DateTime?
  approvedAt  DateTime?
  approvedById String?
  emailedToCustomerAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdById String?

  findings Finding[]
  partsUsed StockMovement[]
  technicianSignatureFile File? @relation("TechSig", fields: [technicianSignatureFileId], references: [id])
  customerSignatureFile   File? @relation("CustSig", fields: [customerSignatureFileId], references: [id])
  @@index([jobId])
  @@index([craneId, status])
}

model Finding {
  id          String   @id @default(uuid(7))
  reportId    String
  report      Report   @relation(fields: [reportId], references: [id])
  craneId     String
  crane       Crane    @relation(fields: [craneId], references: [id])
  component   String
  description String
  severity    FindingSeverity
  recommendation String?
  status      FindingStatus @default(OPEN)
  followUpJobId String?                          // one-click follow-up job
  followUpJob   Job?   @relation(fields: [followUpJobId], references: [id])
  declinedAcknowledgedName String?               // customer declines a critical repair ⇒ signed acknowledgement
  declinedAcknowledgedAt   DateTime?
  declinedSignatureFileId  String?
  declinedSignatureFile    File? @relation(fields: [declinedSignatureFileId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  files File[]
  @@index([craneId, status, severity])
}

model File {
  id         String   @id @default(uuid(7))
  kind       FileKind
  filename   String
  mimeType   String
  sizeBytes  Int
  storageKey String                              // disk path or S3 key; access via signed URL
  width      Int?
  height     Int?
  sha256     String?
  uploadedById String?
  createdAt  DateTime @default(now())
  deletedAt  DateTime?
  craneId    String?
  ticketId   String?
  ticket     Ticket?  @relation(fields: [ticketId], references: [id])
  jobId      String?
  job        Job?     @relation(fields: [jobId], references: [id])
  findingId  String?
  finding    Finding? @relation(fields: [findingId], references: [id])
  @@index([jobId])
  @@index([craneId])
}
```

### 3.7 Quotes, invoices and payments (Phase 2)

```prisma
model Quote {
  id          String @id @default(uuid(7))
  number      String @unique                 // QTE-2026-0001
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  jobId       String?
  status      String @default("DRAFT")       // DRAFT SENT ACCEPTED DECLINED EXPIRED
  validUntil  DateTime?
  subtotal    Decimal @db.Decimal(12,2) @default(0)
  gstAmount   Decimal @db.Decimal(12,2) @default(0)
  total       Decimal @db.Decimal(12,2) @default(0)
  notes       String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdById String?
  lines QuoteLine[]
  @@index([customerId, status])
}

model QuoteLine {
  id          String @id @default(uuid(7))
  quoteId     String
  quote       Quote  @relation(fields: [quoteId], references: [id])
  jobId       String?
  job         Job?   @relation(fields: [jobId], references: [id])
  description String
  partId      String?
  quantity    Decimal @db.Decimal(12,3)
  unitPrice   Decimal @db.Decimal(12,2)
  lineTotal   Decimal @db.Decimal(12,2)
  isVariation Boolean @default(false)
}

model Invoice {
  id          String @id @default(uuid(7))
  number      String @unique                 // INV-2026-0001
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  status      String @default("DRAFT")       // DRAFT ISSUED PART_PAID PAID VOID
  issueDate   DateTime?
  dueDate     DateTime?
  gstRate     Decimal @db.Decimal(5,4)       // snapshot: rate at time of issue
  subtotal    Decimal @db.Decimal(12,2) @default(0)
  gstAmount   Decimal @db.Decimal(12,2) @default(0)
  total       Decimal @db.Decimal(12,2) @default(0)
  amountPaid  Decimal @db.Decimal(12,2) @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lines   InvoiceLine[]
  payments Payment[]
  @@index([customerId, status, dueDate])
}

model InvoiceLine {
  id          String @id @default(uuid(7))
  invoiceId   String
  invoice     Invoice @relation(fields: [invoiceId], references: [id])
  jobId       String?
  job         Job?   @relation(fields: [jobId], references: [id])
  description String
  quantity    Decimal @db.Decimal(12,3)
  unitPrice   Decimal @db.Decimal(12,2)
  lineTotal   Decimal @db.Decimal(12,2)
}

model Payment {
  id         String @id @default(uuid(7))
  invoiceId  String
  invoice    Invoice @relation(fields: [invoiceId], references: [id])
  amount     Decimal @db.Decimal(12,2)
  method     PaymentMethod
  reference  String?
  paidAt     DateTime
  createdAt DateTime @default(now())
  createdById String?
}
```

### 3.8 Suppliers, parts and stock (Phase 3 — designed now, built later)

```prisma
model Supplier {
  id          String @id @default(uuid(7))
  name        String
  contactName String?
  phone       String?
  email       String?
  address     Json?
  leadTimeDays Int?
  notes       String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt   DateTime?
  parts       Part[] @relation("PreferredSupplier")
  purchaseOrders PurchaseOrder[]
}

model Part {
  id            String @id @default(uuid(7))
  partNumber    String @unique
  description   String
  brand         String?
  compatibleModels String[]                   // crane models this fits
  uom           String
  cost          Decimal @db.Decimal(12,2)
  sellPrice     Decimal @db.Decimal(12,2)
  preferredSupplierId String?
  preferredSupplier   Supplier? @relation("PreferredSupplier", fields: [preferredSupplierId], references: [id])
  leadTimeDays  Int?
  trackSerialOrBatch Boolean @default(false)  // wire rope, hooks, brakes, electrical
  reorderLevel  Decimal? @db.Decimal(12,3)
  reorderQty    Decimal? @db.Decimal(12,3)
  barcode       String?
  isActive      Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt   DateTime?
  stockLevels StockLevel[]
  movements   StockMovement[]
  @@index([brand])
  @@index([description])
}

model Location {
  id        String @id @default(uuid(7))
  name      String
  type      String                            // WAREHOUSE BIN VAN CUSTOMER_SITE
  siteId    String?
  parentId  String?
  isActive  Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  stockLevels StockLevel[]
}

model StockLevel {                              // derived/reconciled from movements; kept as a materialised total
  partId     String
  locationId String
  part       Part     @relation(fields: [partId], references: [id])
  location   Location @relation(fields: [locationId], references: [id])
  quantity   Decimal  @db.Decimal(12,3) @default(0)
  updatedAt  DateTime @updatedAt
  @@id([partId, locationId])
  @@index([partId, quantity])
}

model StockMovement {                           // append-only; the ONLY way quantity changes
  id           String @id @default(uuid(7))
  partId       String
  part         Part   @relation(fields: [partId], references: [id])
  fromLocationId String?
  toLocationId   String?
  quantity     Decimal @db.Decimal(12,3)
  type         MovementType
  unitCost     Decimal? @db.Decimal(12,2)
  serialOrBatch String?
  reasonCode   String?
  jobId        String?
  job          Job?   @relation(fields: [jobId], references: [id])
  reportId     String?
  report       Report? @relation(fields: [reportId], references: [id])
  deliveryOrderId String?
  deliveryOrder   DeliveryOrder? @relation(fields: [deliveryOrderId], references: [id])
  purchaseOrderId String?
  purchaseOrder   PurchaseOrder? @relation(fields: [purchaseOrderId], references: [id])
  stockTakeId  String?
  stockTake    StockTake? @relation(fields: [stockTakeId], references: [id])
  movedById    String?
  movedAt      DateTime @default(now())
  @@index([partId, movedAt])
  @@index([jobId])
}

model DeliveryOrder {
  id          String @id @default(uuid(7))
  number      String @unique                  // DO-2026-0001
  jobId       String?
  job         Job?   @relation(fields: [jobId], references: [id])
  customerId  String
  deliveryAddress Json?
  status      DeliveryStatus @default(DRAFT)
  receiverName String?
  receiverSignatureFileId String?
  receivedAt  DateTime?
  issuedAt    DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lines DeliveryOrderLine[]
  movements StockMovement[]
}

model DeliveryOrderLine {
  id          String @id @default(uuid(7))
  deliveryOrderId String
  deliveryOrder   DeliveryOrder @relation(fields: [deliveryOrderId], references: [id])
  partId      String?
  description String
  quantity    Decimal @db.Decimal(12,3)
  serialOrBatch String?
  condition   String?
  chargeType  ChargeType @default(CHARGEABLE)
  expectedReturnDate DateTime?
  returnedQuantity Decimal? @db.Decimal(12,3)
}

model PurchaseOrder {
  id          String @id @default(uuid(7))
  number      String @unique                  // PO-2026-0001
  supplierId  String
  supplier    Supplier @relation(fields: [supplierId], references: [id])
  status      String @default("DRAFT")        // DRAFT SENT PARTIAL RECEIVED CANCELLED
  orderedAt   DateTime?
  expectedAt  DateTime?
  total       Decimal @db.Decimal(12,2) @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lines PurchaseOrderLine[]
  movements StockMovement[]
}

model PurchaseOrderLine {
  id       String @id @default(uuid(7))
  purchaseOrderId String
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id])
  partId   String?
  description String
  quantity Decimal @db.Decimal(12,3)
  unitCost Decimal @db.Decimal(12,2)
  receivedQuantity Decimal @db.Decimal(12,3) @default(0)
  backOrderedQuantity Decimal @db.Decimal(12,3) @default(0)
}

model StockTake {
  id          String @id @default(uuid(7))
  reference   String @unique
  scopeLocationId String?
  scopeCategory   String?
  blindCount  Boolean @default(true)
  status      StockTakeStatus @default(DRAFT)
  movementsFrozenAt DateTime?
  approvedById String?
  approvedAt  DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lines StockTakeLine[]
  movements StockMovement[]
}

model StockTakeLine {
  id          String @id @default(uuid(7))
  stockTakeId String
  stockTake   StockTake @relation(fields: [stockTakeId], references: [id])
  partId      String
  locationId  String
  systemQty   Decimal @db.Decimal(12,3)
  countedQty  Decimal? @db.Decimal(12,3)
  variance    Decimal? @db.Decimal(12,3)
  needsRecount Boolean @default(false)
  reasonCode  String?
  countedById String?
  countedAt   DateTime?
  @@index([stockTakeId])
}
```

### 3.9 Cross-cutting

```prisma
model AuditLog {                                // append-only. Never updated, never deleted.
  id         String   @id @default(uuid(7))
  entity     String                             // "Job", "Crane", "Report"…
  entityId   String
  action     AuditAction
  before     Json?
  after      Json?
  userId     String?
  user       User?    @relation(fields: [userId], references: [id])
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())
  @@index([entity, entityId, createdAt])
  @@index([userId, createdAt])
  @@index([createdAt])
}

model Notification {
  id        String   @id @default(uuid(7))
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  channel   NotificationChannel @default(IN_APP)
  title     String
  body      String
  jobId     String?
  job       Job?     @relation(fields: [jobId], references: [id])
  link      String?
  readAt    DateTime?
  sentAt    DateTime?
  failedAt  DateTime?
  error     String?
  createdAt DateTime @default(now())
  @@index([userId, readAt])
}

model SyncReceipt {                             // offline idempotency: a replayed upload upserts, never duplicates
  id               String @id                   // client-generated mutation id
  userId           String
  endpoint         String
  appliedAt        DateTime @default(now())
  resultSummary    Json?
  @@index([userId, appliedAt])
}

model ConflictLog {                             // sync conflicts, per the field-wins rule
  id        String @id @default(uuid(7))
  entity    String
  entityId  String
  resolution String                            // FIELD_WINS | OFFICE_WINS | MANUAL
  detail    Json
  userId    String?
  createdAt DateTime @default(now())
}
```

### 3.10 Indexes the brief specifically asks for

Covered above: job list filtering `(status, scheduledStart)`, `(customerId, status)`, `(priority, status)`,
`(scheduledStart, status)`; technician jobs via `JobTechnician(technicianId, jobId)`; crane next-due via
`CraneSchedule(nextDueDate)`; stock by part/location via `StockLevel(partId, quantity)` and
`StockMovement(partId, movedAt)`; audit lookups via `AuditLog(entity, entityId, createdAt)` and `(userId, createdAt)`.

---

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
summary. **Slices 12–17 are built and verified; slice 18 is the next session's work (§7.2).**
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
| `CraneSchedule` | Rows exist only because `seedDemoBook()` writes two per demo crane ([prisma/seed.ts:1009](prisma/seed.ts)) | No write path, no screen. Its **only** reader is the dashboard count ([dashboard.ts:118](src/server/dashboard/dashboard.ts)) |
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
`Invariant: no direct app page entry found for /login`, then every dev route 500s). `next dev` now
writes `.next-dev` (`next.config.ts` keys `distDir` on `NODE_ENV`), so the two never meet, a build
still lands in `.next` where Vercel expects it, and stopping the dev server first is no longer
needed. `npm run dev:stop` stops whatever holds the dev port, for the remaining case — a schema
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
| 26 | Stock take | Session → blind count → variance → recount → approve, posting one `ADJUST`/`WRITEOFF` per line difference, and flagging a part/location that keeps disagreeing | `/stock-takes` (new), `src/server/inventory/` | §9 |
| 27 | Suppliers | The supplier book and its price history, behind `supplier.write`, with the PO screens | `/suppliers` (new) | §9 |
| 28 | Back-orders linked to jobs on hold | A part on order appears against the jobs held awaiting it, so "awaiting parts" says **which** part and when it lands | job page, `/parts` | §4.2, §9 |

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

### 7.14 Phase 4 (outline, not sliced yet)

**Phase 3 — Inventory.** Parts catalogue screens (`Part`, `Supplier` exist in the seed with 40 parts, no UI); locations;
stock movements linked to jobs and DOs; serial/batch traceability; reorder alerts grouped by supplier; purchase orders
and back-orders linked to jobs on hold awaiting parts; stock take workflow with blind counts, variance, recounts, reason
codes and approved adjustments; repeat-discrepancy flagging. Slice it the same way when Phase 2 closes.

**Phase 4 — Optimisation.** Customer portal (`CUSTOMER` role is modelled and unsliced); contracts and SLA management
(`Contract.slaOverrides` exists and is honoured by slice 5's SLA computation, no screen); profitability and
technician-utilisation reporting (`report.financial` capability exists and is unused); equipment calibration tracking;
route optimisation; WhatsApp/SMS adapters; Xero/QuickBooks integration (slice 21 leaves the adapter seam for this).

---

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
