-- Slice 28: a job on hold awaiting parts names the part it is waiting for, so the job page can say
-- which part and when it lands (from the open purchase order line's expected date).
ALTER TABLE "Job" ADD COLUMN "onHoldPartId" TEXT;

-- SetNull: a part withdrawn from the catalogue empties the hold's link rather than blocking the delete.
ALTER TABLE "Job" ADD CONSTRAINT "Job_onHoldPartId_fkey" FOREIGN KEY ("onHoldPartId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
