import OpenAI from "openai";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
} from "@/lib/ai/openai-errors";
import { recordOpenAIUsage } from "@/lib/ai/usage";
import { getDefaultTimeZone, getOpenAIApiKey, getOpenAIResearchModel } from "@/lib/env";
import { denverSearchDateAnchor } from "@/lib/morning-ritual/dates";
import { isHttpUrl } from "@/lib/morning-ritual/fetch";
import { logger } from "@/lib/logger";

const LOCAL_ST_GEORGE =
  /\b(stgeorgeutah\.com|thespectrum\.com|stgnews|stgeorge\.com)\b/i;

const PREFERRED =
  /\b(apnews\.com|reuters\.com|bbc\.com|npr\.org|nytimes\.com|washingtonpost\.com|axios\.com|ksl\.com|deseret\.com|sltrib\.com)\b/i;

const DEPRIORITIZE =
  /\b(msn\.com|news\.yahoo\.com|dailymail\.co|clickhole|theonion\.com|buzzfeed\.com)\b/i;

export type NewsArticle = {
  title: string;
  source: string;
  url: string;
  blurb: string;
  when?: string;
  stGeorge: boolean;
};

export type NewsResearch = {
  ok: boolean;
  dateAnchor: string;
  windowStart: string;
  queries: string[];
  articles: NewsArticle[];
  notes: string;
  error?: string;
};

function denverDateTimeLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getDefaultTimeZone(),
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export type NewsGatherOptions = {
  includeStGeorge?: boolean;
  localOnly?: boolean;
};

export function buildNewsSearchQueries(
  at: Date = new Date(),
  options?: NewsGatherOptions,
): string[] {
  const anchor = denverSearchDateAnchor(at);
  const includeStGeorge = options?.includeStGeorge !== false;
  const localOnly = Boolean(options?.localOnly);
  if (localOnly) {
    return [
      `St. George Utah news last 12 hours ${anchor}`,
      `St. George Utah The Spectrum STGnews ${anchor}`,
    ];
  }
  const queries = [
    `top world and US news last 12 hours ${anchor}`,
    `overnight headlines United States ${anchor}`,
  ];
  if (includeStGeorge) {
    queries.push(`St. George Utah news last 12 hours ${anchor}`);
    queries.push(`St. George Utah The Spectrum STGnews ${anchor}`);
  }
  return queries;
}

export function isStGeorgeNewsUrl(url: string): boolean {
  return LOCAL_ST_GEORGE.test(url);
}

export function rankNewsUrl(url: string): number {
  if (DEPRIORITIZE.test(url)) return -10;
  if (LOCAL_ST_GEORGE.test(url)) return 15;
  if (PREFERRED.test(url)) return 10;
  return 0;
}

function extractUrlsFromOutput(output: unknown): string[] {
  const urls = new Set<string>();
  const walk = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      for (const m of node.matchAll(/https?:\/\/[^\s)"'\]]+/g)) {
        urls.add(m[0].replace(/[.,;]+$/, ""));
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.url === "string") urls.add(obj.url);
      if (typeof obj.href === "string") urls.add(obj.href);
      for (const v of Object.values(obj)) walk(v);
    }
  };
  walk(output);
  return Array.from(urls).filter(isHttpUrl);
}

function asArticle(raw: unknown): NewsArticle | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const source = typeof obj.source === "string" ? obj.source.trim() : "";
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  const blurb = typeof obj.blurb === "string" ? obj.blurb.trim() : "";
  const when = typeof obj.when === "string" ? obj.when.trim() : "";
  if (!title || !isHttpUrl(url)) return null;
  return {
    title,
    source: source || "News",
    url,
    blurb,
    when: when || undefined,
    stGeorge: Boolean(obj.stGeorge) || isStGeorgeNewsUrl(url),
  };
}

export function parseNewsArticlesJson(text: string): NewsArticle[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    const list =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { articles?: unknown }).articles)
        ? (parsed as { articles: unknown[] }).articles
        : [];
    return list.map(asArticle).filter((item): item is NewsArticle => Boolean(item));
  } catch {
    return [];
  }
}

