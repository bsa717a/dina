import OpenAI from "openai";
import { z } from "zod";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
} from "@/lib/ai/openai-errors";
import { withTemperature } from "@/lib/ai/model-params";
import { recordOpenAIUsage } from "@/lib/ai/usage";
import { getOpenAIApiKey, getOpenAIResearchModel } from "@/lib/env";
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

function lessonPagePath(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function isLessonPageUrl(url: string | undefined, lessonUrl: string): boolean {
  const itemPath = lessonPagePath(url);
  const lessonPath = lessonPagePath(lessonUrl);
  if (!itemPath || !lessonPath) return false;
  return itemPath === lessonPath;
}

/** Strong art cues only — avoid weak words like "picture" flipping real study notes. */
const ART_SIGNAL = /\b(art by|painting|artwork)\b/i;
const CLERICAL =
  /\b(President|Elder|Sister|Bishop|Brother)\b/;
const TALK_URL =
  /\/(general-conference|teachings(?:-of-presidents)?|ensign|liahona|new-era|friend|broadcasts|magazines)\b/i;
const VIDEO_URL = /\/(media-library|media\/video|videos?)\b/i;
const MUSIC_URL = /\/music\b/i;

/**
 * Fix common CFM media mislabels (e.g. lesson-page art listed as a "talk").
 * Types must match the resource; lesson-page anchors alone are not talks/videos.
 */
export function sanitizeMediaItem(
  item: WeekMediaItem,
  lessonUrl: string,
): WeekMediaItem | null {
  const title = item.title.trim();
  if (!title) return null;
  const note = (item.note || "").trim();
  const blob = `${title}\n${note}`;
  let type = item.type;
  let cleanedNote = note;
  const hasTalkUrl = Boolean(item.url && TALK_URL.test(item.url));
  const hasVideoUrl = Boolean(item.url && VIDEO_URL.test(item.url));
  const onLessonPage = isLessonPageUrl(item.url, lessonUrl);
  const talkBy = /\btalk\s+by\b/i.test(blob);
  const clerical = CLERICAL.test(blob);
  const demotedFromTalkOrVideo = type === "talk" || type === "video";

  // Art wording must not override a real talk/video destination URL.
  if (
    ART_SIGNAL.test(blob) &&
    !hasTalkUrl &&
    !hasVideoUrl &&
    !(talkBy && clerical)
  ) {
    type = "art";
  }

  if ((type === "talk" || type === "video") && onLessonPage) {
    // Lesson-page anchors alone are never talks/videos.
    if (talkBy && clerical) {
      // e.g. "from a talk by President Nelson" — study note, not a painting.
      type = "other";
    } else if (ART_SIGNAL.test(blob)) {
      type = "art";
    } else if (MUSIC_URL.test(item.url || "") || /\bhymn\b/i.test(blob)) {
      type = "help";
    } else {
      // Includes LLM mislabels like "talk by Joseph Brickey" with no art cue.
      type = "other";
    }
  }

  if (type === "talk" && item.url && !hasTalkUrl) {
    if (hasVideoUrl) type = "video";
    else if (MUSIC_URL.test(item.url)) type = "help";
    else if (onLessonPage) type = "other";
  }

  let cleanedTitle = title;
  const scrubTalkish = (s: string, asArt: boolean) =>
    s
      .replace(/\binsightful\s+talk\b/gi, asArt ? "Artwork" : "Resource")
      .replace(/\btalk by\b/gi, asArt ? "art by" : "by")
      .replace(/\bwatch\b/gi, asArt ? "view" : "see")
      .trim();

  if (type === "art") {
    cleanedNote = scrubTalkish(cleanedNote, true);
    cleanedTitle = scrubTalkish(cleanedTitle, true);
    if (!cleanedNote && /\bby\s+[A-Z]/.test(cleanedTitle) === false) {
      const by = note.match(/\bby\s+([A-Z][\w .'-]+)/i);
      if (by) cleanedNote = `Art by ${by[1].trim()}`;
    }
  } else if (demotedFromTalkOrVideo && (type === "other" || type === "help")) {
    // Strip invented watch/talk claims after demoting lesson-page media.
    cleanedNote = scrubTalkish(cleanedNote, false);
    cleanedTitle = scrubTalkish(cleanedTitle, false);
  }

  return {
    type,
    title: cleanedTitle,
    url: item.url?.trim() || undefined,
    note: cleanedNote || undefined,
  };
}

export function sanitizeWeekPlanMedia(plan: WeekPlan): WeekPlan {
  const lessonUrl = plan.url;
  const days = plan.days.map((day) => ({
    ...day,
    media: day.media
      .map((m) => sanitizeMediaItem(m, lessonUrl))
      .filter((m): m is WeekMediaItem => Boolean(m)),
  }));
  const weekSupplemental = plan.weekSupplemental
    .map((m) => sanitizeMediaItem(m, lessonUrl))
    .filter((m): m is WeekMediaItem => Boolean(m));
  return { ...plan, days, weekSupplemental };
}

/** Enforce unique media titles/urls across the week; drop duplicates. */
export function enforceUniqueMedia(plan: WeekPlan): WeekPlan {
  const sanitized = sanitizeWeekPlanMedia(plan);
  const seen = new Set<string>();
  const days = sanitized.days.map((day) => {
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
  for (const item of sanitized.weekSupplemental) {
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
  for (const item of [...weekSupplemental, ...days.flatMap((d) => d.media)]) {
    all.set(mediaKey(item), item);
  }
  return {
    ...sanitized,
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
    source: "heuristic",
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
    const client = new OpenAI({ apiKey, timeout: 60_000 });
    const researchModel = getOpenAIResearchModel();
    const response = await client.responses.create({
      model: researchModel,
      ...withTemperature(researchModel, 0.3),
      max_output_tokens: 2500,
      instructions: `You build a 7-day Come, Follow Me home-study plan (Monday=Day1 … Sunday=Day7).

Rules:
- Partition the week's scripture into daily deep-dive foci (scriptureFocus). Prefer concrete passage ranges when the lesson text suggests them.
- Inventory talks, videos, art, and scripture helps from the lesson page text.
- Type media accurately:
  - "art" = paintings/illustrations (e.g. Joseph Brickey artwork). NEVER label art as a talk.
  - "talk" = General Conference / magazine / Teachings of Presidents talks with their own talk URL.
  - "video" = actual videos with a media/video URL.
  - "help" = hymns, scripture helps, study aids.
- Do NOT invent speakers, titles, or watch links. If the lesson only shows an image title + artist, type is "art".
- A Come, Follow Me lesson-page anchor (#p…) is NOT a talk URL. Prefer the real resource URL when present; otherwise type art/help/other as appropriate.
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

    recordOpenAIUsage({
      feature: "morning.week_plan",
      model: response.model || researchModel,
      response,
      meta: { lessonNumber: lesson.lessonNumber, weekStart },
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
      source: "llm",
    });
  } catch (error) {
    if (isOpenAICreditsError(error)) markOpenAICreditsExhausted();
    logger.warn("morning_ritual_week_plan_llm_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Legacy rows may lack `source`; treat rich media inventories as LLM-built. */
export function looksLikeLlmWeekPlan(plan: WeekPlan): boolean {
  if (plan.source === "llm") return true;
  if (plan.source === "heuristic") return false;
  return (
    plan.weekSupplemental.length > 0 ||
    plan.days.some((d) => d.media.length > 0)
  );
}

/** Durable cache: explicit LLM, or legacy rich plans. Never durable for heuristic. */
export function isDurableWeekPlan(plan: WeekPlan | null | undefined): boolean {
  return Boolean(plan?.days?.length === 7 && looksLikeLlmWeekPlan(plan));
}

export async function getOrCreateWeekPlan(
  lesson: CfmLesson,
  weekStart: string,
): Promise<{ plan: WeekPlan; created: boolean; source: "cache" | "llm" | "heuristic" }> {
  const cached = await getWeekPlan(lesson.lessonKey, weekStart);
  if (isDurableWeekPlan(cached)) {
    const cleaned = enforceUniqueMedia(
      cached!.source === "llm"
        ? cached!
        : { ...cached!, source: "llm" as const },
    );
    // Re-persist when sanitizer fixes mislabeled media (e.g. art as talk).
    if (JSON.stringify(cleaned) !== JSON.stringify(cached)) {
      await saveWeekPlan(cleaned);
      return { plan: cleaned, created: false, source: "cache" };
    }
    return { plan: cleaned, created: false, source: "cache" };
  }

  const fetched = lesson.url
    ? await fetchUrlText(lesson.url, {
        requireChurch: true,
        maxChars: 45_000,
        timeoutMs: 12_000,
      })
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

  // Prefer an existing full cached plan over a fresh heuristic on transient failure.
  if (cached?.days?.length === 7 && cached.source !== "heuristic") {
    const fallback =
      cached.source === "llm" || looksLikeLlmWeekPlan(cached)
        ? { ...cached, source: "llm" as const }
        : cached;
    if (fallback.source === "llm" && cached.source !== "llm") {
      await saveWeekPlan(fallback);
    }
    logger.warn("morning_ritual_week_plan_using_cached_fallback", {
      lessonKey: lesson.lessonKey,
      weekStart,
    });
    return { plan: fallback, created: false, source: "cache" };
  }

  // Do not persist heuristic plans — a transient outage must not lock the week.
  const heuristic = buildHeuristicWeekPlan(lesson, weekStart);
  return { plan: heuristic, created: true, source: "heuristic" };
}
