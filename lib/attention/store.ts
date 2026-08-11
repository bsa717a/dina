import { prisma } from "@/lib/db/client";
import type {
  AttentionActionType,
  ClassifiedAttention,
} from "@/lib/attention/types";
import { isActionableCategory } from "@/lib/attention/types";

/** A scan still marked running and started within the last 12 minutes. */
export async function findActiveAttentionRun(maxAgeMs = 12 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs);
  return prisma.attentionRun.findFirst({
    where: {
      status: "running",
      startedAt: { gte: cutoff },
    },
    orderBy: { startedAt: "desc" },
  });
}

/** Mark stuck "running" scans as errored so a new scan can proceed. */
export async function expireStaleAttentionRuns(maxAgeMs = 12 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await prisma.attentionRun.updateMany({
    where: {
      status: "running",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "error",
      finishedAt: new Date(),
      error: "Scan timed out or was interrupted.",
    },
  });
  return result.count;
}

export async function startAttentionRun() {
  return prisma.attentionRun.create({
    data: { status: "running" },
  });
}

export async function finishAttentionRun(
  id: string,
  data: {
    status: "ok" | "error";
    itemsSeen: number;
    itemsOpen: number;
    notified: number;
    error?: string;
    summaryJson?: string;
  },
) {
  return prisma.attentionRun.update({
    where: { id },
    data: {
      status: data.status,
      finishedAt: new Date(),
      itemsSeen: data.itemsSeen,
      itemsOpen: data.itemsOpen,
      notified: data.notified,
      error: data.error,
      summaryJson: data.summaryJson,
    },
  });
}

async function hasUserProtectedDraft(attentionItemId: string): Promise<boolean> {
  const action = await prisma.attentionAction.findFirst({
    where: {
      attentionItemId,
      action: { in: ["edited_draft", "revise_draft"] },
    },
    select: { id: true },
  });
  return Boolean(action);
}

export async function upsertClassifiedItems(items: ClassifiedAttention[]) {
  const upserted = [];
  for (const item of items) {
    const deadlineAt =
      item.deadlineAt && !Number.isNaN(Date.parse(item.deadlineAt))
        ? new Date(item.deadlineAt)
        : null;

    // Never reopen dismissed/resolved/sent items automatically.
    // Active snoozes stay snoozed until wake; expired snoozes wake first.
    const existing = await prisma.attentionItem.findUnique({
      where: {
        source_sourceId: { source: item.source, sourceId: item.sourceId },
      },
    });

    if (existing && ["dismissed", "resolved", "sent"].includes(existing.status)) {
      await prisma.attentionItem.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      upserted.push(existing);
      continue;
    }

    if (existing?.status === "snoozed") {
      const until = existing.snoozedUntil?.getTime() ?? 0;
      if (until > Date.now()) {
        await prisma.attentionItem.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date() },
        });
        upserted.push(existing);
        continue;
      }
      await prisma.attentionItem.update({
        where: { id: existing.id },
        data: { status: "open", snoozedUntil: null },
      });
    }

    // Preserve drafts Derek saved or AI-revised; rescans must not clobber them.
    const protectDraft =
      existing != null && (await hasUserProtectedDraft(existing.id));

    const row = await prisma.attentionItem.upsert({
      where: {
        source_sourceId: { source: item.source, sourceId: item.sourceId },
      },
      create: {
        source: item.source,
        sourceId: item.sourceId,
        category: item.category,
        status: isActionableCategory(item.category) ? "open" : "dismissed",
        sender: item.sender,
        subject: item.subject,
        summary: item.summary,
        whyItMatters: item.whyItMatters,
        recommendedAction: item.recommendedAction,
        askSummary: item.askSummary,
        needsResponse: item.needsResponse,
        hasDeadline: item.hasDeadline,
        deadlineAt:
          item.occursAt && !Number.isNaN(Date.parse(item.occursAt))
            ? new Date(item.occursAt)
            : deadlineAt,
        isBlocking: item.isBlocking,
        canWait: item.canWait,
        shouldDraftReply: item.shouldDraftReply,
        draftSubject: item.draftSubject,
        draftBody: item.draftBody,
        notifyNow: item.notifyNow,
        notificationTitle: item.notificationTitle,
        notificationBody: item.notificationBody,
        rawJson: JSON.stringify(item),
        lastSeenAt: new Date(),
      },
      update: {
        category: item.category,
        status: isActionableCategory(item.category) ? "open" : "dismissed",
        sender: item.sender,
        subject: item.subject,
        summary: item.summary,
        whyItMatters: item.whyItMatters,
        recommendedAction: item.recommendedAction,
        askSummary: item.askSummary,
        needsResponse: item.needsResponse,
        hasDeadline: item.hasDeadline,
        deadlineAt:
          item.occursAt && !Number.isNaN(Date.parse(item.occursAt))
            ? new Date(item.occursAt)
            : deadlineAt,
        isBlocking: item.isBlocking,
        canWait: item.canWait,
        ...(protectDraft
          ? {}
          : {
              shouldDraftReply: item.shouldDraftReply,
              draftSubject: item.draftSubject,
              draftBody: item.draftBody,
            }),
        notifyNow: item.notifyNow,
        notificationTitle: item.notificationTitle,
        notificationBody: item.notificationBody,
        rawJson: JSON.stringify(item),
        lastSeenAt: new Date(),
      },
    });
    upserted.push(row);
  }
  return upserted;
}

