import OpenAI from "openai";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
  openAICreditsUserMessage,
} from "@/lib/ai/openai-errors";
import { getOpenAIApiKey, getOpenAIModel } from "@/lib/env";
import {
  dayIndexMon1,
  denverDateString,
  denverLongDate,
  denverWeekdayLong,
  mondayOfWeekContaining,
} from "@/lib/morning-ritual/dates";
import { gatherMarketResearch, type MarketResearch } from "@/lib/morning-ritual/markets";
import {
  findBomReadingForDate,
  findCfmLessonForDate,
} from "@/lib/morning-ritual/schedules";
import type { MorningRitualContext, WeekPlan } from "@/lib/morning-ritual/types";
import { getOrCreateWeekPlan } from "@/lib/morning-ritual/week-plan";
import { logger } from "@/lib/logger";

export async function buildMorningRitualContext(
  at: Date = new Date(),
): Promise<MorningRitualContext> {
  const date = denverDateString(at);
  const longDate = denverLongDate(at);
  const weekday = denverWeekdayLong(at);
  const cfm = findCfmLessonForDate(date);
  const bom = findBomReadingForDate(date);
  const dayIndex = dayIndexMon1(date);
  const validationNotes: string[] = [];

  let weekPlan: WeekPlan | null = null;
  let todayPlan = null;

  if (cfm) {
    const weekStart = mondayOfWeekContaining(date);
    validationNotes.push(
      `CFM Lesson ${Number(cfm.lessonNumber)} — ${cfm.start} to ${cfm.end}: ${cfm.scriptureBlock}. Verified against schedule + official lesson URL.`,
    );
    validationNotes.push(`Today = Day ${dayIndex} of the lesson week (Monday=Day 1).`);
    try {
      const result = await getOrCreateWeekPlan(cfm, weekStart);
      weekPlan = result.plan;
      todayPlan = result.plan.days.find((d) => d.dayIndex === dayIndex) || null;
      validationNotes.push(`Week plan source: ${result.source}.`);
    } catch (error) {
      validationNotes.push(
        `Week plan unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    validationNotes.push("No Come, Follow Me lesson found for today's date in the 2026 schedule.");
  }

  if (bom) {
    validationNotes.push(
      `Book of Mormon — Day ${bom.day} of ${bom.totalDays} — ${bom.reading}.`,
    );
  } else {
    validationNotes.push("No Book of Mormon reading scheduled for today's date.");
  }

  return {
    date,
    longDate,
    weekday,
    cfm,
    bom,
    dayIndex,
    todayPlan,
    weekPlan,
    validationNotes,
  };
}

function formatSupplemental(plan: WeekPlan | null, dayIndex: number): string {
  if (!plan) return "";
  if (dayIndex === 1 && plan.weekSupplemental.length) {
    const lines = plan.weekSupplemental.map((m) => {
      const link = m.url ? ` — ${m.url}` : "";
      return `- (${m.type}) ${m.title}${link}`;
    });
    return `\n📚 Supplemental Resources (Lesson ${Number(plan.lessonNumber)}, Week inventory — Day 1 only)\n\n${lines.join("\n")}\n`;
  }
  if (plan && dayIndex > 1) {
    return "\n(Supplemental resource dump suppressed after Day 1; today's assigned media is in the deep study section if any.)\n";
  }
  return "";
}

export async function generateMorningBriefMarkdown(
  at: Date = new Date(),
): Promise<{ ok: boolean; markdown: string; error?: string }> {
  const ctx = await buildMorningRitualContext(at);
  let markets: MarketResearch;
  try {
    markets = await gatherMarketResearch(at);
  } catch (error) {
    markets = {
      ok: false,
      dateAnchor: ctx.longDate,
      queries: [],
      notes: "",
      fetched: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (isOpenAICreditsBlocked()) {
    return { ok: false, markdown: "", error: openAICreditsUserMessage() };
  }
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return { ok: false, markdown: "", error: "OpenAI is not configured." };
  }

  const marketBlock = markets.ok
    ? [
        markets.notes,
        "",
        "Fetched article excerpts (prefer these for levels):",
        ...markets.fetched.map((f) =>
          f.ok
            ? `URL: ${f.url}\n${f.excerpt || ""}`
            : `URL: ${f.url} (fetch failed: ${f.error})`,
        ),
      ].join("\n")
    : `Market research failed: ${markets.error || "unknown"}. Soft-degrade: omit invented numbers; say research was unavailable.`;

  try {
    const client = new OpenAI({ apiKey, timeout: 180_000 });
    const response = await client.responses.create({
      model: getOpenAIModel(),
      temperature: 0.55,
      max_output_tokens: 4500,
      instructions: `You write Derek's Morning Ritual brief (personal spiritual + markets packet). This is NOT the Chief of Staff Daily Briefing (no Today's Win / Waiting On / calendar).

Output markdown with this structure and tone (match quality of a thoughtful study journal + desk note):

# Morning brief — {weekday}, {longDate}

## Validation Gate
(short bullets from provided validation notes; mention official CFM URL)

## Book of Mormon
Day N of Total — Reading. Include the Read link.

## COME, FOLLOW ME — DEEP STUDY
For TODAY's scriptureFocus only:
- Passage heading
- Summary
- Deep Insight (substantive, not shallow)
- Application (Personal / Leadership-Business / Adversity when natural)
- Reflective Question

If today has assigned media, include a short "Today's media" subsection with titles/links.
If dayIndex===1, include the supplemental inventory section provided.
If dayIndex>1, do NOT repeat the full week supplemental dump.

## Market brief (~150 words)
Then:
## Business / Market Intelligence (bullets)
## Big Stock Movers
## Two Minute Trader Edge

Market rules:
- Levels are news-article-mediated (as of sources), not live ticks. Prefer fetched excerpts over vague memory.
- Prefer wire desks / primary sources; skip Motley Fool/Zacks/Reddit style junk unless sentiment is the story.
- Do not invent prints. If research failed, say so briefly and skip fabricated movers.
- End market section with: Not financial advice.

## Journal Prompt
One prompt derived from today's CFM deep study.

Write in Derek's voice: concise, confident, warm, direct. No corporate fluff.`,
      input: [
        {
          role: "user",
          content: JSON.stringify({
            longDate: ctx.longDate,
            weekday: ctx.weekday,
            dayIndex: ctx.dayIndex,
            validationNotes: ctx.validationNotes,
            cfm: ctx.cfm,
            bom: ctx.bom,
            todayPlan: ctx.todayPlan,
            supplementalSection: formatSupplemental(ctx.weekPlan, ctx.dayIndex),
            marketResearch: marketBlock,
            marketDateAnchor: markets.dateAnchor,
            marketQueries: markets.queries,
          }),
        },
      ],
    });

    const markdown = (response.output_text || "").trim();
    if (!markdown) {
      return { ok: false, markdown: "", error: "Model returned empty morning brief." };
    }
    return { ok: true, markdown };
  } catch (error) {
    if (isOpenAICreditsError(error)) markOpenAICreditsExhausted();
    logger.error("morning_ritual_compose_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      markdown: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
