-- CreateTable
CREATE TABLE "AttentionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "itemsOpen" INTEGER NOT NULL DEFAULT 0,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "summaryJson" TEXT
);

-- CreateTable
CREATE TABLE "AttentionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "sender" TEXT,
    "subject" TEXT,
    "summary" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "askSummary" TEXT,
    "needsResponse" BOOLEAN NOT NULL DEFAULT false,
    "hasDeadline" BOOLEAN NOT NULL DEFAULT false,
    "deadlineAt" DATETIME,
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "canWait" BOOLEAN NOT NULL DEFAULT true,
    "shouldDraftReply" BOOLEAN NOT NULL DEFAULT false,
    "draftSubject" TEXT,
    "draftBody" TEXT,
    "notifyNow" BOOLEAN NOT NULL DEFAULT false,
    "notificationTitle" TEXT,
    "notificationBody" TEXT,
    "notifiedAt" DATETIME,
    "sourceUrl" TEXT,
    "rawJson" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AttentionAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attentionItemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detailsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttentionAction_attentionItemId_fkey" FOREIGN KEY ("attentionItemId") REFERENCES "AttentionItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AttentionItem_status_updatedAt_idx" ON "AttentionItem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AttentionItem_category_status_idx" ON "AttentionItem"("category", "status");

-- CreateIndex
CREATE INDEX "AttentionItem_notifyNow_notifiedAt_idx" ON "AttentionItem"("notifyNow", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttentionItem_source_sourceId_key" ON "AttentionItem"("source", "sourceId");

-- CreateIndex
CREATE INDEX "AttentionAction_attentionItemId_createdAt_idx" ON "AttentionAction"("attentionItemId", "createdAt");

-- CreateIndex
CREATE INDEX "AttentionAction_action_createdAt_idx" ON "AttentionAction"("action", "createdAt");
