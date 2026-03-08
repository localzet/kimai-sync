-- CreateTable "Project"
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "kimaiId" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "notionDatabaseId" UUID,
    "notionDatabaseUrl" TEXT,
    "notionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable "TimeEntry"
CREATE TABLE "TimeEntry" (
    "id" SERIAL NOT NULL,
    "kimaiId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "activity" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "tags" VARCHAR(255),
    "begin" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "duration" INTEGER NOT NULL DEFAULT 0,
    "synced" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "notionPageId" UUID,
    "notionPageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_kimaiId_key" ON "Project"("kimaiId");

-- CreateIndex
CREATE INDEX "Project_kimaiId_idx" ON "Project"("kimaiId");

-- CreateIndex
CREATE INDEX "Project_notionDatabaseId_idx" ON "Project"("notionDatabaseId");

-- CreateIndex
CREATE INDEX "Project_isActive_idx" ON "Project"("isActive");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "Project_isActive_createdAt_idx" ON "Project"("isActive", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_kimaiId_key" ON "TimeEntry"("kimaiId");

-- CreateIndex
CREATE INDEX "TimeEntry_projectId_idx" ON "TimeEntry"("projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_synced_idx" ON "TimeEntry"("synced");

-- CreateIndex
CREATE INDEX "TimeEntry_begin_idx" ON "TimeEntry"("begin");

-- CreateIndex
CREATE INDEX "TimeEntry_synced_begin_idx" ON "TimeEntry"("synced", "begin");

-- CreateIndex
CREATE INDEX "TimeEntry_synced_begin_projectId_idx" ON "TimeEntry"("synced", "begin", "projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_notionPageId_idx" ON "TimeEntry"("notionPageId");

-- CreateIndex
CREATE INDEX "TimeEntry_createdAt_idx" ON "TimeEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
