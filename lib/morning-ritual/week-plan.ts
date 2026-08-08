import OpenAI from "openai";
import { z } from "zod";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
} from "@/lib/ai/openai-errors";
import { getOpenAIApiKey, getOpenAIModel } from "@/lib/env";
import { fetchUrlText } from "@/lib/morning-ritual/fetch";
import { getWeekPlan, saveWeekPlan } from "@/lib/morning-ritual/store";
import type { CfmLesson, WeekMediaItem, WeekPlan } from "@/lib/morning-ritual/types";
import { logger } from "@/lib/logger";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const mediaSchema = z.object({
  type: z.enum(["talk", "video", "art", "help", "other"]),
  title: z.string(),
  url: z.string().optional(),
  note: z.string().optional(),
});

const planSchema = z.object({
  days: z
    .array(
      z.object({
        dayIndex: z.number().int().min(1).max(7),
        weekday: z.string(),
        scriptureFocus: z.string().min(1),
        media: z.array(mediaSchema).default([]),
      }),
    )
    .length(7),
  weekSupplemental: z.array(mediaSchema).default([]),
});

function mediaKey(item: WeekMediaItem): string {
  return `${item.type}:${(item.url || item.title).trim().toLowerCase()}`;
}

/** Enforce unique media titles/urls across the week; drop duplicates. */
export function enforceUniqueMedia(plan: WeekPlan): WeekPlan {
  const seen = new Set<string>();
  const days = plan.days.map((day) => {
    const media: WeekMediaItem[] = [];
    for (const item of day.media) {
      const key = mediaKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      media.push(item);
    }
    return { ...day, media };
  });
  const weekSupplemental: WeekMediaItem[] = [];
  for (const item of plan.weekSupplemental) {
    const key = mediaKey(item);
    if (seen.has(key) && !weekSupplemental.some((w) => mediaKey(w) === key)) {
      // keep in supplemental inventory even if also assigned a day
    }
    if (!weekSupplemental.some((w) => mediaKey(w) === key)) {
      weekSupplemental.push(item);
    }
  }
  // Rebuild supplemental from union of day media + declared supplemental (unique).
  const all = new Map<string, WeekMediaItem>();
  for (const item of [...plan.weekSupplemental, ...days.flatMap((d) => d.media)]) {
    all.set(mediaKey(item), item);
  }
  return {
    ...plan,
    days,
    weekSupplemental: Array.from(all.values()),
  };
}

/**
 * Heuristic split when LLM/fetch unavailable: partition scripture block by `;` / `,`
 * and assign one focus per day (recycling last chunk if needed). No fabricated media.
 */
export function buildHeuristicWeekPlan(lesson: CfmLesson, weekStart: string): WeekPlan {
  const parts = lesson.scriptureBlock
    .split(/;/)
    .map((s) => s.trim())
    .filter(Boolean);
  const foci =
    parts.length > 0
      ? parts
      : [lesson.scriptureBlock || "This week's Come, Follow Me reading"];

  const days = WEEKDAYS.map((weekday, i) => ({
    dayIndex: i + 1,
    weekday,
    scriptureFocus: foci[Math.min(i, foci.length - 1)]!,
    media: [] as WeekMediaItem[],
  }));

  return {
    lessonKey: lesson.lessonKey,
    lessonNumber: lesson.lessonNumber,
    scriptureBlock: lesson.scriptureBlock,
    url: lesson.url,
    weekStart,
    days,
    weekSupplemental: [],
  };
}

