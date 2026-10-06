-- Sections belong to one project and group that project's tasks.
CREATE TABLE "ProjectSection" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSection_projectKey_nameKey_key" ON "ProjectSection"("projectKey", "nameKey");

-- CreateIndex
CREATE INDEX "ProjectSection_projectKey_sortOrder_idx" ON "ProjectSection"("projectKey", "sortOrder");

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN "sectionId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectTask_sectionId_idx" ON "ProjectTask"("sectionId");
