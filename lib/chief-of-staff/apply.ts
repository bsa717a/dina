import type { CosDecision, NormalizedEvent } from "@/lib/chief-of-staff/types";
import { upsertClassifiedItems } from "@/lib/attention/store";
import type { ClassifiedAttention } from "@/lib/attention/types";
import { prisma } from "@/lib/db/client";
import { createOrCorrectMemory } from "@/lib/memory/store";
import { logger } from "@/lib/logger";

function decisionToAttentionItem(
  event: NormalizedEvent,
  decision: CosDecision,
): ClassifiedAttention | null {
  if (decision.disposition !== "create_attention_card" || !decision.card) {
    return null;
  }

  const card = decision.card;
  return {
    source:
      event.connector === "github"
        ? "github"
        : event.type === "MeetingInvitation"
          ? "meeting_invite"
          : event.type === "CalendarChanged"
            ? "calendar"
            : event.type === "ReminderDue"
              ? "todo"
              : "email",
    sourceId: event.eventId,
    category: card.category,
    sender: card.sender || event.actor,
    senderEmail:
      typeof event.payload?.fromAddress === "string"
        ? event.payload.fromAddress
        : typeof event.payload?.organizerAddress === "string"
          ? event.payload.organizerAddress
          : undefined,
    subject: card.subject || event.title,
    summary: card.summary,
    whyItMatters: card.whyItMatters,
    recommendedAction:
      decision.recommendedAction || "Review and decide next step.",
    askSummary: decision.reasoningSummary,
    needsResponse: decision.analysis.someoneWaitingOnDerek,
    hasDeadline: Boolean(card.occursAt),
    deadlineAt: card.occursAt,
    occursAt: card.occursAt,
    occursEndAt: card.occursEndAt,
    githubAccountId: card.githubAccountId,
    githubAccountLabel: card.githubAccountLabel,
    githubRepoKey: card.githubRepoKey,
    isBlocking:
      decision.priority === "critical" || decision.priority === "high",
    canWait: decision.analysis.canWait,
    shouldDraftReply: Boolean(decision.analysis.canDraft && decision.draftBody),
    draftSubject: decision.draftSubject,
    draftBody: decision.draftBody,
    notifyNow: decision.notifyNow,
    notificationTitle:
      decision.priority === "critical"
        ? "Urgent"
        : card.githubAccountLabel || event.actor || "Dina",
    notificationBody: decision.interruptWhy || card.whyItMatters,
  };
}

export async function persistCosDecisions(
  runId: string,
  events: NormalizedEvent[],
  decisions: CosDecision[],
) {
  const byEventId = new Map(events.map((e) => [e.eventId, e]));
  const attentionItems: ClassifiedAttention[] = [];
  let memoriesWritten = 0;

  for (const decision of decisions) {
    const event = byEventId.get(decision.eventId);
    await prisma.cosDecisionRecord.upsert({
      where: { eventId: decision.eventId },
      create: {
        runId,
        eventId: decision.eventId,
        eventType: decision.eventType,
        connector: String(decision.connector),
        disposition: decision.disposition,
        priority: decision.priority,
        confidence: decision.confidence,
        reasoningSummary: decision.reasoningSummary,
        interruptWhy: decision.interruptWhy,
        recommendedAction: decision.recommendedAction,
        needsToKnow: decision.analysis.needsToKnow,
        canWait: decision.analysis.canWait,
        relatedToProject: decision.analysis.relatedToProject,
        projectKey: decision.analysis.projectKey,
        someoneWaitingOnDerek: decision.analysis.someoneWaitingOnDerek,
        derekWaitingOnSomeone: decision.analysis.derekWaitingOnSomeone,
        canDraft: decision.analysis.canDraft,
        notifyNow: decision.notifyNow,
        payloadJson: JSON.stringify({
          event: event || null,
          decision,
        }),
      },
      update: {
        runId,
        eventType: decision.eventType,
        connector: String(decision.connector),
        disposition: decision.disposition,
        priority: decision.priority,
        confidence: decision.confidence,
        reasoningSummary: decision.reasoningSummary,
        interruptWhy: decision.interruptWhy,
        recommendedAction: decision.recommendedAction,
        needsToKnow: decision.analysis.needsToKnow,
        canWait: decision.analysis.canWait,
        relatedToProject: decision.analysis.relatedToProject,
        projectKey: decision.analysis.projectKey,
        someoneWaitingOnDerek: decision.analysis.someoneWaitingOnDerek,
        derekWaitingOnSomeone: decision.analysis.derekWaitingOnSomeone,
        canDraft: decision.analysis.canDraft,
        notifyNow: decision.notifyNow,
        payloadJson: JSON.stringify({
          event: event || null,
          decision,
        }),
      },
    });

    if (event) {
      const attention = decisionToAttentionItem(event, decision);
      if (attention) attentionItems.push(attention);
    }

    if (decision.memoryWrite) {
      try {
        await createOrCorrectMemory({
          category: decision.memoryWrite.category,
          title: decision.memoryWrite.title,
          content: decision.memoryWrite.content,
          source:
            event?.connector === "github"
              ? "github"
              : event?.connector === "microsoft365"
                ? "microsoft365"
                : "chief_of_staff",
          confidence: decision.memoryWrite.confidence,
          importance: decision.memoryWrite.importance,
        });
        memoriesWritten += 1;
      } catch (error) {
        logger.warn("chief_of_staff_memory_write_failed", {
          eventId: decision.eventId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  if (attentionItems.length) {
    await upsertClassifiedItems(attentionItems);
  }

  return {
    attentionCards: attentionItems.length,
    memoriesWritten,
    byDisposition: DISPOSITION_COUNTS(decisions),
  };
}

function DISPOSITION_COUNTS(decisions: CosDecision[]) {
  const counts: Record<string, number> = {};
  for (const d of decisions) {
    counts[d.disposition] = (counts[d.disposition] || 0) + 1;
  }
  return counts;
}
