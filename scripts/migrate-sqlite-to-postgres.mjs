/**
 * Copy existing SQLite data into Postgres and attribute it to the owner.
 *
 *   SQLITE_PATH=data/dina.db node scripts/migrate-sqlite-to-postgres.mjs
 */
import { createRequire } from "module";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const require = createRequire(import.meta.url);

function asDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asBool(value) {
  return value === true || value === 1 || value === "1";
}

function tableExists(db, name) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return Boolean(row);
}

function all(db, name) {
  if (!tableExists(db, name)) return [];
  return db.prepare(`SELECT * FROM "${name}"`).all();
}

function resolveProjectKey(title) {
  const raw = String(title || "").trim().toLowerCase();
  const map = {
    dina: "dina",
    beacon: "beacon",
    "4studentlives": "4studentlives",
    metabolicos: "metabolicos",
    "hidden guardians": "hidden_guardians",
    clifsmama: "clifsmama",
  };
  return map[raw] ?? null;
}

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const sqlitePath = path.resolve(
    process.env.SQLITE_PATH || "data/dina.db",
  );
  const db = new DatabaseSync(sqlitePath);

  let owner = await prisma.user.findFirst({ where: { role: "owner" } });
  if (!owner) {
    throw new Error("Seed the owner first (node scripts/seed-owner.mjs).");
  }

  const existingConversations = await prisma.conversation.count();
  if (existingConversations > 0) {
    console.log("Postgres already has conversations; skipping import.");
    db.close();
    await prisma.$disconnect();
    return;
  }

  const conversations = all(db, "Conversation");
  for (const row of conversations) {
    await prisma.conversation.create({
      data: {
        id: row.id,
        userId: owner.id,
        title: row.title || "Dina",
        createdAt: asDate(row.createdAt) ?? undefined,
        updatedAt: asDate(row.updatedAt) ?? undefined,
      },
    });
  }

  const messages = all(db, "Message");
  for (const row of messages) {
    await prisma.message.create({
      data: {
        id: row.id,
        conversationId: row.conversationId,
        role: row.role,
        content: row.content,
        openaiResponseId: row.openaiResponseId ?? null,
        starredAt: asDate(row.starredAt),
        createdAt: asDate(row.createdAt) ?? undefined,
      },
    });
  }

  const attachments = all(db, "Attachment");
  for (const row of attachments) {
    await prisma.attachment.create({
      data: {
        id: row.id,
        messageId: row.messageId ?? null,
        filename: row.filename,
        mimeType: row.mimeType,
        size: row.size,
        storageKey: row.storageKey,
        uploadedByUserId: owner.id,
        createdAt: asDate(row.createdAt) ?? undefined,
      },
    });
  }

  const pushes = all(db, "PushSubscription");
  for (const row of pushes) {
    await prisma.pushSubscription.create({
      data: {
        id: row.id,
        userId: owner.id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        userAgent: row.userAgent ?? null,
        createdAt: asDate(row.createdAt) ?? undefined,
        updatedAt: asDate(row.updatedAt) ?? undefined,
      },
    });
  }

  const attempts = all(db, "AuthAttempt");
  for (const row of attempts) {
    await prisma.authAttempt.upsert({
      where: { id: row.id || "singleton" },
      create: {
        id: row.id || "singleton",
        failCount: row.failCount ?? 0,
        lockedUntil: asDate(row.lockedUntil),
      },
      update: {
        failCount: row.failCount ?? 0,
        lockedUntil: asDate(row.lockedUntil),
      },
    });
  }

  const runs = all(db, "AttentionRun");
  for (const row of runs) {
    await prisma.attentionRun.create({
      data: {
        id: row.id,
        startedAt: asDate(row.startedAt) ?? undefined,
        finishedAt: asDate(row.finishedAt),
        status: row.status,
        itemsSeen: row.itemsSeen ?? 0,
        itemsOpen: row.itemsOpen ?? 0,
        notified: row.notified ?? 0,
        error: row.error ?? null,
        summaryJson: row.summaryJson ?? null,
      },
    });
  }

  const decisions = all(db, "CosDecisionRecord");
  for (const row of decisions) {
    await prisma.cosDecisionRecord.create({
      data: {
        id: row.id,
        runId: row.runId ?? null,
        eventId: row.eventId,
        eventType: row.eventType,
        connector: row.connector,
        disposition: row.disposition,
        priority: row.priority,
        confidence: row.confidence ?? 0,
        reasoningSummary: row.reasoningSummary,
        interruptWhy: row.interruptWhy ?? null,
        recommendedAction: row.recommendedAction ?? null,
        needsToKnow: asBool(row.needsToKnow),
        canWait: asBool(row.canWait),
        relatedToProject: asBool(row.relatedToProject),
        projectKey: row.projectKey ?? null,
        someoneWaitingOnDerek: asBool(row.someoneWaitingOnDerek),
        derekWaitingOnSomeone: asBool(row.derekWaitingOnSomeone),
        canDraft: asBool(row.canDraft),
        notifyNow: asBool(row.notifyNow),
        payloadJson: row.payloadJson ?? null,
        createdAt: asDate(row.createdAt) ?? undefined,
        updatedAt: asDate(row.updatedAt) ?? undefined,
      },
    });
  }

  const items = all(db, "AttentionItem");
  for (const row of items) {
    await prisma.attentionItem.create({
      data: {
        id: row.id,
        source: row.source,
        sourceId: row.sourceId,
        category: row.category,
        status: row.status,
        sender: row.sender ?? null,
        subject: row.subject ?? null,
        summary: row.summary,
        whyItMatters: row.whyItMatters,
        recommendedAction: row.recommendedAction,
        askSummary: row.askSummary ?? null,
        needsResponse: asBool(row.needsResponse),
        hasDeadline: asBool(row.hasDeadline),
        deadlineAt: asDate(row.deadlineAt),
        isBlocking: asBool(row.isBlocking),
        canWait: asBool(row.canWait),
        shouldDraftReply: asBool(row.shouldDraftReply),
        draftSubject: row.draftSubject ?? null,
        draftBody: row.draftBody ?? null,
        notifyNow: asBool(row.notifyNow),
        notificationTitle: row.notificationTitle ?? null,
        notificationBody: row.notificationBody ?? null,
        notifiedAt: asDate(row.notifiedAt),
        snoozedUntil: asDate(row.snoozedUntil),
        sourceUrl: row.sourceUrl ?? null,
        rawJson: row.rawJson ?? null,
        lastSeenAt: asDate(row.lastSeenAt) ?? undefined,
        createdAt: asDate(row.createdAt) ?? undefined,
        updatedAt: asDate(row.updatedAt) ?? undefined,
      },
    });
  }

  const actions = all(db, "AttentionAction");
  for (const row of actions) {
    await prisma.attentionAction.create({
      data: {
        id: row.id,
        attentionItemId: row.attentionItemId,
        action: row.action,
        detailsJson: row.detailsJson ?? null,
        createdAt: asDate(row.createdAt) ?? undefined,
      },
    });
  }

  const blocks = all(db, "AttentionBlock");
  for (const row of blocks) {
    await prisma.attentionBlock.create({
      data: {
        id: row.id,
        kind: row.kind,
        value: row.value,
        reason: row.reason ?? null,
        source: row.source ?? null,
        createdAt: asDate(row.createdAt) ?? undefined,
      },
    });
  }

  const memories = all(db, "MemoryItem");
  for (const row of memories) {
    const projectKey =
      row.category === "projects" ? resolveProjectKey(row.title) : null;
    await prisma.memoryItem.create({
      data: {
        id: row.id,
        ownerUserId: owner.id,
        projectKey,
        category: row.category,
        title: row.title,
        content: row.content,
        source: row.source,
        confidence: row.confidence ?? 0.5,
        importance: row.importance ?? "normal",
        status: row.status ?? "active",
        relatedIdsJson: row.relatedIdsJson ?? "[]",
        mergedIntoId: row.mergedIntoId ?? null,
        embeddingStatus: row.embeddingStatus ?? "pending",
        embeddingModel: row.embeddingModel ?? null,
        embeddingRef: row.embeddingRef ?? null,
        searchText: row.searchText ?? "",
        lastAccessedAt: asDate(row.lastAccessedAt),
        createdAt: asDate(row.createdAt) ?? undefined,
        updatedAt: asDate(row.updatedAt) ?? undefined,
      },
    });
  }

  const tasks = all(db, "ProjectTask");
  for (const row of tasks) {
    await prisma.projectTask.create({
      data: {
        id: row.id,
        projectKey: row.projectKey,
        title: row.title,
        description: row.description ?? "",
        status: row.status ?? "open",
        sortOrder: row.sortOrder ?? 0,
        source: row.source ?? "chat",
        createdByUserId: owner.id,
        completedAt: asDate(row.completedAt),
        createdAt: asDate(row.createdAt) ?? undefined,
        updatedAt: asDate(row.updatedAt) ?? undefined,
      },
    });
  }

  const plans = all(db, "MorningRitualWeekPlan");
  for (const row of plans) {
    await prisma.morningRitualWeekPlan.create({
      data: {
        id: row.id,
        lessonKey: row.lessonKey,
        weekStart: row.weekStart,
        planJson: row.planJson,
        createdAt: asDate(row.createdAt) ?? undefined,
        updatedAt: asDate(row.updatedAt) ?? undefined,
      },
    });
  }

  console.log(
    `Imported ${conversations.length} conversations, ${messages.length} messages, ${memories.length} memories, ${tasks.length} tasks for ${owner.name}.`,
  );
  db.close();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