export function selectNewsArticles(
  articles: NewsArticle[],
  options?: NewsGatherOptions,
): NewsArticle[] {
  const includeStGeorge = options?.includeStGeorge !== false;
  const localOnly = Boolean(options?.localOnly);
  const seen = new Set<string>();
  const unique = articles.filter((article) => {
    const key = article.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return rankNewsUrl(article.url) >= 0;
  });

  const local = unique.find((article) => article.stGeorge);
  const national = unique.filter((article) => !article.stGeorge);
  if (localOnly) return local ? [local] : [];

  const nationalCap = includeStGeorge ? 4 : 5;
  const picked = national.slice(0, nationalCap);
  if (includeStGeorge && local) picked.push(local);
  return picked.slice(0, 5);
}

function formatArticleLines(articles: NewsArticle[], startAt = 1): string[] {
  return articles.map((article, index) => {
    const local = article.stGeorge ? " · St. George" : "";
    const when = article.when ? ` · ${article.when}` : "";
    const blurb = article.blurb ? `\n   ${article.blurb}` : "";
    return `${startAt + index}. [${article.title}](${article.url}) — ${article.source}${local}${when}${blurb}`;
  });
}

export function formatNewsSection(
  research: NewsResearch,
  options?: NewsGatherOptions,
): string {
  const includeStGeorge = options?.includeStGeorge !== false;
  const localOnly = Boolean(options?.localOnly);
  if (localOnly) {
    const local = research.articles.find((article) => article.stGeorge);
    if (!research.ok || !local) {
      return `## St. George\n\nLocal news was unavailable${research.error ? ` (${research.error})` : ""}.`;
    }
    return `## St. George\n\n${formatArticleLines([local]).join("\n")}`;
  }

  const heading = "## Top stories (last 12 hours)";
  if (!research.ok || !research.articles.length) {
    return `${heading}\n\nNews research was unavailable${research.error ? ` (${research.error})` : ""}.`;
  }

  const national = research.articles.filter((article) => !article.stGeorge);
  const local = research.articles.find((article) => article.stGeorge);
  const lines = formatArticleLines(national);
  const blocks = [`${heading}\n\n${lines.join("\n")}`];
  if (includeStGeorge) {
    if (local) {
      blocks.push(`## St. George\n\n${formatArticleLines([local]).join("\n")}`);
    } else {
      blocks.push(
        "## St. George\n\nNo St. George story from the last 12 hours turned up in search.",
      );
    }
  }
  return blocks.join("\n\n");
}

function isNewsHeading(line: string): boolean {
  return /^##\s*(Top stories|News|Headlines|St\. George)\b/i.test(line);
}

function isContinuationLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^[-*+]\s+/.test(t)) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  return false;
}

