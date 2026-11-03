-- AlterTable
ALTER TABLE "ChecklistTemplate" ADD COLUMN     "craneTypes" "CraneType"[] DEFAULT ARRAY[]::"CraneType"[];
