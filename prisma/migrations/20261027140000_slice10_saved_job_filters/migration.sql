-- Slice 10: saved job-list filters (brief §8).
--
-- A list of named views per user rather than a `Setting` row: filters are added, renamed and dropped,
-- and they belong to the person who made them. The query is stored as the address-bar string so a
-- saved filter replays exactly the view that saved it.

-- CreateTable
CREATE TABLE "SavedJobFilter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedJobFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedJobFilter_userId_updatedAt_idx" ON "SavedJobFilter"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedJobFilter_userId_name_key" ON "SavedJobFilter"("userId", "name");

-- AddForeignKey
ALTER TABLE "SavedJobFilter" ADD CONSTRAINT "SavedJobFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
