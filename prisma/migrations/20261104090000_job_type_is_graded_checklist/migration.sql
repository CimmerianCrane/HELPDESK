-- Grading a checklist and issuing a Service Report are two things, not one. A breakdown call-out
-- grades every crane part but issues no SR document, so the phone's grade gate needs its own flag.
-- The backfill derives it from the flag it came from, so a PM job grades throughout the window
-- between `db:deploy` and `seed`; BREAKDOWN is switched on by the seed, not here.
ALTER TABLE "JobType" ADD COLUMN "isGradedChecklist" BOOLEAN NOT NULL DEFAULT false;

UPDATE "JobType" SET "isGradedChecklist" = true WHERE "isServiceReport" = true;
