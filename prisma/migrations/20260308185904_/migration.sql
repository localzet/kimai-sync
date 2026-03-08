-- CreateTable
CREATE TABLE "Activity" (
    "id" SERIAL NOT NULL,
    "kimaiId" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Activity_kimaiId_key" ON "Activity"("kimaiId");

-- CreateIndex
CREATE INDEX "Activity_kimaiId_idx" ON "Activity"("kimaiId");

-- CreateIndex
CREATE INDEX "Activity_isActive_idx" ON "Activity"("isActive");
