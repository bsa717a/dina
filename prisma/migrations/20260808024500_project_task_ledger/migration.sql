-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'chat',
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ProjectTask_projectKey_status_idx" ON "ProjectTask"("projectKey", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_projectKey_sortOrder_idx" ON "ProjectTask"("projectKey", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTask_projectKey_title_key" ON "ProjectTask"("projectKey", "title");
