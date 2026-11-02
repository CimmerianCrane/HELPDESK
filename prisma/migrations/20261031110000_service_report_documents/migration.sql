-- The Service Report (slice 39): one issued document per site visit.
--
-- The technician fills a **Servicing checklist form** on each crane — a `Report` with a 1–5 rating and
-- a comment on every line (`Report.data.grades`, added by the previous migration). This is the other
-- half: the visit's Service Report, which turns those grades into prose, one section per crane, and
-- takes the `SR<yy><mm><nnn>` number when the office approves it.
--
-- A separate table rather than a `Report` row because it belongs to the job (every crane, not one),
-- is generated rather than signed, and its prose is editable until approval.
--
-- `JobType.isServiceReport` — the flag that marks a job type as issuing one — was added by
-- 20261031100000_service_report_grades; that flag stays.

CREATE TYPE "ServiceReportStatus" AS ENUM ('DRAFT', 'APPROVED');

CREATE TABLE "ServiceReport" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "ServiceReportStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "documentNumber" TEXT,
    "pdfFileId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceReport_pkey" PRIMARY KEY ("id")
);

-- One Service Report per job, enforced by the database as well as by the service: a visit has one.
CREATE UNIQUE INDEX "ServiceReport_jobId_key" ON "ServiceReport"("jobId");
CREATE UNIQUE INDEX "ServiceReport_documentNumber_key" ON "ServiceReport"("documentNumber");
CREATE INDEX "ServiceReport_status_createdAt_idx" ON "ServiceReport"("status", "createdAt");

ALTER TABLE "ServiceReport" ADD CONSTRAINT "ServiceReport_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
