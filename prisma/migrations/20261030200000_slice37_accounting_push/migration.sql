-- Slice 37: pushing issued invoices into an accounting system. Additive only.
-- `externalRef` is the accounting system's own id for the bill, written only once a push succeeded;
-- `externalPushedAt` is when. A bill with neither has not been pushed, and is what the screen offers.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "externalPushedAt" TIMESTAMP(3),
ADD COLUMN     "externalRef" TEXT;
