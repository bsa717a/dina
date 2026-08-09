-- CreateTable
CREATE TABLE "AttentionBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AttentionBlock_kind_value_key" ON "AttentionBlock"("kind", "value");

-- CreateIndex
CREATE INDEX "AttentionBlock_kind_value_idx" ON "AttentionBlock"("kind", "value");
