-- The owner removed customer delivery entirely (25 Nov 2026): reports and certificates are internal
-- records, nothing is emailed to a customer. This column only ever recorded that send.
ALTER TABLE "Report" DROP COLUMN "emailedToCustomerAt";
