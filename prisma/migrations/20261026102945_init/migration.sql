-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DISPATCHER', 'TECHNICIAN', 'STOREKEEPER', 'FINANCE', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'DORMANT');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('SITE_CONTACT', 'ACCOUNTS', 'SAFETY_OFFICER', 'DECISION_MAKER');

-- CreateEnum
CREATE TYPE "PreferredChannel" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP', 'SMS');

-- CreateEnum
CREATE TYPE "CraneType" AS ENUM ('OVERHEAD', 'GANTRY', 'JIB', 'MOBILE', 'TOWER', 'HOIST', 'OTHER');

-- CreateEnum
CREATE TYPE "CraneStatus" AS ENUM ('IN_SERVICE', 'RESTRICTED', 'OUT_OF_SERVICE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('MONTHLY_SERVICE', 'ANNUAL_EXAMINATION', 'LOAD_TEST', 'HOIST_EXAMINATION', 'LIFTING_GEAR_EXAM', 'REGISTRATION_OTHER', 'OTHER');

-- CreateEnum
CREATE TYPE "ScheduleSource" AS ENUM ('MANUAL', 'RULE');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('AMC', 'ADHOC', 'WARRANTY', 'RENTAL');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP', 'WEB', 'PORTAL');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'TRIAGED', 'CONVERTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'TRIAGED', 'QUOTED', 'APPROVED', 'SCHEDULED', 'DISPATCHED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'REVIEWED', 'INVOICED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnHoldReason" AS ENUM ('AWAITING_PARTS', 'AWAITING_CUSTOMER_ACCESS', 'AWAITING_QUOTE_APPROVAL', 'AWAITING_AE', 'WEATHER', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'AMENDED');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'QUOTED', 'SCHEDULED', 'RECTIFIED', 'DECLINED_BY_CUSTOMER');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('STATUTORY_TEST_EXAMINATION', 'LOAD_TEST', 'CALIBRATION', 'COMPETENCY', 'REGISTRATION', 'LIFTING_GEAR_EXAM', 'REPAIR_MODIFICATION_RECORD');

-- CreateEnum
CREATE TYPE "EquipmentType" AS ENUM ('VEHICLE', 'TEST_WEIGHT', 'LOAD_CELL', 'TOOL');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIVE', 'ISSUE', 'RETURN', 'TRANSFER', 'ADJUST', 'WRITEOFF');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('CHARGEABLE', 'WARRANTY', 'LOAN');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('DRAFT', 'ISSUED', 'DELIVERED', 'PARTIAL', 'RETURNED');

-- CreateEnum
CREATE TYPE "StockTakeStatus" AS ENUM ('DRAFT', 'COUNTING', 'REVIEW', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PAYNOW', 'BANK_TRANSFER', 'CHEQUE', 'CARD');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('PHOTO', 'REPORT_PDF', 'CERTIFICATE', 'QUOTE', 'INVOICE', 'SIGNATURE', 'IMPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'BIN', 'VAN', 'CUSTOMER_SITE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Technician" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeNo" TEXT,
    "phone" TEXT,
    "colour" TEXT,
    "isOnCall" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Technician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "certificateNo" TEXT,
    "issuer" TEXT,
    "issuedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unavailability" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "uen" TEXT,
    "billingAddress" JSONB,
    "paymentTerms" INTEGER DEFAULT 30,
    "creditStatus" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'PROSPECT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "role" "ContactRole" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "preferredChannel" "PreferredChannel" NOT NULL DEFAULT 'PHONE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB,
    "accessNotes" TEXT,
    "inductionRequirements" TEXT,
    "operatingHours" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crane" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "qrValue" TEXT NOT NULL,
    "type" "CraneType" NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "swlKg" DECIMAL(10,2) NOT NULL,
    "yearOfManufacture" INTEGER,
    "statutoryRegistrationNo" TEXT,
    "registrationDate" TIMESTAMP(3),
    "ownerEntity" TEXT,
    "locationOnSite" TEXT,
    "hourMeter" DECIMAL(12,1),
    "status" "CraneStatus" NOT NULL DEFAULT 'IN_SERVICE',
    "restrictedReason" TEXT,
    "restrictedAt" TIMESTAMP(3),
    "restrictedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Crane_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CraneSchedule" (
    "id" TEXT NOT NULL,
    "craneId" TEXT NOT NULL,
    "scheduleType" "ScheduleType" NOT NULL,
    "intervalMonths" INTEGER,
    "lastDoneDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "source" "ScheduleSource" NOT NULL DEFAULT 'MANUAL',
    "reminderOffsetsDays" INTEGER[] DEFAULT ARRAY[90, 60, 30]::INTEGER[],
    "ruleId" TEXT,
    "autoCreateDraftJob" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CraneSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "craneType" "CraneType" NOT NULL,
    "scheduleType" "ScheduleType" NOT NULL,
    "intervalMonths" INTEGER,
    "requiresAE" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "sourceReference" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "craneId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "certificateNumber" TEXT,
    "issuer" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "statedSwlKg" DECIMAL(10,2),
    "jobId" TEXT,
    "fileId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "ContractType" NOT NULL,
    "reference" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "scopeNotes" TEXT,
    "includedVisits" INTEGER,
    "priceSchedule" JSONB,
    "slaOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "source" "TicketSource" NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT,
    "craneId" TEXT,
    "contractId" TEXT,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'P3',
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "triageNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultPriority" "Priority" NOT NULL DEFAULT 'P3',
    "defaultChecklistTemplateId" TEXT,
    "defaultReportTemplateId" TEXT,
    "requiredDocumentTypes" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "ticketId" TEXT,
    "parentJobId" TEXT,
    "jobTypeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "contractId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL,
    "onHoldReason" "OnHoldReason",
    "onHoldNote" TEXT,
    "scheduledStart" TIMESTAMP(3),
    "scheduledEnd" TIMESTAMP(3),
    "slaResponseDue" TIMESTAMP(3),
    "slaResolveDue" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "onSiteAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "customerPoRef" TEXT,
    "description" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCrane" (
    "jobId" TEXT NOT NULL,
    "craneId" TEXT NOT NULL,

    CONSTRAINT "JobCrane_pkey" PRIMARY KEY ("jobId","craneId")
);

-- CreateTable
CREATE TABLE "JobTechnician" (
    "jobId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "JobTechnician_pkey" PRIMARY KEY ("jobId","technicianId")
);

-- CreateTable
CREATE TABLE "JobStatusHistory" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fromStatus" "JobStatus",
    "toStatus" "JobStatus" NOT NULL,
    "reason" TEXT,
    "onHoldReason" "OnHoldReason",
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "contractId" TEXT,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EquipmentType" NOT NULL,
    "serialNumber" TEXT,
    "locationId" TEXT,
    "calibrationDueDate" TIMESTAMP(3),
    "calibrationFileId" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobResource" (
    "jobId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),

    CONSTRAINT "JobResource_pkey" PRIMARY KEY ("jobId","resourceId")
);

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTypeId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "resultType" TEXT NOT NULL,
    "unit" TEXT,
    "requiresMeasurement" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTypeId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "bodyHtml" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "craneId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "technicianSignedById" TEXT,
    "technicianSignerName" TEXT,
    "technicianSignedAt" TIMESTAMP(3),
    "technicianSignatureFileId" TEXT,
    "customerSignerName" TEXT,
    "customerSignerDesignation" TEXT,
    "customerSignedAt" TIMESTAMP(3),
    "customerSignatureFileId" TEXT,
    "customerDeclinedReason" TEXT,
    "safeToOperate" TEXT,
    "documentNumber" TEXT,
    "pdfFileId" TEXT,
    "amendmentOfId" TEXT,
    "amendmentReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "emailedToCustomerAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "craneId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "recommendation" TEXT,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "followUpJobId" TEXT,
    "declinedAcknowledgedName" TEXT,
    "declinedAcknowledgedAt" TIMESTAMP(3),
    "declinedSignatureFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "jobId" TEXT,
    "ticketId" TEXT,
    "findingId" TEXT,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "jobId" TEXT,
    "description" TEXT NOT NULL,
    "partId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "isVariation" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "gstRate" DECIMAL(5,4) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "jobId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" JSONB,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "brand" TEXT,
    "compatibleModels" TEXT[],
    "uom" TEXT NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "sellPrice" DECIMAL(12,2) NOT NULL,
    "preferredSupplierId" TEXT,
    "leadTimeDays" INTEGER,
    "trackSerialOrBatch" BOOLEAN NOT NULL DEFAULT false,
    "reorderLevel" DECIMAL(12,3),
    "reorderQty" DECIMAL(12,3),
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "siteId" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "partId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("partId","locationId")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "type" "MovementType" NOT NULL,
    "unitCost" DECIMAL(12,2),
    "serialOrBatch" TEXT,
    "reasonCode" TEXT,
    "jobId" TEXT,
    "reportId" TEXT,
    "deliveryOrderId" TEXT,
    "purchaseOrderId" TEXT,
    "stockTakeId" TEXT,
    "movedById" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "jobId" TEXT,
    "customerId" TEXT NOT NULL,
    "deliveryAddress" JSONB,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'DRAFT',
    "receiverName" TEXT,
    "receiverSignatureFileId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOrderLine" (
    "id" TEXT NOT NULL,
    "deliveryOrderId" TEXT NOT NULL,
    "partId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "serialOrBatch" TEXT,
    "condition" TEXT,
    "chargeType" "ChargeType" NOT NULL DEFAULT 'CHARGEABLE',
    "expectedReturnDate" TIMESTAMP(3),
    "returnedQuantity" DECIMAL(12,3),

    CONSTRAINT "DeliveryOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "partId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "receivedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "backOrderedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTake" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "scopeLocationId" TEXT,
    "scopeCategory" TEXT,
    "blindCount" BOOLEAN NOT NULL DEFAULT true,
    "status" "StockTakeStatus" NOT NULL DEFAULT 'DRAFT',
    "movementsFrozenAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockTake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTakeLine" (
    "id" TEXT NOT NULL,
    "stockTakeId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "systemQty" DECIMAL(12,3) NOT NULL,
    "countedQty" DECIMAL(12,3),
    "variance" DECIMAL(12,3),
    "needsRecount" BOOLEAN NOT NULL DEFAULT false,
    "reasonCode" TEXT,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "StockTakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "jobId" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultSummary" JSONB,

    CONSTRAINT "SyncReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ContractCranes" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ContractCranes_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_userId_key" ON "Technician"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_employeeNo_key" ON "Technician"("employeeNo");

-- CreateIndex
CREATE INDEX "Technician_isOnCall_idx" ON "Technician"("isOnCall");

-- CreateIndex
CREATE INDEX "Competency_technicianId_expiryDate_idx" ON "Competency"("technicianId", "expiryDate");

-- CreateIndex
CREATE INDEX "Unavailability_technicianId_startAt_idx" ON "Unavailability"("technicianId", "startAt");

-- CreateIndex
CREATE INDEX "Customer_status_legalName_idx" ON "Customer"("status", "legalName");

-- CreateIndex
CREATE INDEX "Contact_customerId_role_idx" ON "Contact"("customerId", "role");

-- CreateIndex
CREATE INDEX "Contact_siteId_idx" ON "Contact"("siteId");

-- CreateIndex
CREATE INDEX "Site_customerId_idx" ON "Site"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Crane_assetTag_key" ON "Crane"("assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "Crane_qrValue_key" ON "Crane"("qrValue");

-- CreateIndex
CREATE INDEX "Crane_customerId_status_idx" ON "Crane"("customerId", "status");

-- CreateIndex
CREATE INDEX "Crane_siteId_status_idx" ON "Crane"("siteId", "status");

-- CreateIndex
CREATE INDEX "Crane_serialNumber_idx" ON "Crane"("serialNumber");

-- CreateIndex
CREATE INDEX "Crane_type_status_idx" ON "Crane"("type", "status");

-- CreateIndex
CREATE INDEX "CraneSchedule_nextDueDate_idx" ON "CraneSchedule"("nextDueDate");

-- CreateIndex
CREATE INDEX "CraneSchedule_craneId_scheduleType_idx" ON "CraneSchedule"("craneId", "scheduleType");

-- CreateIndex
CREATE INDEX "CraneSchedule_ruleId_idx" ON "CraneSchedule"("ruleId");

-- CreateIndex
CREATE INDEX "ComplianceRule_craneType_scheduleType_isActive_idx" ON "ComplianceRule"("craneType", "scheduleType", "isActive");

-- CreateIndex
CREATE INDEX "Certificate_craneId_type_idx" ON "Certificate"("craneId", "type");

-- CreateIndex
CREATE INDEX "Certificate_expiryDate_idx" ON "Certificate"("expiryDate");

-- CreateIndex
CREATE INDEX "Contract_customerId_renewalDate_idx" ON "Contract"("customerId", "renewalDate");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_number_key" ON "Ticket"("number");

-- CreateIndex
CREATE INDEX "Ticket_status_priority_reportedAt_idx" ON "Ticket"("status", "priority", "reportedAt");

-- CreateIndex
CREATE INDEX "Ticket_customerId_status_idx" ON "Ticket"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobType_code_key" ON "JobType"("code");

-- CreateIndex
CREATE INDEX "JobType_isActive_sortOrder_idx" ON "JobType"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Job_number_key" ON "Job"("number");

-- CreateIndex
CREATE INDEX "Job_status_scheduledStart_idx" ON "Job"("status", "scheduledStart");

-- CreateIndex
CREATE INDEX "Job_customerId_status_idx" ON "Job"("customerId", "status");

-- CreateIndex
CREATE INDEX "Job_priority_status_idx" ON "Job"("priority", "status");

-- CreateIndex
CREATE INDEX "Job_scheduledStart_status_idx" ON "Job"("scheduledStart", "status");

-- CreateIndex
CREATE INDEX "Job_jobTypeId_status_idx" ON "Job"("jobTypeId", "status");

-- CreateIndex
CREATE INDEX "Job_ticketId_idx" ON "Job"("ticketId");

-- CreateIndex
CREATE INDEX "JobCrane_craneId_idx" ON "JobCrane"("craneId");

-- CreateIndex
CREATE INDEX "JobTechnician_technicianId_jobId_idx" ON "JobTechnician"("technicianId", "jobId");

-- CreateIndex
CREATE INDEX "JobStatusHistory_jobId_changedAt_idx" ON "JobStatusHistory"("jobId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_priority_contractId_key" ON "SlaPolicy"("priority", "contractId");

-- CreateIndex
CREATE INDEX "Resource_type_status_idx" ON "Resource"("type", "status");

-- CreateIndex
CREATE INDEX "Resource_calibrationDueDate_idx" ON "Resource"("calibrationDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplate_code_version_key" ON "ChecklistTemplate"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_templateId_code_key" ON "ChecklistItem"("templateId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTemplate_code_version_key" ON "ReportTemplate"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Report_documentNumber_key" ON "Report"("documentNumber");

-- CreateIndex
CREATE INDEX "Report_jobId_idx" ON "Report"("jobId");

-- CreateIndex
CREATE INDEX "Report_craneId_status_idx" ON "Report"("craneId", "status");

-- CreateIndex
CREATE INDEX "Report_status_submittedAt_idx" ON "Report"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "Finding_craneId_status_severity_idx" ON "Finding"("craneId", "status", "severity");

-- CreateIndex
CREATE INDEX "Finding_reportId_idx" ON "Finding"("reportId");

-- CreateIndex
CREATE INDEX "File_entity_entityId_idx" ON "File"("entity", "entityId");

-- CreateIndex
CREATE INDEX "File_jobId_idx" ON "File"("jobId");

-- CreateIndex
CREATE INDEX "File_ticketId_idx" ON "File"("ticketId");

-- CreateIndex
CREATE INDEX "File_findingId_idx" ON "File"("findingId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");

-- CreateIndex
CREATE INDEX "Quote_customerId_status_idx" ON "Quote"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_customerId_status_dueDate_idx" ON "Invoice"("customerId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Part_partNumber_key" ON "Part"("partNumber");

-- CreateIndex
CREATE INDEX "Part_brand_idx" ON "Part"("brand");

-- CreateIndex
CREATE INDEX "Part_isActive_idx" ON "Part"("isActive");

-- CreateIndex
CREATE INDEX "Location_type_isActive_idx" ON "Location"("type", "isActive");

-- CreateIndex
CREATE INDEX "StockLevel_partId_quantity_idx" ON "StockLevel"("partId", "quantity");

-- CreateIndex
CREATE INDEX "StockMovement_partId_movedAt_idx" ON "StockMovement"("partId", "movedAt");

-- CreateIndex
CREATE INDEX "StockMovement_jobId_idx" ON "StockMovement"("jobId");

-- CreateIndex
CREATE INDEX "StockMovement_reportId_idx" ON "StockMovement"("reportId");

-- CreateIndex
CREATE INDEX "StockMovement_fromLocationId_idx" ON "StockMovement"("fromLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_toLocationId_idx" ON "StockMovement"("toLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_number_key" ON "DeliveryOrder"("number");

-- CreateIndex
CREATE INDEX "DeliveryOrder_jobId_idx" ON "DeliveryOrder"("jobId");

-- CreateIndex
CREATE INDEX "DeliveryOrder_customerId_status_idx" ON "DeliveryOrder"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_status_idx" ON "PurchaseOrder"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTake_reference_key" ON "StockTake"("reference");

-- CreateIndex
CREATE INDEX "StockTake_status_idx" ON "StockTake"("status");

-- CreateIndex
CREATE INDEX "StockTakeLine_stockTakeId_idx" ON "StockTakeLine"("stockTakeId");

-- CreateIndex
CREATE INDEX "StockTakeLine_partId_locationId_idx" ON "StockTakeLine"("partId", "locationId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_jobId_idx" ON "Notification"("jobId");

-- CreateIndex
CREATE INDEX "SyncReceipt_userId_appliedAt_idx" ON "SyncReceipt"("userId", "appliedAt");

-- CreateIndex
CREATE INDEX "ConflictLog_entity_entityId_idx" ON "ConflictLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "_ContractCranes_B_index" ON "_ContractCranes"("B");

-- AddForeignKey
ALTER TABLE "Technician" ADD CONSTRAINT "Technician_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competency" ADD CONSTRAINT "Competency_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unavailability" ADD CONSTRAINT "Unavailability_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crane" ADD CONSTRAINT "Crane_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crane" ADD CONSTRAINT "Crane_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraneSchedule" ADD CONSTRAINT "CraneSchedule_craneId_fkey" FOREIGN KEY ("craneId") REFERENCES "Crane"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CraneSchedule" ADD CONSTRAINT "CraneSchedule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ComplianceRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_craneId_fkey" FOREIGN KEY ("craneId") REFERENCES "Crane"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_craneId_fkey" FOREIGN KEY ("craneId") REFERENCES "Crane"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_jobTypeId_fkey" FOREIGN KEY ("jobTypeId") REFERENCES "JobType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCrane" ADD CONSTRAINT "JobCrane_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCrane" ADD CONSTRAINT "JobCrane_craneId_fkey" FOREIGN KEY ("craneId") REFERENCES "Crane"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTechnician" ADD CONSTRAINT "JobTechnician_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTechnician" ADD CONSTRAINT "JobTechnician_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStatusHistory" ADD CONSTRAINT "JobStatusHistory_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobResource" ADD CONSTRAINT "JobResource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobResource" ADD CONSTRAINT "JobResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_craneId_fkey" FOREIGN KEY ("craneId") REFERENCES "Crane"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ReportTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_amendmentOfId_fkey" FOREIGN KEY ("amendmentOfId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_craneId_fkey" FOREIGN KEY ("craneId") REFERENCES "Crane"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_followUpJobId_fkey" FOREIGN KEY ("followUpJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockTakeId_fkey" FOREIGN KEY ("stockTakeId") REFERENCES "StockTake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrderLine" ADD CONSTRAINT "DeliveryOrderLine_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTakeLine" ADD CONSTRAINT "StockTakeLine_stockTakeId_fkey" FOREIGN KEY ("stockTakeId") REFERENCES "StockTake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContractCranes" ADD CONSTRAINT "_ContractCranes_A_fkey" FOREIGN KEY ("A") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContractCranes" ADD CONSTRAINT "_ContractCranes_B_fkey" FOREIGN KEY ("B") REFERENCES "Crane"("id") ON DELETE CASCADE ON UPDATE CASCADE;
