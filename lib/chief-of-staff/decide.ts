import OpenAI from "openai";
import { z } from "zod";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
} from "@/lib/ai/openai-errors";
import { recordOpenAIUsage } from "@/lib/ai/usage";
import { getOpenAIApiKey, getOpenAIModel } from "@/lib/env";
import {
  DISPOSITIONS,
  NORMALIZED_EVENT_TYPES,
  PRIORITIES,
  type CosDecision,
  type NormalizedEvent,
} from "@/lib/chief-of-staff/types";
import {
  formatLessonsForPrompt,
  listActiveLessons,
} from "@/lib/learning/lessons";
import { MEMORY_CATEGORIES } from "@/lib/memory/types";
import { getVoiceInstructionsForPrompt } from "@/lib/writing/voice";
import { logger } from "@/lib/logger";

const decisionSchema = z.object({
  decisions: z.array(
    z.object({
      eventId: z.string(),
      disposition: z.enum(DISPOSITIONS),
      priority: z.enum(PRIORITIES),
      confidence: z.number().min(0).max(1),
      reasoningSummary: z.string(),
      interruptWhy: z.string().nullable(),
      recommendedAction: z.string().nullable(),
      needsToKnow: z.boolean(),
      canWait: z.boolean(),
      relatedToProject: z.boolean(),
      projectKey: z.string().nullable(),
      someoneWaitingOnDerek: z.boolean(),
      derekWaitingOnSomeone: z.boolean(),
      canRecommendAction: z.boolean(),
      canDraft: z.boolean(),
      isContextOnly: z.boolean(),
      draftSubject: z.string().nullable(),
      draftBody: z.string().nullable(),
      notifyNow: z.boolean(),
      cardCategory: z
        .enum([
          "reply_required",
          "decision_required",
          "calendar_action",
          "waiting_on_someone",
          "fyi_ignore",
        ])
        .nullable(),
      cardSummary: z.string().nullable(),
      writeMemory: z.boolean(),
      memoryCategory: z.enum(MEMORY_CATEGORIES).nullable(),
      memoryTitle: z.string().nullable(),
      memoryContent: z.string().nullable(),
      memoryImportance: z.enum(PRIORITIES).nullable(),
      memoryConfidence: z.number().min(0).max(1).nullable(),
    }),
  ),
});

const SYSTEM = `You are Dina's Chief of Staff Engine — the central decision layer under the Dina Constitution.
You receive NORMALIZED events only. You must not care which vendor produced them.
Core questions: What should Derek know, and what should he do about it? Is this the highest-value use of his attention right now?
Protect attention. Prefer quiet when nothing deserves interruption. Truth over agreement when classifying importance.

For every event answer:
- Does Derek need to know?
- How urgent is it? (critical|high|normal|low)
- Can it wait?
- Related to an existing project?
- Is someone waiting on Derek?
- Is Derek waiting on someone else?
- Can Dina recommend a next action?
- Can Dina draft something?
- Should this simply become context?
- Does this deserve durable STRUCTURED MEMORY (not chat log)?

Every event gets EXACTLY one disposition:
- create_attention_card — interrupt-worthy; requires interruptWhy explaining why Dina interrupted
- add_to_todays_briefing — useful today, not interrupt now
- update_project_context — matters for a project Derek is running
- store_as_context — keep for short-term context, no interrupt
- ignore — noise (newsletters, marketing, receipts, routine CI success unless relevant)

Memory (writeMemory) is separate from disposition. Only set writeMemory=true for durable facts that will still help in six months:
- People roles (e.g. Adam is CEO of 4StudentLives) → people (automatic)
- Project identity (Beacon is an active project) → projects (automatic)
- Stable preferences / identity / health / family → preferences / communication_style / learned_preferences / etc. (stored pending Derek approval)
Do NOT write memory for temporary debugging, random brainstorming, credentials, or casual chatter.
When writeMemory=true, set memoryCategory, memoryTitle, memoryContent, memoryImportance, memoryConfidence (0-1; Confirmed≈1, High≈0.85, Medium≈0.6, Low≈0.35).

Rules:
- Protect attention from noise (newsletters, marketing, receipts, automated digests, CI success). Prefer ignore / store_as_context / briefing for those.
- Unread human email that asks a question, needs a decision/reply, or is from a real person Derek works with → create_attention_card. Set notifyNow=true when someone is waiting on Derek or the message is high/critical. Do not quietly bury reply-needed inbox mail in ignore.
- Calendar: accepted/upcoming meetings within the next 48 hours → at least add_to_todays_briefing (never ignore solely because already accepted). Meeting invitations not yet responded → create_attention_card. Two meetings at the same start time → create_attention_card (conflict) with notifyNow=true.
- notifyNow=true only with create_attention_card, and only when Derek should know now (human waiting, time-sensitive decision, meeting soon/conflict, security/outage, blocking failure).
- interruptWhy examples: "Justin replied and is waiting for your decision.", "A GitHub workflow failed after the latest Beacon commit.", "Adam invited you to a meeting that overlaps another commitment."
- If canDraft=true, write draftBody using the Writing Style / voice pack when provided. Never claim it was sent.
- When LEARNED PREFERENCES are provided, obey them (e.g. one recommended option instead of a list of five).
- Include every input eventId exactly once.
- Return JSON only.`;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fallbackIgnore(event: NormalizedEvent): CosDecision {
  return {
    eventId: event.eventId,
    eventType: event.type,
    connector: event.connector,
    disposition: "ignore",
    priority: "low",
    confidence: 0.2,
    reasoningSummary: "Could not classify confidently; ignoring for now.",
    notifyNow: false,
    analysis: {
      needsToKnow: false,
      urgency: "low",
      canWait: true,
      relatedToProject: false,
      someoneWaitingOnDerek: false,
      derekWaitingOnSomeone: false,
      canRecommendAction: false,
      canDraft: false,
      isContextOnly: true,
    },
  };
}

