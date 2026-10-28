-- Slice 15: the daily reminder scan (brief §8).
--
-- `ReminderDispatch` is the idempotency key the cron needs: one row per (schedule, threshold,
-- due-date period) already reminded. Vercel Cron can retry, and a re-run must not email the office
-- a second time about the same due date. `period` is the due date as a calendar day in the
-- operating timezone, so a schedule that is done and rolled forward legitimately starts again.
--
-- `CraneSchedule.draftJobTypeId` is the kind of work the scan raises when the obligation falls due.
-- Which job completes which obligation is configuration, not a fact the code may assume (rule 2),
-- so the office chooses it on the schedule. Both additions are additive; no existing row changes.

-- AlterTable
ALTER TABLE "CraneSchedule" ADD COLUMN "draftJobTypeId" TEXT;

-- CreateTable
CREATE TABLE "ReminderDispatch" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "offset" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderDispatch_scheduleId_idx" ON "ReminderDispatch"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDispatch_scheduleId_offset_period_key" ON "ReminderDispatch"("scheduleId", "offset", "period");

-- AddForeignKey
ALTER TABLE "ReminderDispatch" ADD CONSTRAINT "ReminderDispatch_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "CraneSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
