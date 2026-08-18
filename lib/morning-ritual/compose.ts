import OpenAI from "openai";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
  openAICreditsUserMessage,
} from "@/lib/ai/openai-errors";
import { recordOpenAIUsage } from "@/lib/ai/usage";
import { withTemperature } from "@/lib/ai/model-params";
import { getOpenAIApiKey, getOpenAIResearchModel } from "@/lib/env";
import {
  dayIndexMon1,
  denverDateString,
  denverLongDate,
  denverSearchDateAnchor,
  denverWeekdayLong,
  mondayOfWeekContaining,
} from "@/lib/morning-ritual/dates";
import { gatherMarketResearch, type MarketResearch } from "@/lib/morning-ritual/markets";
import {
  formatNewsSection,
  gatherTopNews,
  upsertTopStoriesSection,
  type NewsResearch,
} from "@/lib/morning-ritual/news";
import {
  findBomReadingForDate,
  findCfmLessonForDate,
} from "@/lib/morning-ritual/schedules";
import type { AuthUser } from "@/lib/auth/types";
import type { MorningRitualContext, WeekPlan } from "@/lib/morning-ritual/types";
import { getOrCreateWeekPlan } from "@/lib/morning-ritual/week-plan";
import {
  DEFAULT_OWNER_SECTIONS,
  hasSection,
  wantsMarketResearch,
  wantsNewsResearch,
  type MorningBriefSectionId,
} from "@/lib/morning-ritual/sections";
import {
  formatTodaysWinContext,
  gatherTodaysWinContext,
} from "@/lib/morning-ritual/win-context";
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

function isGateContinuationLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true; // blank lines inside the gate block
  if (/^[-*+]\s+/.test(t)) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  return false;
}

/**
 * Drop a Validation Gate section: heading + following list/blank lines only.
 * Stops at the next heading or any non-list body line so BoM/CFM content is kept.
 */
export function stripValidationGateSection(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^##\s*Validation Gate\b/i.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (/^#{1,6}\s+\S/.test(line) || !isGateContinuationLine(line)) {
        skipping = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/^\n+/, "").trim();
}

function emptyMarkets(at: Date, error: string): MarketResearch {
  return {
    ok: false,
    dateAnchor: denverSearchDateAnchor(at),
    queries: [],
    notes: "",
    fetched: [],
    error,
  };
}

function emptyNews(at: Date, error: string): NewsResearch {
  return {
    ok: false,
    dateAnchor: denverSearchDateAnchor(at),
    windowStart: "",
    queries: [],
    articles: [],
    notes: "",
    error,
  };
}

export function buildSelectedStructure(
  sections: readonly MorningBriefSectionId[],
): string {
  const blocks: string[] = [
    "# Morning brief — {weekday}, {longDate}",
    "",
  ];
  if (hasSection(sections, "book_of_mormon")) {
    blocks.push(
      "## Book of Mormon",
      "Day N of Total — Reading. Include the Read link.",
      "",
    );
  }
  if (hasSection(sections, "come_follow_me")) {
    blocks.push(
      "## COME, FOLLOW ME — DEEP STUDY",
      "For TODAY's scriptureFocus only:",
      "- Passage heading",
      "- Summary",
      "- Deep Insight (substantive, not shallow)",
      "- Application (Personal / Leadership-Business / Adversity when natural)",
      "- Reflective Question",
      "",
      "If today has assigned media, include a short \"Today's media\" subsection with titles/links.",
      "If dayIndex===1, include the supplemental inventory section provided.",
      "If dayIndex>1, do NOT repeat the full week supplemental dump.",
      "Media types in the context are authoritative:",
      "- (art) = artwork/painting — say \"View\" / \"See\", never \"Watch\", never call it a talk.",
      "- (talk) = an actual talk — Read/Watch only if the URL is a real talk page.",
      "- (video) = video — Watch is OK.",
      "Never invent a talk title, speaker, or watch link that is not in the provided media list.",
      "",
    );
  }
  if (hasSection(sections, "market_brief")) {
    blocks.push("## Market brief (~150 words)", "");
  }
  if (hasSection(sections, "market_intelligence")) {
    blocks.push("## Business / Market Intelligence (bullets)", "");
  }
  if (hasSection(sections, "stock_movers")) {
    blocks.push("## Big Stock Movers", "");
  }
  if (hasSection(sections, "trader_edge")) {
    blocks.push("## Two Minute Trader Edge", "");
  }
  if (wantsMarketResearch(sections)) {
    blocks.push(
      "Market rules:",
      "- Levels are news-article-mediated (as of sources), not live ticks. Prefer fetched excerpts over vague memory.",
      "- Prefer wire desks / primary sources; skip Motley Fool/Zacks/Reddit style junk unless sentiment is the story.",
      "- Do not invent prints. If research failed, say so briefly and skip fabricated movers.",
      "- End market section with: Not financial advice.",
      "",
    );
  }
  if (hasSection(sections, "top_stories") || hasSection(sections, "st_george_news")) {
    blocks.push(
      "## Top stories / St. George",
      "Include the provided newsSection verbatim. Keep every markdown link exactly as given so titles stay clickable. Do not invent articles or URLs. Do not rewrite titles into unlinked text.",
      "",
    );
  }
  if (hasSection(sections, "todays_win")) {
    blocks.push(
      "## Today's Win",
      "Recommend one meaningful outcome — the thing that would make today count. Not a task list.",
      "- Ground it in todaysWinContext (open attention, remaining project work, durable commitments).",
      "- One sentence in this shape: Today's win is {outcome}.",
      "- Add one short line on why it matters when natural.",
      "- Do not invent a win from Come, Follow Me or markets.",
      "- If context is empty or unavailable, ask: What would make today a win?",
      "- Do not add Calendar, Waiting On, Needs Your Attention, or other CoS briefing sections.",
      "",
    );
  }
  if (hasSection(sections, "journal_prompt")) {
    blocks.push(
      "## Journal Prompt",
      hasSection(sections, "come_follow_me")
        ? "One prompt derived from today's CFM deep study."
        : "One thoughtful morning journal prompt. Do not invent a scripture lesson.",
      "",
    );
  }
  return blocks.join("\n").trim();
}

