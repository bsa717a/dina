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
import { retrieveRelevantMemories } from "@/lib/memory/retrieve";
import { buildVoicePack } from "@/lib/writing/voice";
import {
  WRITING_AUDIENCES,
  WRITING_MEDIUMS,
  type DraftRequest,
  type DraftResult,
  type WritingAudience,
  type WritingMedium,
} from "@/lib/writing/types";
import { logger } from "@/lib/logger";

const draftSchema = z.object({
  audience: z.enum(WRITING_AUDIENCES),
  subject: z.string().nullable(),
  body: z.string().min(1),
});

function inferAudience(request: DraftRequest): WritingAudience {
  if (request.audience) return request.audience;
  const blob = `${request.to || ""} ${request.purpose}`.toLowerCase();
  if (/\b(bishop|elder|church|quorum|ward)\b/.test(blob)) return "church";
  if (/\b(mom|dad|wife|family|kids?)\b/.test(blob)) return "family";
  if (/\b(district|customer|school|superintendent)\b/.test(blob)) {
    return "customer";
  }
  if (/\b(ceo|adam|executive|board|funding)\b/.test(blob)) return "executive";
  if (/\b(justin|breck|peer|teammate|engineer)\b/.test(blob)) return "peer";
  return "general";
}

async function recipientHint(to?: string): Promise<string | undefined> {
  if (!to?.trim()) return undefined;
  const people = await retrieveRelevantMemories(to, {
    limit: 4,
    categories: ["people", "learned_preferences"],
  });
  if (!people.length) return `Recipient: ${to.trim()}`;
  const lines = people.map((p) => `- ${p.title}: ${p.content}`);
  return [`Recipient: ${to.trim()}`, ...lines].join("\n");
}

export async function draftInDereksVoice(
  request: DraftRequest,
): Promise<DraftResult> {
  if (isOpenAICreditsBlocked()) {
    throw new Error(openAICreditsUserMessage());
  }
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error("OpenAI is not configured.");

  const medium: WritingMedium = WRITING_MEDIUMS.includes(request.medium)
    ? request.medium
    : "email";
  const audience = inferAudience(request);
  const hint = await recipientHint(request.to);
  const voice = await buildVoicePack({ recipientHint: hint });

  const mediumGuide =
    medium === "email"
      ? "Produce a subject line and email body. No signature block unless essential."
      : medium === "teams"
        ? "Produce a short Teams/chat message. subject must be null. No email greeting/sign-off."
        : "Produce a short GitHub review or decision note. subject may be null. No email greeting.";

  try {
    const client = new OpenAI({ apiKey, timeout: 60_000 });
    const model = getOpenAIModel();
    const response = await client.responses.create({
      model,
      ...withTemperature(model, 0.4),
      max_output_tokens: 1200,
      instructions: `${voice.instructions}

## Task
Draft for medium=${medium}, audience=${audience}.
${mediumGuide}
Return JSON only.`,
      input: [
        {
          role: "user",
          content: JSON.stringify({
            medium,
            audience,
            to: request.to || null,
            purpose: request.purpose,
            points: request.points || [],
            toneHint: request.toneHint || null,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "derek_voice_draft",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["audience", "subject", "body"],
            properties: {
              audience: { type: "string", enum: [...WRITING_AUDIENCES] },
              subject: { type: ["string", "null"] },
              body: { type: "string" },
            },
          },
        },
      },
    });

    recordOpenAIUsage({
      feature: "writing.draft",
      model: response.model || model,
      response,
      meta: { medium, audience },
    });

    const parsed = draftSchema.safeParse(
      JSON.parse(response.output_text || "{}"),
    );
    if (!parsed.success || !parsed.data.body.trim()) {
      throw new Error("Writing Assistant returned an invalid draft.");
    }

    return {
      medium,
      audience: parsed.data.audience,
      subject:
        medium === "email"
          ? parsed.data.subject?.trim() ||
            subjectFromPurpose(request.purpose)
          : parsed.data.subject?.trim() || null,
      body: parsed.data.body.trim(),
    };
  } catch (error) {
    if (isOpenAICreditsError(error)) markOpenAICreditsExhausted();
    logger.error("writing_assistant_draft_failed", {
      medium,
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error instanceof Error ? error : new Error("Draft failed.");
  }
}

function subjectFromPurpose(purpose: string): string {
  const cleaned = purpose.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 80) return cleaned;
  return `${cleaned.slice(0, 77).trim()}…`;
}
