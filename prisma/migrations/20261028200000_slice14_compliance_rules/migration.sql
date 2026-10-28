-- Slice 14: compliance rules become a working admin screen (brief §7).
--
-- Two additive columns. `Crane.reregistrationRequiredAt` and its reason are the "re-registration may
-- be required" reminder the brief asks for (§7.3): it is raised when a crane's owner, its customer's
-- UEN or its site changes, and cleared by the person who has checked it. Nothing is deleted, and no
-- existing row changes: both columns are nullable and stay null until a change is detected.
--
-- `ComplianceRule` itself needed no change — `sourceReference`, `reviewedAt`, the effective dates and
-- `isActive` already exist. The admin screen writes them; it does not add to the model.

-- AlterTable
ALTER TABLE "Crane" ADD COLUMN "reregistrationRequiredAt" TIMESTAMP(3);
ALTER TABLE "Crane" ADD COLUMN "reregistrationReason" TEXT;
