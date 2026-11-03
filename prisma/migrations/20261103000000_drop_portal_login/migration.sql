-- The customer portal is removed. A CUSTOMER login existed only to show a read-only copy of records
-- the office already emails, and carried the support cost of external accounts with no self-service
-- password reset. The role, the customer link and the portal screens all go.

-- Required FKs are RESTRICT, so clear the rows that would block deleting the own-only users first.
-- AuditLog.userId is SET NULL and handles itself.
DELETE FROM "PushSubscription" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'CUSTOMER');
DELETE FROM "Notification" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'CUSTOMER');
DELETE FROM "SavedJobFilter" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'CUSTOMER');
DELETE FROM "User" WHERE "role" = 'CUSTOMER';

ALTER TABLE "User" DROP CONSTRAINT "User_customerId_fkey";
DROP INDEX "User_customerId_idx";
ALTER TABLE "User" DROP COLUMN "customerId";

-- Postgres cannot remove an enum value in place; recreate the type without CUSTOMER.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DISPATCHER', 'TECHNICIAN', 'STOREKEEPER', 'FINANCE');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
DROP TYPE "Role_old";

-- The portal was the only thing that could use a PORTAL ticket source, and it never could raise one.
ALTER TYPE "TicketSource" RENAME TO "TicketSource_old";
CREATE TYPE "TicketSource" AS ENUM ('PHONE', 'EMAIL', 'WHATSAPP', 'WEB');
ALTER TABLE "Ticket" ALTER COLUMN "source" TYPE "TicketSource" USING ("source"::text::"TicketSource");
DROP TYPE "TicketSource_old";
