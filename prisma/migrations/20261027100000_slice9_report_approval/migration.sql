-- Slice 9 — approval, locking and PDF.
--
-- Two changes.
--
--   1. `ReportStatus.RETURNED` — the office refusing a submission. Without it the only way to reject
--      a wrong report would be to amend an unapproved one, which would give it a document number it
--      never earned. Adding a value to an enum changes no existing row.
--   2. `Report.returnReason` — the reason the technician is told. Stored on the report rather than
--      only in the audit log, because the phone has to show it and the audit log is not readable by
--      a technician.
--
-- Photos need no new column: their ids are snapshotted into `Report.data.photoFileIds` at submission,
-- so the PDF re-renders the photographs that were attached when the report was signed.

ALTER TYPE "ReportStatus" ADD VALUE 'RETURNED';

ALTER TABLE "Report" ADD COLUMN "returnReason" TEXT;
