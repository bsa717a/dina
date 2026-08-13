import OpenAI from "openai";
import { z } from "zod";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
  openAICreditsUserMessage,
} from "@/lib/ai/openai-errors";
import { withTemperature } from "@/lib/ai/model-params";
import { recordOpenAIUsage } from "@/lib/ai/usage";
import { getOpenAIApiKey, getOpenAIModel } from "@/lib/env";
import { prisma } from "@/lib/db/client";
import {
  formatLessonsForPrompt,
  listActiveLessons,
} from "@/lib/learning/lessons";
import { getVoiceInstructionsForPrompt } from "@/lib/writing/voice";
import { logger } from "@/lib/logger";

const reviseSchema = z.object({
  draftSubject: z.string(),
  draftBody: z.string(),
  whyItMatters: z.string(),
  recommendedAction: z.string(),
  summary: z.string(),
});

export type ReviseAttentionResult = z.infer<typeof reviseSchema>;

type AttentionLike = {
  id: string;
  source: string;
  sourceId: string;
  category: string;
  sender: string | null;
  subject: string | null;
  summary: string;
  whyItMatters: string;
  recommendedAction: string;
  draftSubject: string | null;
  draftBody: string | null;
};

/**
 * Refine an attention draft/recommendation using Derek's edits + optional note.
 * Keeps the card open; does not re-run the full CoS scan.
 */
export async function reviseAttentionDraft(input: {
  item: AttentionLike;
  draftSubject: string;
  draftBody: string;
  note?: string;
}): Promise<ReviseAttentionResult> {
  if (isOpenAICreditsBlocked()) {
    throw new Error(openAICreditsUserMessage());
  }
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error("OpenAI is not configured.");

  const cos = await prisma.cosDecisionRecord.findUnique({
    where: { eventId: input.item.sourceId },
  });
  let eventContext = "";
  if (cos?.payloadJson) {
    try {
      const payload = JSON.parse(cos.payloadJson) as {
        event?: { title?: string; summary?: string; type?: string };
        decision?: { reasoningSummary?: string; recommendedAction?: string };
      };
      eventContext = JSON.stringify(
        {
          eventType: payload.event?.type,
          title: payload.event?.title,
          summary: payload.event?.summary,
          priorReasoning: payload.decision?.reasoningSummary,
          priorRecommendation: payload.decision?.recommendedAction,
        },
        null,
        2,
      );
    } catch {
      eventContext = "";
    }
  }

  const client = new OpenAI({ apiKey, timeout: 60_000 });
  const model = getOpenAIModel();
  const [lessonsBlock, voiceBlock] = await Promise.all([
    listActiveLessons().then(formatLessonsForPrompt),
    getVoiceInstructionsForPrompt(),
  ]);

  try {
    const response = await client.responses.create({
      model,
      ...withTemperature(model, 0.3),
      max_output_tokens: 1200,
      input: [
        {
          role: "system",
          content: `You help Derek refine Attention Engine drafts and recommendations.
He may have edited a draft or left notes about what he wants changed.
Improve the draft using the voice pack below. Keep it concise and actionable.
If this is a GitHub review note (not an email), write a short review/decision note — not an email greeting.
Return JSON only with: draftSubject, draftBody, whyItMatters, recommendedAction, summary.

${voiceBlock}${lessonsBlock ? `\n\n${lessonsBlock}` : ""}`,
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              source: input.item.source,
              category: input.item.category,
              sender: input.item.sender,
              subject: input.item.subject,
              currentSummary: input.item.summary,
              currentWhyItMatters: input.item.whyItMatters,
              currentRecommendedAction: input.item.recommendedAction,
              priorDraftSubject: input.item.draftSubject,
              priorDraftBody: input.item.draftBody,
              derekEditedSubject: input.draftSubject,
              derekEditedBody: input.draftBody,
              derekNote: input.note || null,
              eventContext: eventContext || null,
            },
            null,
            2,
          ),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "attention_revise",
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "draftSubject",
              "draftBody",
              "whyItMatters",
              "recommendedAction",
              "summary",
            ],
            properties: {
              draftSubject: { type: "string" },
              draftBody: { type: "string" },
              whyItMatters: { type: "string" },
              recommendedAction: { type: "string" },
              summary: { type: "string" },
            },
          },
          strict: true,
        },
      },
    });

    recordOpenAIUsage({
      feature: "attention.revise",
      model: response.model || model,
      response,
      meta: { itemId: input.item.id },
    });

    const text =
      response.output_text ||
      response.output
        ?.flatMap((item) =>
          item.type === "message"
            ? item.content
                .filter((c) => c.type === "output_text")
                .map((c) => c.text)
            : [],
        )
        .join("") ||
      "";

    const parsed = reviseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Error("AI revise returned invalid JSON.");
    }
    return parsed.data;
  } catch (error) {
    if (isOpenAICreditsError(error)) {
      markOpenAICreditsExhausted();
      throw new Error(openAICreditsUserMessage());
    }
    logger.error("attention_revise_failed", {
      itemId: input.item.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error instanceof Error ? error : new Error("AI revise failed.");
  }
}
