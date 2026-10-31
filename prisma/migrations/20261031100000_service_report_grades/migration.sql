-- Service Reports: the graded sheet a technician fills in on site.
--
-- Every checklist line is given a 1–5 condition rating and a short comment ("replace the brake
-- lining", "drum grooved"). The grades live in `Report.data.grades` — keyed by `ChecklistItem.code`,
-- with the line's label snapshotted so an issued report still names it after the checklist template is
-- superseded — for the same reason the checklist answers do: `Report.data` is the record of what was
-- signed, and it must re-render exactly as issued.
--
-- A Service Report also numbers `SR<yy><mm><nnn>` (the first of June 2026 is SR2606001). That counter
-- lives in the existing `DocumentSequence` table under the key `SR:<yymm>`, so there is no new table:
-- only the job-type flag that says which reports are Service Reports.

ALTER TABLE "JobType" ADD COLUMN "isServiceReport" BOOLEAN NOT NULL DEFAULT false;

-- The seeded scheduled-servicing type (code PM) is the Service Report; the office may name another.
UPDATE "JobType" SET "isServiceReport" = true WHERE "code" = 'PM';