async function buildLlmWeekPlan(
  lesson: CfmLesson,
  weekStart: string,
  lessonText: string,
): Promise<WeekPlan | null> {
  if (isOpenAICreditsBlocked()) return null;
  const apiKey = getOpenAIApiKey();
  if (!apiKey) return null;

  try {
    const client = new OpenAI({ apiKey, timeout: 90_000 });
    const response = await client.responses.create({
      model: getOpenAIModel(),
      temperature: 0.3,
      max_output_tokens: 2500,
      instructions: `You build a 7-day Come, Follow Me home-study plan (Monday=Day1 … Sunday=Day7).

Rules:
- Partition the week's scripture into daily deep-dive foci (scriptureFocus). Prefer concrete passage ranges when the lesson text suggests them.
- Inventory talks, videos, art, and scripture helps from the lesson page text.
- Spread media across the week. Not every day needs media. Important supplements should appear sometime during the week.
- NEVER assign the same talk/video/art/help twice in the week (unique by title or URL).
- weekSupplemental = full inventory of supplemental resources for the week (for Day-1 listing).
- Return JSON only matching the schema.`,
      input: [
        {
          role: "user",
          content: JSON.stringify({
            lessonNumber: lesson.lessonNumber,
            scriptureBlock: lesson.scriptureBlock,
            url: lesson.url,
            weekStart,
            lessonPageText: lessonText.slice(0, 28_000),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cfm_week_plan",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              days: {
                type: "array",
                minItems: 7,
                maxItems: 7,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    dayIndex: { type: "integer" },
                    weekday: { type: "string" },
                    scriptureFocus: { type: "string" },
                    media: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          type: {
                            type: "string",
                            enum: ["talk", "video", "art", "help", "other"],
                          },
                          title: { type: "string" },
                          url: { type: "string" },
                          note: { type: "string" },
                        },
                        required: ["type", "title"],
                      },
                    },
                  },
                  required: ["dayIndex", "weekday", "scriptureFocus", "media"],
                },
              },
              weekSupplemental: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: {
                      type: "string",
                      enum: ["talk", "video", "art", "help", "other"],
                    },
                    title: { type: "string" },
                    url: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["type", "title"],
                },
              },
            },
            required: ["days", "weekSupplemental"],
          },
          strict: false,
        },
      },
    });

    const raw = response.output_text || "";
    const parsed = planSchema.parse(JSON.parse(raw));
    // Normalize dayIndex/weekday order Mon–Sun.
    const byIndex = new Map(parsed.days.map((d) => [d.dayIndex, d]));
    const days = WEEKDAYS.map((weekday, i) => {
      const dayIndex = i + 1;
      const existing = byIndex.get(dayIndex);
      return {
        dayIndex,
        weekday,
        scriptureFocus:
          existing?.scriptureFocus ||
          lesson.scriptureBlock ||
          "This week's reading",
        media: existing?.media || [],
      };
    });

    return enforceUniqueMedia({
      lessonKey: lesson.lessonKey,
      lessonNumber: lesson.lessonNumber,
      scriptureBlock: lesson.scriptureBlock,
      url: lesson.url,
      weekStart,
      days,
      weekSupplemental: parsed.weekSupplemental,
    });
  } catch (error) {
    if (isOpenAICreditsError(error)) markOpenAICreditsExhausted();
    logger.warn("morning_ritual_week_plan_llm_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getOrCreateWeekPlan(
  lesson: CfmLesson,
  weekStart: string,
): Promise<{ plan: WeekPlan; created: boolean; source: "cache" | "llm" | "heuristic" }> {
  const cached = await getWeekPlan(lesson.lessonKey, weekStart);
  if (cached?.days?.length === 7) {
    return { plan: cached, created: false, source: "cache" };
  }

  const fetched = lesson.url
    ? await fetchUrlText(lesson.url, { requireChurch: true, maxChars: 45_000 })
    : { ok: false as const, url: "", error: "No lesson URL" };

  if (fetched.ok && fetched.text) {
    const llmPlan = await buildLlmWeekPlan(lesson, weekStart, fetched.text);
    if (llmPlan) {
      await saveWeekPlan(llmPlan);
      return { plan: llmPlan, created: true, source: "llm" };
    }
  } else {
    logger.warn("morning_ritual_lesson_fetch_failed", {
      url: lesson.url,
      error: "error" in fetched ? fetched.error : "unknown",
    });
  }

  const heuristic = buildHeuristicWeekPlan(lesson, weekStart);
  await saveWeekPlan(heuristic);
  return { plan: heuristic, created: true, source: "heuristic" };
}
