-- Slice 19: quotes and variations.
--
-- `Quote.gstRate` is the rate the quote was priced at. Without it, a reprint after the office changes
-- `Setting.gstRate` would show the new rate beside amounts computed at the old one — the invoice table
-- already snapshots it for the same reason. The total columns are already stored, so this column
-- changes no existing amount; rows (if any) default to 0, which reads as "not recorded" on an old row.
--
-- Additive only.

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "gstRate" DECIMAL(5,4) NOT NULL DEFAULT 0;
