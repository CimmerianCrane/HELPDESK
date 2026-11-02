-- Slice 31: the customer portal. A CUSTOMER login is now attached to the one customer whose data it
-- may see, which every scope filter in scope.ts keys off.
ALTER TABLE "User" ADD COLUMN "customerId" TEXT;

-- SetNull: archiving a customer must not fail because a portal login still points at it. A login left
-- with no customer is scoped to nothing by scope.ts, which is the fail-closed answer.
ALTER TABLE "User" ADD CONSTRAINT "User_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_customerId_idx" ON "User"("customerId");
