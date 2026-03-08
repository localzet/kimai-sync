-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "notionTemplate" JSONB;

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_begin_idx" ON "TimeEntry"("projectId", "begin");

-- CreateIndex
CREATE INDEX "TimeEntry_synced_syncedAt_idx" ON "TimeEntry"("synced", "syncedAt");