/** Flip expired snoozes back to open so they reappear in the panel. */
export async function wakeExpiredSnoozes(now = new Date()) {
  const result = await prisma.attentionItem.updateMany({
    where: {
      status: "snoozed",
      snoozedUntil: { lte: now },
    },
    data: {
      status: "open",
      snoozedUntil: null,
    },
  });
  return result.count;
}

export async function listOpenAttentionItems(options?: {
  /** When false, leave expired snoozes alone (e.g. Mark all done). Default true. */
  wakeSnoozes?: boolean;
}) {
  if (options?.wakeSnoozes !== false) {
    await wakeExpiredSnoozes();
  }
  return prisma.attentionItem.findMany({
    where: {
      status: "open",
      category: { not: "fyi_ignore" },
    },
    orderBy: [{ isBlocking: "desc" }, { hasDeadline: "desc" }, { updatedAt: "desc" }],
    take: 30,
  });
}

export async function getAttentionItem(id: string) {
  return prisma.attentionItem.findUnique({ where: { id } });
}

export async function recordAttentionAction(input: {
  attentionItemId: string;
  action: AttentionActionType;
  details?: Record<string, unknown>;
}) {
  return prisma.attentionAction.create({
    data: {
      attentionItemId: input.attentionItemId,
      action: input.action,
      detailsJson: input.details ? JSON.stringify(input.details) : null,
    },
  });
}

export async function updateAttentionItemStatus(
  id: string,
  status: string,
  extra?: {
    draftSubject?: string;
    draftBody?: string;
    notifiedAt?: Date;
    snoozedUntil?: Date | null;
  },
) {
  const snoozedUntil =
    status === "snoozed"
      ? (extra?.snoozedUntil ?? undefined)
      : extra && "snoozedUntil" in extra
        ? extra.snoozedUntil
        : null;

  return prisma.attentionItem.update({
    where: { id },
    data: {
      status,
      draftSubject: extra?.draftSubject,
      draftBody: extra?.draftBody,
      notifiedAt: extra?.notifiedAt,
      ...(snoozedUntil !== undefined ? { snoozedUntil } : {}),
    },
  });
}

export async function updateAttentionItemContent(
  id: string,
  data: {
    summary?: string;
    whyItMatters?: string;
    recommendedAction?: string;
    draftSubject?: string | null;
    draftBody?: string | null;
    shouldDraftReply?: boolean;
  },
) {
  return prisma.attentionItem.update({
    where: { id },
    data: {
      summary: data.summary,
      whyItMatters: data.whyItMatters,
      recommendedAction: data.recommendedAction,
      draftSubject: data.draftSubject,
      draftBody: data.draftBody,
      shouldDraftReply: data.shouldDraftReply,
    },
  });
}

export async function listItemsNeedingNotification() {
  return prisma.attentionItem.findMany({
    where: {
      status: "open",
      notifyNow: true,
      notifiedAt: null,
      category: { not: "fyi_ignore" },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
}
