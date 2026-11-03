# DATA-MODEL.md — the schema, written for all four phases

Reference, not an introduction. This is `PLAN.md` §3 as the plan froze it: the Prisma model Phase 1
built against, and the tables Phases 2–4 add. The live schema is `../prisma/schema.prisma`; where the
two differ, the migration is the truth.

Prisma schema below. Conventions applied throughout:

- `String @id @default(uuid(7))` (time-sortable), `createdAt`/`updatedAt` on everything, `createdById` on business
  entities, `deletedAt DateTime?` where soft-delete makes sense.
- Money `Decimal(12,2)`, quantities `Decimal(12,3)` (parts are measured in metres/kg), all times UTC.
- `AuditLog` is append-only and written by the service layer, never by callers.
- Enums for closed sets; lookup tables (`JobType`, `ComplianceRule`, `SlaPolicy`, `Setting`) for things Admin edits.

The schema is written for **all four phases** now so we don't rewrite it later. Models only used by Phase 2+ are marked
in the section headings; Phase 1 implements a subset.

## 3.1 Enums

```prisma
enum Role            { ADMIN DISPATCHER TECHNICIAN STOREKEEPER FINANCE }
enum CustomerStatus  { PROSPECT ACTIVE DORMANT }
enum ContactRole     { SITE_CONTACT ACCOUNTS SAFETY_OFFICER DECISION_MAKER }
enum PreferredChannel{ PHONE EMAIL WHATSAPP SMS }

enum CraneType       { OVERHEAD GANTRY JIB MOBILE TOWER HOIST OTHER }
enum CraneStatus     { IN_SERVICE RESTRICTED OUT_OF_SERVICE DECOMMISSIONED }
enum ScheduleType    { MONTHLY_SERVICE ANNUAL_EXAMINATION LOAD_TEST HOIST_EXAMINATION LIFTING_GEAR_EXAM REGISTRATION_OTHER OTHER }
enum ScheduleSource  { MANUAL RULE }

enum ContractType    { AMC ADHOC WARRANTY RENTAL }
enum TicketSource    { PHONE EMAIL WHATSAPP WEB }
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

## 3.2 Identity, people and settings

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

## 3.3 Customers and sites (Phase 1)

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

## 3.4 Cranes, schedules and compliance (Phase 1 model, Phase 2 fills it out)

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

## 3.5 Contracts, tickets and jobs (Phase 1)

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

## 3.6 Templates, reports and findings (Phase 1)

```prisma
model ChecklistTemplate {
  id        String @id @default(uuid(7))
  code      String
  name      String
  jobTypeId String?  // the job type whose default this sheet replaces…
  craneTypes CraneType[] @default([]) // …on these crane types; empty = a job type default only
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

## 3.7 Quotes, invoices and payments (Phase 2)

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

## 3.8 Suppliers, parts and stock (Phase 3 — designed now, built later)

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

## 3.9 Cross-cutting

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

## 3.10 Indexes the brief specifically asks for

Covered above: job list filtering `(status, scheduledStart)`, `(customerId, status)`, `(priority, status)`,
`(scheduledStart, status)`; technician jobs via `JobTechnician(technicianId, jobId)`; crane next-due via
`CraneSchedule(nextDueDate)`; stock by part/location via `StockLevel(partId, quantity)` and
`StockMovement(partId, movedAt)`; audit lookups via `AuditLog(entity, entityId, createdAt)` and `(userId, createdAt)`.

---