export async function generateMorningBriefMarkdown(input?: {
  at?: Date;
  sections?: MorningBriefSectionId[];
  user?: AuthUser | null;
}): Promise<{ ok: boolean; markdown: string; error?: string }> {
  const at = input?.at ?? new Date();
  if (input && Array.isArray(input.sections) && input.sections.length === 0) {
    return { ok: false, markdown: "", error: "No morning brief sections selected." };
  }
  const sections = input?.sections?.length
    ? input.sections
    : [...DEFAULT_OWNER_SECTIONS];
  const user = input?.user ?? null;
  const userName = user?.name || "Derek";
  const includeStGeorge = hasSection(sections, "st_george_news");
  const localOnly =
    includeStGeorge && !hasSection(sections, "top_stories");
  const newsOptions = { includeStGeorge, localOnly };

  const needCfm = hasSection(sections, "come_follow_me") || hasSection(sections, "book_of_mormon") || hasSection(sections, "journal_prompt");
  const needMarkets = wantsMarketResearch(sections);
  const needNews = wantsNewsResearch(sections);
  const needWin = hasSection(sections, "todays_win");

  const [ctx, marketsResult, winContext, newsResult] = await Promise.all([
    needCfm
      ? buildMorningRitualContext(at)
      : Promise.resolve({
          date: denverDateString(at),
          longDate: denverLongDate(at),
          weekday: denverWeekdayLong(at),
          cfm: null,
          bom: null,
          dayIndex: dayIndexMon1(denverDateString(at)),
          todayPlan: null,
          weekPlan: null,
          validationNotes: [],
        } satisfies MorningRitualContext),
    needMarkets
      ? gatherMarketResearch(at).catch((error): MarketResearch =>
          emptyMarkets(at, error instanceof Error ? error.message : String(error)),
        )
      : Promise.resolve(emptyMarkets(at, "skipped")),
    needWin
      ? gatherTodaysWinContext(user)
      : Promise.resolve({
          userName,
          attention: [],
          remainingTasks: [],
          commitments: [],
        }),
    needNews
      ? gatherTopNews(at, newsOptions).catch((error): NewsResearch =>
          emptyNews(at, error instanceof Error ? error.message : String(error)),
        )
      : Promise.resolve(emptyNews(at, "skipped")),
  ]);
  const markets = marketsResult;
  const newsSection = needNews ? formatNewsSection(newsResult, newsOptions) : "";

  if (isOpenAICreditsBlocked()) {
    return { ok: false, markdown: "", error: openAICreditsUserMessage() };
  }
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return { ok: false, markdown: "", error: "OpenAI is not configured." };
  }

  const marketBlock = !needMarkets
    ? "Markets not selected."
    : markets.ok
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
    // Budget: parallel prep ≤ ~85s + compose ≤ 90s ≪ chat maxDuration 300s.
    const client = new OpenAI({ apiKey, timeout: 90_000 });
    const researchModel = getOpenAIResearchModel();
    const response = await client.responses.create({
      model: researchModel,
      ...withTemperature(researchModel, 0.55),
      max_output_tokens: 4500,
      instructions: `You write ${userName}'s Morning Ritual brief. This is NOT the Chief of Staff Daily Briefing (no Waiting On / calendar / Needs Your Attention).

Output markdown with ONLY these selected sections (omit everything else) and a thoughtful, concise tone:

${buildSelectedStructure(sections)}

Do NOT include a Validation Gate section (or similar meta/debug bullets). Use schedule/context silently.
Write in a concise, confident, warm, direct voice. No corporate fluff.`,
      input: [
        {
          role: "user",
          content: JSON.stringify({
            longDate: ctx.longDate,
            weekday: ctx.weekday,
            dayIndex: ctx.dayIndex,
            cfm: ctx.cfm,
            bom: ctx.bom,
            todayPlan: ctx.todayPlan,
            supplementalSection: formatSupplemental(ctx.weekPlan, ctx.dayIndex),
            todaysWinContext: formatTodaysWinContext(winContext),
            newsSection,
            marketResearch: marketBlock,
            marketDateAnchor: markets.dateAnchor,
            marketQueries: markets.queries,
          }),
        },
      ],
    });

    recordOpenAIUsage({
      feature: "morning.compose",
      model: response.model || researchModel,
      response,
      meta: { weekday: ctx.weekday, dayIndex: ctx.dayIndex },
    });
    const markdown = (response.output_text || "").trim();
    if (!markdown) {
      return { ok: false, markdown: "", error: "Model returned empty morning brief." };
    }
    const cleaned = newsSection
      ? upsertTopStoriesSection(stripValidationGateSection(markdown), newsSection)
      : stripValidationGateSection(markdown);
    if (!cleaned) {
      return {
        ok: false,
        markdown: "",
        error: "Morning brief was empty after removing Validation Gate.",
      };
    }
    return { ok: true, markdown: cleaned };
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
