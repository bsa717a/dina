import OpenAI from "openai";
import { z } from "zod";
import { getOpenAIApiKey, getOpenAIModel } from "@/lib/env";
import type { ClassifiedAttention, CollectedSignal } from "@/lib/attention/types";
import { ATTENTION_CATEGORIES } from "@/lib/attention/types";
import { logger } from "@/lib/logger";

const classifiedSchema = z.object({
  items: z.array(
    z.object({
      sourceId: z.string(),
      category: z.enum(ATTENTION_CATEGORIES),
      summary: z.string(),
      whyItMatters: z.string(),
      recommendedAction: z.string(),
      askSummary: z.string().optional().nullable(),
      needsResponse: z.boolean(),
      hasDeadline: z.boolean(),
      deadlineAt: z.string().optional().nullable(),
      isBlocking: z.boolean(),
      canWait: z.boolean(),
      shouldDraftReply: z.boolean(),
      draftSubject: z.string().optional().nullable(),
      draftBody: z.string().optional().nullable(),
      notifyNow: z.boolean(),
      notificationTitle: z.string().optional().nullable(),
      notificationBody: z.string().optional().nullable(),
    }),
  ),
});

const SYSTEM = `You are Dina, Derek Fowler's chief of staff Attention Engine.
Classify Microsoft 365 signals into exactly one category:
- reply_required
- decision_required
- calendar_action
- waiting_on_someone
- fyi_ignore

Rules:
- Protect Derek's attention. Prefer fyi_ignore for newsletters, marketing, receipts, routine GitHub commits/noise, webinars, and low-value FYI.
- For GitHub signals, always preserve the account label (personal vs 4studentlives, etc.) in summary/whyItMatters/notificationTitle when relevant. Never imply all repos share one owner.
- Only set notifyNow=true when Derek should know now (blocked work, conflict, urgent human waiting, time-sensitive decision).
- For actionable items, answer: what is asked, whether Derek must respond, deadline, blocking, can wait, and whether a draft reply helps.
- For calendar / meeting invite items, always set deadlineAt to the event start from the signal, and mention the date/time in the summary.
- If shouldDraftReply=true, write a concise professional draftBody in Derek's voice (direct, warm, not chatty). Never claim the email was sent.
- notificationTitle/Body should be short push copy when notifyNow=true (e.g. "Urgent", "Meeting", "Gridley Unified").
- Return JSON only matching the schema. Include every input sourceId exactly once.`;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fallbackIgnore(signal: CollectedSignal): ClassifiedAttention {
  return {
    source: signal.source,
    sourceId: signal.sourceId,
    category: "fyi_ignore",
    sender: signal.sender,
    subject: signal.subject,
    summary: signal.preview.slice(0, 180) || "No summary available.",
    whyItMatters: "Could not classify confidently; treating as low priority.",
    recommendedAction: "No action needed unless Derek asks.",
    needsResponse: false,
    hasDeadline: false,
    isBlocking: false,
    canWait: true,
    shouldDraftReply: false,
    notifyNow: false,
  };
}

