-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assistantName" TEXT NOT NULL,
    "assistantPersona" TEXT NOT NULL DEFAULT '',
    "accessCodeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Dina',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "openaiResponseId" TEXT,
    "starredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAttempt" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "itemsOpen" INTEGER NOT NULL DEFAULT 0,
    "notified" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "summaryJson" TEXT,

    CONSTRAINT "AttentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CosDecisionRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CosDecisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionItem" (
    "id" TEXT NOT NULL,
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
    "deadlineAt" TIMESTAMP(3),
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "canWait" BOOLEAN NOT NULL DEFAULT true,
    "shouldDraftReply" BOOLEAN NOT NULL DEFAULT false,
    "draftSubject" TEXT,
    "draftBody" TEXT,
    "notifyNow" BOOLEAN NOT NULL DEFAULT false,
    "notificationTitle" TEXT,
    "notificationBody" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "rawJson" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttentionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionAction" (
    "id" TEXT NOT NULL,
    "attentionItemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detailsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttentionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionBlock" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttentionBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryItem" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "projectKey" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'active',
    "relatedIdsJson" TEXT NOT NULL DEFAULT '[]',
    "mergedIntoId" TEXT,
    "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
    "embeddingModel" TEXT,
    "embeddingRef" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'chat',
    "createdByUserId" TEXT,
    "assigneeUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MorningRitualWeekPlan" (
    "id" TEXT NOT NULL,
    "lessonKey" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MorningRitualWeekPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMember_projectKey_idx" ON "ProjectMember"("projectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_userId_projectKey_key" ON "ProjectMember"("userId", "projectKey");

-- CreateIndex
CREATE INDEX "Conversation_userId_createdAt_idx" ON "Conversation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_starredAt_idx" ON "Message"("starredAt");

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "CosDecisionRecord_disposition_createdAt_idx" ON "CosDecisionRecord"("disposition", "createdAt");

-- CreateIndex
CREATE INDEX "CosDecisionRecord_priority_createdAt_idx" ON "CosDecisionRecord"("priority", "createdAt");

-- CreateIndex
CREATE INDEX "CosDecisionRecord_runId_idx" ON "CosDecisionRecord"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "CosDecisionRecord_eventId_key" ON "CosDecisionRecord"("eventId");

-- CreateIndex
CREATE INDEX "AttentionItem_status_updatedAt_idx" ON "AttentionItem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AttentionItem_category_status_idx" ON "AttentionItem"("category", "status");

-- CreateIndex
CREATE INDEX "AttentionItem_notifyNow_notifiedAt_idx" ON "AttentionItem"("notifyNow", "notifiedAt");

-- CreateIndex
CREATE INDEX "AttentionItem_status_snoozedUntil_idx" ON "AttentionItem"("status", "snoozedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AttentionItem_source_sourceId_key" ON "AttentionItem"("source", "sourceId");

-- CreateIndex
CREATE INDEX "AttentionAction_attentionItemId_createdAt_idx" ON "AttentionAction"("attentionItemId", "createdAt");

-- CreateIndex
CREATE INDEX "AttentionAction_action_createdAt_idx" ON "AttentionAction"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AttentionBlock_kind_value_idx" ON "AttentionBlock"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "AttentionBlock_kind_value_key" ON "AttentionBlock"("kind", "value");

-- CreateIndex
CREATE INDEX "MemoryItem_category_status_idx" ON "MemoryItem"("category", "status");

-- CreateIndex
CREATE INDEX "MemoryItem_status_importance_idx" ON "MemoryItem"("status", "importance");

-- CreateIndex
CREATE INDEX "MemoryItem_status_updatedAt_idx" ON "MemoryItem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MemoryItem_embeddingStatus_idx" ON "MemoryItem"("embeddingStatus");

-- CreateIndex
CREATE INDEX "MemoryItem_ownerUserId_status_idx" ON "MemoryItem"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "MemoryItem_projectKey_status_idx" ON "MemoryItem"("projectKey", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_projectKey_status_idx" ON "ProjectTask"("projectKey", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_projectKey_sortOrder_idx" ON "ProjectTask"("projectKey", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTask_projectKey_title_key" ON "ProjectTask"("projectKey", "title");

-- CreateIndex
CREATE INDEX "MorningRitualWeekPlan_weekStart_idx" ON "MorningRitualWeekPlan"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "MorningRitualWeekPlan_lessonKey_weekStart_key" ON "MorningRitualWeekPlan"("lessonKey", "weekStart");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttentionAction" ADD CONSTRAINT "AttentionAction_attentionItemId_fkey" FOREIGN KEY ("attentionItemId") REFERENCES "AttentionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryItem" ADD CONSTRAINT "MemoryItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

