-- CreateTable
CREATE TABLE "CosDecisionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0,
    "reasoningSummary" TEXT NOT NULL,
    "interruptWhy" TEXT,
    "recommendedAction" TEXT,
    "needsToKnow" BOOLEAN NOT NULL DEFAULT false,
    "canWait" BOOLEAN NOT NULL DEFAULT true,
    "relatedToProject" BOOLEAN NOT NULL DEFAULT false,
    "projectKey" TEXT,
    "someoneWaitingOnDerek" BOOLEAN NOT NULL DEFAULT false,
    "derekWaitingOnSomeone" BOOLEAN NOT NULL DEFAULT false,
    "canDraft" BOOLEAN NOT NULL DEFAULT false,
    "notifyNow" BOOLEAN NOT NULL DEFAULT false,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CosDecisionRecord_disposition_createdAt_idx" ON "CosDecisionRecord"("disposition", "createdAt");

-- CreateIndex
CREATE INDEX "CosDecisionRecord_priority_createdAt_idx" ON "CosDecisionRecord"("priority", "createdAt");

-- CreateIndex
CREATE INDEX "CosDecisionRecord_runId_idx" ON "CosDecisionRecord"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "CosDecisionRecord_eventId_key" ON "CosDecisionRecord"("eventId");