function toDecision(
  event: NormalizedEvent,
  item: z.infer<typeof decisionSchema>["decisions"][number],
): CosDecision {
  const disposition = item.disposition;
  const notifyNow =
    disposition === "create_attention_card" && Boolean(item.notifyNow);

  const card =
    disposition === "create_attention_card"
      ? {
          sender: event.actor,
          subject: event.title,
          summary: item.cardSummary || event.summary.slice(0, 280),
          whyItMatters:
            item.interruptWhy ||
            item.reasoningSummary ||
            "Dina believes this needs your attention.",
          category: item.cardCategory || "decision_required",
          occursAt:
            typeof event.payload?.startDateTime === "string"
              ? event.payload.startDateTime
              : event.type === "MeetingInvitation" ||
                  event.type === "CalendarChanged" ||
                  event.type === "ReminderDue"
                ? event.occurredAt
                : null,
          occursEndAt:
            typeof event.payload?.endDateTime === "string"
              ? event.payload.endDateTime
              : null,
          githubAccountId:
            typeof event.payload?.accountId === "string"
              ? event.payload.accountId
              : null,
          githubAccountLabel:
            typeof event.payload?.accountLabel === "string"
              ? event.payload.accountLabel
              : null,
          githubRepoKey:
            typeof event.payload?.repoKey === "string"
              ? event.payload.repoKey
              : null,
        }
      : undefined;

  const memoryWrite =
    item.writeMemory &&
    item.memoryCategory &&
    item.memoryTitle &&
    item.memoryContent
      ? {
          category: item.memoryCategory,
          title: item.memoryTitle,
          content: item.memoryContent,
          confidence: item.memoryConfidence ?? item.confidence,
          importance: item.memoryImportance || item.priority,
        }
      : null;

  return {
    eventId: event.eventId,
    eventType: event.type,
    connector: event.connector,
    disposition,
    priority: item.priority,
    confidence: item.confidence,
    reasoningSummary: item.reasoningSummary,
    interruptWhy: item.interruptWhy,
    recommendedAction: item.recommendedAction,
    analysis: {
      needsToKnow: item.needsToKnow,
      urgency: item.priority,
      canWait: item.canWait,
      relatedToProject: item.relatedToProject,
      projectKey: item.projectKey || event.projectHint || null,
      someoneWaitingOnDerek: item.someoneWaitingOnDerek,
      derekWaitingOnSomeone: item.derekWaitingOnSomeone,
      canRecommendAction: item.canRecommendAction,
      canDraft: item.canDraft,
      isContextOnly: item.isContextOnly,
    },
    draftSubject: item.draftSubject,
    draftBody: item.draftBody,
    notifyNow,
    memoryWrite,
    card,
  };
}

