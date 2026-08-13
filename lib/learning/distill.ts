import OpenAI from "openai";
import { z } from "zod";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
} from "@/lib/ai/openai-errors";
import { withTemperature } from "@/lib/ai/model-params";
import { recordOpenAIUsage } from "@/lib/ai/usage";
import { getOpenAIApiKey, getOpenAIModel } from "@/lib/env";
import { heuristicLessonFromSignal } from "@/lib/learning/heuristics";
import { persistLesson } from "@/lib/learning/lessons";
import type { LearningSignal, LessonCandidate } from "@/lib/learning/types";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logger";

const distillSchema = z.object({
  hasLesson: z.boolean(),
  category: z.enum(["learned_preferences", "decisions"]).nullable(),
  title: z.string().nullable(),
  content: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  explicitFromDerek: z.boolean(),
});

/**
 * Distill a durable lesson from an attention feedback signal.
 * Prefers heuristics; uses the model when there is a revise note or draft edit.
 */
export async function distillLessonFromSignal(
  signal: LearningSignal,
): Promise<LessonCandidate | null> {
  const heuristic = heuristicLessonFromSignal(signal);
  if (heuristic) return heuristic;

  const shouldAskModel =
    (signal.action === "revise_draft" && Boolean(signal.note?.trim())) ||
    (signal.action === "edited_draft" &&
      Boolean(signal.draftBody?.trim()) &&
      Boolean(signal.priorDraftBody?.trim()) &&
      signal.draftBody!.trim() !== signal.priorDraftBody!.trim());

  if (!shouldAskModel) return null;
  return distillWithModel(signal);
}

async function distillWithModel(
  signal: LearningSignal,
): Promise<LessonCandidate | null> {
  if (isOpenAICreditsBlocked()) return null;
  const apiKey = getOpenAIApiKey();
  if (!apiKey) return null;

  try {
    const client = new OpenAI({ apiKey, timeout: 45_000 });
    const model = getOpenAIModel();
    const response = await client.responses.create({
      model,
      ...withTemperature(model, 0.2),
      max_output_tokens: 500,
      instructions: `You are Dina's Learning Engine. Decide if Derek's feedback implies a DURABLE preference or decision lesson useful in six months.
Do NOT invent lessons for one-off factual edits, typos, or thread-specific details.
Do NOT store credentials.
If hasLesson=true, write an imperative lesson Derek would recognize later (e.g. "Prefer one recommended option instead of listing five.").
explicitFromDerek=true when Derek stated the preference in a note; false when inferred only from an edit.
Return JSON only.`,
      input: [
        {
          role: "user",
          content: JSON.stringify(signal),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "learning_distill",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "hasLesson",
              "category",
              "title",
              "content",
              "confidence",
              "explicitFromDerek",
            ],
            properties: {
              hasLesson: { type: "boolean" },
              category: {
                type: ["string", "null"],
                enum: ["learned_preferences", "decisions", null],
              },
              title: { type: ["string", "null"] },
              content: { type: ["string", "null"] },
              confidence: { type: ["number", "null"] },
              explicitFromDerek: { type: "boolean" },
            },
          },
        },
      },
    });

    recordOpenAIUsage({
      feature: "learning.distill",
      model: response.model || model,
      response,
      meta: { action: signal.action },
    });

    const text = response.output_text || "";
    const parsed = distillSchema.safeParse(JSON.parse(text));
    if (!parsed.success || !parsed.data.hasLesson) return null;
    if (!parsed.data.category || !parsed.data.title || !parsed.data.content) {
      return null;
    }
    return {
      category: parsed.data.category,
      title: parsed.data.title.trim(),
      content: parsed.data.content.trim(),
      confidence: parsed.data.confidence ?? 0.7,
      source: parsed.data.explicitFromDerek
        ? "derek_feedback"
        : "learning_engine",
    };
  } catch (error) {
    if (isOpenAICreditsError(error)) markOpenAICreditsExhausted();
    logger.warn("learning_engine_model_distill_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function learnFromAttentionAction(input: {
  attentionItemId: string;
  action: LearningSignal["action"];
  details?: Record<string, unknown> | null;
}): Promise<{ lessonId?: string; title?: string } | null> {
  const item = await prisma.attentionItem.findUnique({
    where: { id: input.attentionItemId },
  });
  if (!item) return null;

  const details = input.details || {};
  const note =
    typeof details.note === "string"
      ? details.note
      : typeof details.reviseNote === "string"
        ? details.reviseNote
        : null;

  const signal: LearningSignal = {
    action: input.action,
    note,
    priorRecommendedAction: item.recommendedAction,
    priorDraftBody:
      typeof details.priorDraftBody === "string"
        ? details.priorDraftBody
        : item.draftBody,
    draftSubject:
      typeof details.draftSubject === "string"
        ? details.draftSubject
        : item.draftSubject,
    draftBody:
      typeof details.draftBody === "string"
        ? details.draftBody
        : typeof details.revised === "object" &&
            details.revised &&
            typeof (details.revised as { draftBody?: unknown }).draftBody ===
              "string"
          ? (details.revised as { draftBody: string }).draftBody
          : item.draftBody,
    itemSummary: item.summary,
    itemCategory: item.category,
    subject: item.subject,
  };

  const lesson = await distillLessonFromSignal(signal);
  if (!lesson) return null;
  const saved = await persistLesson(lesson);
  if (!saved) return null;
  return { lessonId: saved.id, title: saved.title };
}

/** Fire-and-forget wrapper for API routes. */
export function scheduleLearnFromAttentionAction(input: {
  attentionItemId: string;
  action: LearningSignal["action"];
  details?: Record<string, unknown> | null;
}) {
  void learnFromAttentionAction(input).catch((error) => {
    logger.warn("learning_engine_schedule_failed", {
      action: input.action,
      error: error instanceof Error ? error.message : "unknown",
    });
  });
}