export async function classifyAttentionSignals(
  signals: CollectedSignal[],
): Promise<ClassifiedAttention[]> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!signals.length) return [];

  const client = new OpenAI({ apiKey, timeout: 90_000 });
  const model = getOpenAIModel();
  const classified: ClassifiedAttention[] = [];

  for (const batch of chunk(signals, 12)) {
    const payload = batch.map((signal) => ({
      source: signal.source,
      sourceId: signal.sourceId,
      sender: signal.sender,
      subject: signal.subject,
      receivedAt: signal.receivedAt,
      preview: signal.preview,
      raw: signal.raw,
    }));

    try {
      const response = await client.responses.create({
        model,
        instructions: SYSTEM,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Classify these Microsoft 365 attention signals for Derek.\n\n" +
                  JSON.stringify(payload),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "attention_classification",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "sourceId",
                      "category",
                      "summary",
                      "whyItMatters",
                      "recommendedAction",
                      "askSummary",
                      "needsResponse",
                      "hasDeadline",
                      "deadlineAt",
                      "isBlocking",
                      "canWait",
                      "shouldDraftReply",
                      "draftSubject",
                      "draftBody",
                      "notifyNow",
                      "notificationTitle",
                      "notificationBody",
                    ],
                    properties: {
                      sourceId: { type: "string" },
                      category: { type: "string", enum: [...ATTENTION_CATEGORIES] },
                      summary: { type: "string" },
                      whyItMatters: { type: "string" },
                      recommendedAction: { type: "string" },
                      askSummary: { type: ["string", "null"] },
                      needsResponse: { type: "boolean" },
                      hasDeadline: { type: "boolean" },
                      deadlineAt: { type: ["string", "null"] },
                      isBlocking: { type: "boolean" },
                      canWait: { type: "boolean" },
                      shouldDraftReply: { type: "boolean" },
                      draftSubject: { type: ["string", "null"] },
                      draftBody: { type: ["string", "null"] },
                      notifyNow: { type: "boolean" },
                      notificationTitle: { type: ["string", "null"] },
                      notificationBody: { type: ["string", "null"] },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const text = response.output_text || "{}";
      const parsed = classifiedSchema.parse(JSON.parse(text));
      const byId = new Map(batch.map((s) => [s.sourceId, s]));

      for (const item of parsed.items) {
        const signal = byId.get(item.sourceId);
        if (!signal) continue;
        const senderEmail =
          typeof signal.raw.fromAddress === "string"
            ? signal.raw.fromAddress
            : undefined;
        const isCalendar =
          signal.source === "calendar" || signal.source === "meeting_invite";
        const occursAt = isCalendar
          ? (typeof signal.raw.startDateTime === "string"
              ? signal.raw.startDateTime
              : signal.receivedAt) || null
          : typeof signal.raw.dueDateTime === "string"
            ? signal.raw.dueDateTime
            : item.deadlineAt || null;
        const occursEndAt = isCalendar
          ? (typeof signal.raw.endDateTime === "string"
              ? signal.raw.endDateTime
              : null)
          : null;
        classified.push({
          source: signal.source,
          sourceId: signal.sourceId,
          category: item.category,
          sender: signal.sender,
          senderEmail,
          subject: signal.subject,
          summary: item.summary,
          whyItMatters: item.whyItMatters,
          recommendedAction: item.recommendedAction,
          askSummary: item.askSummary || undefined,
          needsResponse: item.needsResponse,
          hasDeadline: item.hasDeadline || Boolean(occursAt && isCalendar),
          deadlineAt: occursAt || item.deadlineAt,
          occursAt,
          occursEndAt,
          githubAccountId:
            typeof signal.raw.accountId === "string"
              ? signal.raw.accountId
              : null,
          githubAccountLabel:
            typeof signal.raw.accountLabel === "string"
              ? signal.raw.accountLabel
              : null,
          githubRepoKey:
            typeof signal.raw.repoKey === "string" ? signal.raw.repoKey : null,
          isBlocking: item.isBlocking,
          canWait: item.canWait,
          shouldDraftReply: item.shouldDraftReply,
          draftSubject: item.draftSubject,
          draftBody: item.draftBody,
          notifyNow: item.notifyNow && item.category !== "fyi_ignore",
          notificationTitle: item.notificationTitle,
          notificationBody: item.notificationBody,
        });
        byId.delete(item.sourceId);
      }

      // Any missing IDs fall back to ignore.
      for (const leftover of byId.values()) {
        classified.push(fallbackIgnore(leftover));
      }
    } catch (error) {
      logger.error("attention_classify_batch_failed", {
        error: error instanceof Error ? error.message : "unknown",
        batchSize: batch.length,
      });
      for (const signal of batch) classified.push(fallbackIgnore(signal));
    }
  }

  return classified;
}
