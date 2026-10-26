# PLAN.md — Cimmerian Crane Services Helpdesk

Architecture, data model, screens and build plan. Conventions and non-negotiables live in `../CLAUDE.md`.
Assumptions where the brief was silent live in `ASSUMPTIONS.md`.

**Status: Phase 1, slices 0–5 built and verified against the live database, on Vercel hosting.
Slice 6 is next.**

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
  'part.read', 'part.write', 'stock.move', 'stocktake.approve', 'supplier.write',
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

**Progress:** Slices 0–5 are **done**, each verified against the live Supabase database. Slices 4 and 5 are
summarised below; the rest of this section is the plan as written.

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
| **3** | **Sites & cranes** | CRUD, search, CSV import, QR value + printable label, crane detail page shell (timeline empty until slice 9), restriction flag with reason | §12.3 |
| **4** | **Job types, templates, tickets** | Seed 14 job types; seed checklist + report templates for servicing, breakdown, visual inspection, load test; ticket CRUD, triage, priority, SLA timer display | §12.4 |
| **5** | **Ticket → Job, lifecycle, SLA** | Ticket spawns 1..n jobs, job covers 1..n cranes; status machine + `JobStatusHistory`; `ON_HOLD` reason required (DB check + service); `SlaPolicy` → SLA due timestamps + live timer/breach state; P1 alert to dispatchers (in-app + email adapter) | §12.4, §4.3 |
| **6** | **Scheduling & dispatch** | Schedule board (day/week, dnd-kit, conflict warnings); technician assignment with competency warnings + configurable block; leave/unavailability; on-call roster; resource booking + conflict flags; priority bump with reason (audited); dispatch notification with site contact, access notes, crane history, checklist | §12.5 |
| **7** | **Technician PWA shell** | Installable PWA (Serwist); Dexie cache of upcoming jobs, crane histories, templates, parts, contacts; My Jobs; Job detail; offline indicator | §12.6 |
| **8** | **Offline report completion** | Checklist form with measurements; photos with client-side compression; parts used; findings; technician + customer signatures with declined-with-reason; autosave every few seconds; outbox sync queue with pending badge, retry, idempotency via `SyncReceipt`, conflicts logged | §12.6, §10 |
| **9** | **Approval, lock, PDF** | Report approval flow; locked reports + amendment with reason linked to original; document numbering; `@react-pdf/renderer` PDF with embedded signatures and photos; email to customer on close with copy stored against job and crane; crane timeline now populated | §12.7 |
| **10** | **Job list, dashboard, audit views** | Company-wide job list with every filter + saved filters + CSV export + calendar view; office dashboard; audit log viewer and "who changed what" on key records | §12.8, §12.9 |
| **11** | **E2E happy paths** | Playwright: (a) P1 breakdown ticket → assign nearest qualified technician → offline report with photos and both signatures → sync → approve → customer PDF; (b) offline report completion and later sync | §12.10 |

`npm run seed` grows with each slice and must stay runnable. Slice 4 seeds the templates; slice 6 seeds technicians,
competencies (one expired) and the roster; slice 11 completes the §13 demo dataset (8 customers, 25–40 cranes, 30
historical jobs, 2 open P1 tickets, 40 parts with some below reorder level, demo logins per role).

**Phase 1 acceptance** (from the brief) is exactly slice 11's path (a). If that test passes end to end, Phase 1 is done.

---

## 7. Phases 2–4 (outline)

**Phase 2 — Compliance & recurring work.** CraneSchedule + reminder engine (daily Vercel Cron evaluation at configured
offsets, then overdue); Certificates + Compliance dashboard (90/60/30 + overdue); ComplianceRule admin with the MOM
notice and source/reference; load test and visual inspection templates fully built out including calibration-expiry
validation against `Resource.calibrationDueDate`; Findings and one-click follow-up job generation; re-registration
reminders on owner/UEN change or re-assembly; delivery orders; quotes/variations; invoicing with GST; accounting CSV
export.

**Phase 3 — Inventory.** Parts catalogue; locations; stock movements linked to jobs and DOs; serial/batch traceability;
reorder alerts grouped by supplier; purchase orders + back-orders linked to jobs on hold awaiting parts; stock take
workflow with blind counts, variance, recounts, reason codes and approved adjustments; repeat-discrepancy flagging.

**Phase 4 — Optimisation.** Customer portal; contracts and SLA management; profitability and technician-utilisation
reporting; equipment calibration tracking; route optimisation; WhatsApp/SMS adapters; Xero/QuickBooks integration.

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
| **PDF reproducibility across template versions** | `Report` stores `templateVersion` + the exact `data`; `ReportTemplate` rows are never mutated, only superseded by a new version. Slice 9 test: re-render an approved report after a template change and diff. |
| **Compliance rules change (MOM circulars)** | Rules live in `ComplianceRule` with `effectiveFrom`/`effectiveTo` and a required `sourceReference`. Superseding a rule is an Admin data entry, not a deploy. No regulatory fact appears in code. |
| **Scope creep across 14 job types** | Phase 1 seeds all 14 as data but fully builds only 4 templates (servicing, breakdown, visual inspection, load test). The rest are configurable rows. |
| **PDF rendering on Vercel** | No Chromium and no worker. Rendering is pure JavaScript (`@react-pdf/renderer`) inside the approving request; the daily cron retries any render or email that failed. A very large report (dozens of photos) could approach the function duration limit; the retry pass and per-report status make that visible rather than silent. |
| **Schema churn in later phases** | Full schema designed now (§3); Phase 2–4 models exist but stay unused until their slice. Migrations are additive. |

---

## 10. Open questions (assumed, not blocking)

Recorded with the assumption taken and the cost of being wrong, in `ASSUMPTIONS.md`. All six are Phase 2+ shaping
questions: none change the Phase 1 architecture, so none block the start.
