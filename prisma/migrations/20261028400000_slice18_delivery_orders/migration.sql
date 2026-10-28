-- Slice 18: delivery orders (brief §6.5).
--
-- `DeliveryOrderLine.movementId` is the link between the paperwork and the stock ledger: a line
-- names the `StockMovement` of type `ISSUE` that took the part out, so one issued part cannot appear
-- on two live delivery orders and the quantities cannot disagree. Nullable because the column is
-- added to a table that already has rows in some deployments; unique so two DOs cannot claim one
-- movement.
--
-- `receivedQuantity` is what a partial delivery needs: a DO goes out with five items and comes back
-- signed for three, then for the rest. Defaulting to 0 means every existing row stays "not yet
-- received", which is the honest reading of a DO that was never receipted. Both additions are
-- additive; no existing value changes.

-- AlterTable
ALTER TABLE "DeliveryOrderLine" ADD COLUMN "movementId" TEXT,
ADD COLUMN "receivedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrderLine_movementId_key" ON "DeliveryOrderLine"("movementId");

-- AddForeignKey
ALTER TABLE "DeliveryOrderLine" ADD CONSTRAINT "DeliveryOrderLine_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
