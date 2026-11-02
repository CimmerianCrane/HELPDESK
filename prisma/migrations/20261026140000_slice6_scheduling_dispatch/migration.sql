-- Slice 6 — scheduling and dispatch.
--
-- Three changes, all additive except one:
--
--   1. `JobType.requiredCompetencies` — which competencies a kind of work demands. Matched against
--      `Competency.name` on the assigned technician. Empty means no requirement, so every existing
--      job type keeps behaving exactly as it did.
--   2. `OnCallShift` — replaces `Technician.isOnCall`. A boolean answers "is somebody on call now";
--      the roster the brief asks for (§4.4) needs "who, and when", which a flag cannot record.
--   3. `ScheduleBump` — a priority bump that displaces a scheduled visit, with the reason and both
--      jobs. Audited through `AuditLog` as well; this table is the queryable record.
--
-- The data migration for (2) runs before the column is dropped, so a technician flagged on call at
-- the moment of deployment keeps that state as a shift rather than losing it. The shift spans one
-- week from now: the old flag carried no dates, so a week is the shortest honest span, and it stays
-- visible on the roster for somebody to correct.

-- 1. Required competencies on a job type -----------------------------------------------------------
ALTER TABLE "JobType" ADD COLUMN "requiredCompetencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2. On-call roster --------------------------------------------------------------------------------
CREATE TABLE "OnCallShift" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallShift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OnCallShift_startAt_endAt_idx" ON "OnCallShift"("startAt", "endAt");
CREATE INDEX "OnCallShift_technicianId_startAt_idx" ON "OnCallShift"("technicianId", "startAt");

ALTER TABLE "OnCallShift" ADD CONSTRAINT "OnCallShift_technicianId_fkey"
  FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry the old flag across before removing it.
INSERT INTO "OnCallShift" ("id", "technicianId", "startAt", "endAt", "notes", "updatedAt")
SELECT
  gen_random_uuid()::text,
  "id",
  date_trunc('hour', now()),
  date_trunc('hour', now()) + interval '7 days',
  'Carried over from the on-call flag when the roster was introduced. Correct the dates.',
  now()
FROM "Technician"
WHERE "isOnCall" = true;

DROP INDEX "Technician_isOnCall_idx";
ALTER TABLE "Technician" DROP COLUMN "isOnCall";

-- 3. Priority bumps that displace a scheduled visit ------------------------------------------------
CREATE TABLE "ScheduleBump" (
    "id" TEXT NOT NULL,
    "displacedJobId" TEXT NOT NULL,
    "incomingJobId" TEXT,
    "reason" TEXT NOT NULL,
    "previousStart" TIMESTAMP(3),
    "previousEnd" TIMESTAMP(3),
    "bumpedById" TEXT,
    "bumpedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleBump_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduleBump_displacedJobId_bumpedAt_idx" ON "ScheduleBump"("displacedJobId", "bumpedAt");
CREATE INDEX "ScheduleBump_incomingJobId_idx" ON "ScheduleBump"("incomingJobId");
