-- Slice 12: recurring crane schedules become a working screen (brief §8).
--
-- The `CraneSchedule` table has existed since the init migration and the demo seed has been writing
-- rows into it, but nothing ever ended one: an obligation that no longer applies had no state between
-- "still due" and a hard delete, and CLAUDE.md rule 4 forbids deleting the records a past job or
-- reminder points at. `deletedAt` gives archiving the same shape it has everywhere else.

-- AlterTable
ALTER TABLE "CraneSchedule" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- The list screen reads live schedules ordered by due date; the existing index on (nextDueDate) serves
-- it, but a partial index would be premature at this table's size.
