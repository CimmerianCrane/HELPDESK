-- Temporary: the deployed build still expects the pre-portal-removal schema. Restore exactly the
-- column, index, foreign key and enum values that 20261103000000_drop_portal_login removed, so the
-- running application and the database agree again. Additive only: nothing is deleted.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CUSTOMER';
ALTER TYPE "TicketSource" ADD VALUE IF NOT EXISTS 'PORTAL';

ALTER TABLE "User" ADD COLUMN "customerId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_customerId_idx" ON "User"("customerId");