/** Pure decision step: normalized events in → decisions out. No vendor APIs. */
export async function decideOnEvents(
  events: NormalizedEvent[],
): Promise<CosDecision[]> {
  if (!events.length) return [];
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  if (isOpenAICreditsBlocked()) {
    logger.warn("chief_of_staff_decide_skipped_openai_credits");
    return events.map(fallbackIgnore);
  }

  const client = new OpenAI({ apiKey, timeout: 90_000 });
  const model = getOpenAIModel();
  const decisions: CosDecision[] = [];
  const [lessonsBlock, voiceBlock] = await Promise.all([
    listActiveLessons().then(formatLessonsForPrompt),
    getVoiceInstructionsForPrompt(),
  ]);
  const instructions = [SYSTEM, voiceBlock, lessonsBlock]
    .filter(Boolean)
    .join("\n\n");

  for (const batch of chunk(events, 12)) {
    const payload = batch.map((event) => ({
      eventId: event.eventId,
      type: event.type,
      occurredAt: event.occurredAt,
      title: event.title,
      summary: event.summary,
      actor: event.actor,
      projectHint: event.projectHint,
      // Provenance omitted from reasoning payload on purpose.
    }));

    try {
      const response = await client.responses.create({
        model,
        instructions,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Decide dispositions for these normalized events.\n\n" +
                  JSON.stringify(payload),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "chief_of_staff_decisions",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["decisions"],
              properties: {
                decisions: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "eventId",
                      "disposition",
                      "priority",
                      "confidence",
                      "reasoningSummary",
                      "interruptWhy",
                      "recommendedAction",
                      "needsToKnow",
                      "canWait",
                      "relatedToProject",
                      "projectKey",
                      "someoneWaitingOnDerek",
                      "derekWaitingOnSomeone",
                      "canRecommendAction",
                      "canDraft",
                      "isContextOnly",
                      "draftSubject",
                      "draftBody",
                      "notifyNow",
                      "cardCategory",
                      "cardSummary",
                      "writeMemory",
                      "memoryCategory",
                      "memoryTitle",
                      "memoryContent",
                      "memoryImportance",
                      "memoryConfidence",
                    ],
                    properties: {
                      eventId: { type: "string" },
                      disposition: {
                        type: "string",
                        enum: [...DISPOSITIONS],
                      },
                      priority: { type: "string", enum: [...PRIORITIES] },
                      confidence: { type: "number" },
                      reasoningSummary: { type: "string" },
                      interruptWhy: { type: ["string", "null"] },
                      recommendedAction: { type: ["string", "null"] },
                      needsToKnow: { type: "boolean" },
                      canWait: { type: "boolean" },
                      relatedToProject: { type: "boolean" },
                      projectKey: { type: ["string", "null"] },
                      someoneWaitingOnDerek: { type: "boolean" },
                      derekWaitingOnSomeone: { type: "boolean" },
                      canRecommendAction: { type: "boolean" },
                      canDraft: { type: "boolean" },
                      isContextOnly: { type: "boolean" },
                      draftSubject: { type: ["string", "null"] },
                      draftBody: { type: ["string", "null"] },
                      notifyNow: { type: "boolean" },
                      cardCategory: {
                        type: ["string", "null"],
                        enum: [
                          "reply_required",
                          "decision_required",
                          "calendar_action",
                          "waiting_on_someone",
                          "fyi_ignore",
                          null,
                        ],
                      },
                      cardSummary: { type: ["string", "null"] },
                      writeMemory: { type: "boolean" },
                      memoryCategory: {
                        type: ["string", "null"],
                        enum: [...MEMORY_CATEGORIES, null],
                      },
                      memoryTitle: { type: ["string", "null"] },
                      memoryContent: { type: ["string", "null"] },
                      memoryImportance: {
                        type: ["string", "null"],
                        enum: [...PRIORITIES, null],
                      },
                      memoryConfidence: { type: ["number", "null"] },
                    },
                  },
                },
              },
            },
          },
        },
      });

      recordOpenAIUsage({
        feature: "chief_of_staff.decide",
        model: response.model || model,
        response,
        meta: { batchSize: batch.length },
      });

      const text = response.output_text || "{}";
      const parsed = decisionSchema.parse(JSON.parse(text));
      const byId = new Map(batch.map((e) => [e.eventId, e]));

      for (const item of parsed.decisions) {
        const event = byId.get(item.eventId);
        if (!event) continue;
        decisions.push(toDecision(event, item));
        byId.delete(item.eventId);
      }
      for (const leftover of byId.values()) {
        decisions.push(fallbackIgnore(leftover));
      }
    } catch (error) {
      logger.error("chief_of_staff_decide_batch_failed", {
        error: error instanceof Error ? error.message : "unknown",
        batchSize: batch.length,
        eventTypes: [...NORMALIZED_EVENT_TYPES].slice(0, 3),
      });
      for (const event of batch) decisions.push(fallbackIgnore(event));
      if (isOpenAICreditsError(error)) {
        markOpenAICreditsExhausted();
        // Don't keep calling OpenAI for remaining batches.
        const decided = new Set(decisions.map((d) => d.eventId));
        for (const event of events) {
          if (!decided.has(event.eventId)) {
            decisions.push(fallbackIgnore(event));
          }
        }
        break;
      }
    }
  }

  return decisions;
}