export function stripTopStoriesSection(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (isNewsHeading(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (/^#{1,6}\s+\S/.test(line) && !isNewsHeading(line)) {
        skipping = false;
        out.push(line);
      } else if (!isContinuationLine(line)) {
        skipping = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function upsertTopStoriesSection(
  markdown: string,
  newsMarkdown: string,
): string {
  const body = stripTopStoriesSection(markdown);
  const section = newsMarkdown.trim();
  if (!section) return body;

  const lines = body.split("\n");
  const insertAt = lines.findIndex((line) =>
    /^##\s*(Today'?s Win|Journal Prompt)\b/i.test(line),
  );
  if (insertAt < 0) {
    return `${body}\n\n${section}`.trim();
  }
  const before = lines.slice(0, insertAt).join("\n").trimEnd();
  const after = lines.slice(insertAt).join("\n").trimStart();
  return `${before}\n\n${section}\n\n${after}`.trim();
}

/**
 * Date-anchored web_search for five recent stories, including one St. George, UT.
 */
export async function gatherTopNews(
  at: Date = new Date(),
  options?: NewsGatherOptions,
): Promise<NewsResearch> {
  const includeStGeorge = options?.includeStGeorge !== false;
  const localOnly = Boolean(options?.localOnly);
  const queries = buildNewsSearchQueries(at, { includeStGeorge, localOnly });
  const dateAnchor = denverSearchDateAnchor(at);
  const windowStart = denverDateTimeLabel(new Date(at.getTime() - 12 * 60 * 60 * 1000));

  if (isOpenAICreditsBlocked()) {
    return {
      ok: false,
      dateAnchor,
      windowStart,
      queries,
      articles: [],
      notes: "",
      error: "OpenAI credits blocked.",
    };
  }
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return {
      ok: false,
      dateAnchor,
      windowStart,
      queries,
      articles: [],
      notes: "",
      error: "OpenAI is not configured.",
    };
  }

  try {
    const client = new OpenAI({ apiKey, timeout: 75_000 });
    const response = await client.responses.create({
      model: getOpenAIResearchModel(),
      tools: [{ type: "web_search" } as unknown as OpenAI.Responses.Tool],
      tool_choice: "auto",
      max_output_tokens: 2200,
      instructions: `You research the last 12 hours of news for a personal morning brief (America/Denver).

Use web_search with the provided queries. Prefer stories published or updated in the last 12 hours (since ${windowStart}).
Prefer wire/quality desks: AP, Reuters, BBC, NPR, NYT, Washington Post, Axios.
${includeStGeorge ? "For the St. George item prefer The Spectrum (thespectrum.com) or St. George News (stgeorgeutah.com). KSL / Deseret local coverage is OK if those are all that exist." : "Do not include St. George or other local-Utah filler unless it is national news."}
Skip MSN/Yahoo aggregators, Daily Mail, and junk slideshows.

Return ONLY a JSON object:
{
  "articles": [
    {
      "title": "exact headline",
      "source": "outlet name",
      "url": "https://full-article-url",
      "when": "optional published time if shown",
      "blurb": "one sentence",
      "stGeorge": false
    }
  ]
}

Rules:
${localOnly ? "- Return exactly 1 St. George, Utah article with stGeorge=true." : includeStGeorge ? "- Exactly 5 articles if possible.\n- Exactly one article MUST be St. George, Utah news with stGeorge=true and a real local URL.\n- The other four are the most important US/world stories from the last 12 hours.\n- If you cannot find a St. George story from the last 12 hours, return 4 national stories and omit stGeorge=true." : "- Exactly 5 US/world stories from the last 12 hours. Do not set stGeorge=true."}
- Every url must be a real https link from search results — never invent a URL, title, or story.
- Do not include market-tape recap pieces unless they are major news.`,
      input: [
        {
          role: "user",
          content: `Now (America/Denver): ${denverDateTimeLabel(at)}\nLast-12-hours window starts: ${windowStart}\nDate anchor: ${dateAnchor}\nRun these searches:\n${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nReturn the JSON now.`,
        },
      ],
    });

    recordOpenAIUsage({
      feature: "morning.news",
      model: response.model || getOpenAIResearchModel(),
      response,
      meta: { dateAnchor, queryCount: queries.length },
    });

    const notes = (response.output_text || "").trim();
    const parsed = parseNewsArticlesJson(notes);
    const searchUrls = extractUrlsFromOutput(response.output)
      .sort((a, b) => rankNewsUrl(b) - rankNewsUrl(a))
      .filter((url) => rankNewsUrl(url) >= 0);

    const extras: NewsArticle[] = searchUrls
      .filter((url) => !parsed.some((article) => article.url === url))
      .map((url) => ({
        title: url,
        source: isStGeorgeNewsUrl(url) ? "St. George" : "News",
        url,
        blurb: "",
        stGeorge: isStGeorgeNewsUrl(url),
      }));

    const articles = selectNewsArticles([...parsed, ...extras], {
      includeStGeorge,
      localOnly,
    });
    if (!articles.length) {
      return {
        ok: false,
        dateAnchor,
        windowStart,
        queries,
        articles: [],
        notes,
        error: "News search returned no usable articles.",
      };
    }

    return { ok: true, dateAnchor, windowStart, queries, articles, notes };
  } catch (error) {
    if (isOpenAICreditsError(error)) markOpenAICreditsExhausted();
    logger.warn("morning_ritual_news_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      dateAnchor,
      windowStart,
      queries,
      articles: [],
      notes: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
