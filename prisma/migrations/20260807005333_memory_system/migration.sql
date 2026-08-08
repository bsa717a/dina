-- CreateTable
CREATE TABLE "MemoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'active',
    "relatedIdsJson" TEXT NOT NULL DEFAULT '[]',
    "mergedIntoId" TEXT,
    "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
    "embeddingModel" TEXT,
    "embeddingRef" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MemoryItem_category_status_idx" ON "MemoryItem"("category", "status");

-- CreateIndex
CREATE INDEX "MemoryItem_status_importance_idx" ON "MemoryItem"("status", "importance");

-- CreateIndex
CREATE INDEX "MemoryItem_status_updatedAt_idx" ON "MemoryItem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MemoryItem_embeddingStatus_idx" ON "MemoryItem"("embeddingStatus");
