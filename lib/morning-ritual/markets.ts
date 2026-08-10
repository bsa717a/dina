import OpenAI from "openai";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
} from "@/lib/ai/openai-errors";
import { recordOpenAIUsage } from "@/lib/ai/usage";
import { getOpenAIApiKey, getOpenAIResearchModel } from "@/lib/env";
import { denverSearchDateAnchor } from "@/lib/morning-ritual/dates";
import { fetchUrlText, isHttpUrl } from "@/lib/morning-ritual/fetch";
import { logger } from "@/lib/logger";

const PREFERRED =
  /\b(reuters|bloomberg|cnbc|barron'?s|marketwatch|investing\.com|federalreserve\.gov|bls\.gov|bea\.gov|eia\.gov|cboe\.com|sec\.gov)\b/i;

const DEPRIORITIZE =
  /\b(motley\s*fool|zacks\.com|reddit\.com|stocktwits|fool\.com|seekingalpha\.com\/symbol)\b/i;

export function buildMarketSearchQueries(at: Date = new Date()): string[] {
  const anchor = denverSearchDateAnchor(at);
  return [
    `US stock market premarket futures overnight ${anchor}`,
    `biggest stock movers S&P Nasdaq ${anchor}`,
    `oil WTI Treasury yields VIX markets ${anchor}`,
  ];
}

export function rankMarketUrl(url: string): number {
  if (DEPRIORITIZE.test(url)) return -10;
  if (PREFERRED.test(url)) return 10;
  if (/\b(yahoo\.com|wsj\.com|ft\.com|apnews\.com)\b/i.test(url)) return 6;
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

export type MarketResearch = {
  ok: boolean;
  dateAnchor: string;
  queries: string[];
  notes: string;
  fetched: { url: string; ok: boolean; excerpt?: string; error?: string }[];
  error?: string;
};

/**
 * Date-anchored web_search via OpenAI hosted tool, then selective web_fetch
 * of preferred result URLs for concrete levels.
 */
export async function gatherMarketResearch(
  at: Date = new Date(),
): Promise<MarketResearch> {
  const queries = buildMarketSearchQueries(at);
  const dateAnchor = denverSearchDateAnchor(at);

  if (isOpenAICreditsBlocked()) {
    return {
      ok: false,
      dateAnchor,
      queries,
      notes: "",
      fetched: [],
      error: "OpenAI credits blocked.",
    };
  }
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return {
      ok: false,
      dateAnchor,
      queries,
      notes: "",
      fetched: [],
      error: "OpenAI is not configured.",
    };
  }

  try {
    // Keep under chat maxDuration with parallel week-plan + compose headroom.
    const client = new OpenAI({ apiKey, timeout: 75_000 });
    const response = await client.responses.create({
      model: getOpenAIResearchModel(),
      // Hosted web search (Responses API). SDK typings may lag the API.
      tools: [{ type: "web_search" } as unknown as OpenAI.Responses.Tool],
      tool_choice: "auto",
      max_output_tokens: 2000,
      instructions: `You are researching markets for Derek's personal morning brief.

Use web_search with the provided date-anchored queries (include the exact date in queries).
Prefer wire/market desks when they appear: Reuters, Bloomberg, CNBC, Barron's, MarketWatch, Investing.com.
Prefer primary sources for important prints: federalreserve.gov, BLS, BEA, EIA, SEC, company IR.
Deprioritize Motley Fool, Zacks promo pages, Reddit, StockTwits unless sentiment itself is the story.
Return a concise research digest with:
- Overnight / premarket tape (indices, futures, oil, yields) with levels AS REPORTED (news-mediated, not live ticks)
- Biggest movers with % when sources give them
- 3–5 intelligence bullets
- Optional vol/positioning note (flag if secondhand flow commentary)
- List of best source URLs you used
Do not invent numbers. If uncertain, say so.`,
      input: [
        {
          role: "user",
          content: `Date anchor (America/Denver): ${dateAnchor}\nRun these searches (or equivalent with the same date):\n${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nProduce the research digest now.`,
        },
      ],
    });

    recordOpenAIUsage({
      feature: "morning.markets",
      model: response.model || getOpenAIResearchModel(),
      response,
      meta: { dateAnchor, queryCount: queries.length },
    });
    const notes = (response.output_text || "").trim();
    const urls = extractUrlsFromOutput(response.output)
      .sort((a, b) => rankMarketUrl(b) - rankMarketUrl(a))
      .filter((u) => rankMarketUrl(u) >= 0)
      .slice(0, 4);

    const fetched: MarketResearch["fetched"] = await Promise.all(
      urls.slice(0, 2).map(async (url) => {
        const result = await fetchUrlText(url, {
          maxChars: 8_000,
          timeoutMs: 10_000,
        });
        return {
          url,
          ok: result.ok,
          excerpt: result.text?.slice(0, 2500),
          error: result.error,
        };
      }),
    );

    if (!notes && fetched.every((f) => !f.ok)) {
      return {
        ok: false,
        dateAnchor,
        queries,
        notes: "",
        fetched,
        error: "Market search returned no usable content.",
      };
    }

    return { ok: true, dateAnchor, queries, notes, fetched };
  } catch (error) {
    if (isOpenAICreditsError(error)) markOpenAICreditsExhausted();
    logger.warn("morning_ritual_markets_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      dateAnchor,
      queries,
      notes: "",
      fetched: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
