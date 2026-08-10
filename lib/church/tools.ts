import OpenAI from "openai";
import {
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
} from "@/lib/ai/openai-errors";
import { getOpenAIApiKey, getOpenAIResearchModel } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  fetchUrlText,
  isChurchUrl,
  isHttpUrl,
} from "@/lib/morning-ritual/fetch";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

type Handler = (args: Record<string, unknown>) => Promise<string>;

function extractUrls(node: unknown): string[] {
  const urls = new Set<string>();
  const walk = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      for (const m of value.matchAll(/https?:\/\/[^\s)"'\]]+/g)) {
        urls.add(m[0].replace(/[.,;]+$/, ""));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.url === "string") urls.add(obj.url);
      if (typeof obj.href === "string") urls.add(obj.href);
      for (const v of Object.values(obj)) walk(v);
    }
  };
  walk(node);
  return Array.from(urls).filter(isHttpUrl);
}

async function searchChurchSite(query: string): Promise<string> {
  const q = query.trim();
  if (!q) return fail(new Error("query is required."));

  const apiKey = getOpenAIApiKey();
  if (!apiKey) return fail(new Error("OpenAI is not configured."));

  try {
    const client = new OpenAI({ apiKey, timeout: 60_000 });
    const scoped = `site:churchofjesuschrist.org ${q}`;
    const response = await client.responses.create({
      model: getOpenAIResearchModel(),
      tools: [{ type: "web_search" } as unknown as OpenAI.Responses.Tool],
      tool_choice: "auto",
      max_output_tokens: 1200,
      instructions: `You search ONLY ChurchofJesusChrist.org for General Conference talks, Come Follow Me materials, scriptures, and official Church pages.

Rules:
- Use web_search with site:churchofjesuschrist.org queries.
- Return only real results from churchofjesuschrist.org.
- Never invent talk titles, speakers, people, or quotes.
- If nothing relevant is found, say so clearly.
- List the best source URLs you found (full https links).
- Brief note of what each URL appears to be (title/speaker if shown in results).`,
      input: [
        {
          role: "user",
          content: `Search now:\n${scoped}\n\nAlso try without site: if needed, but only keep churchofjesuschrist.org URLs.\nQuery intent: ${q}`,
        },
      ],
    });

    const notes = (response.output_text || "").trim();
    const candidateUrls = extractUrls(response.output)
      .filter(isChurchUrl)
      .slice(0, 5);

    const fetched = await Promise.all(
      candidateUrls.slice(0, 3).map(async (url) => {
        const result = await fetchUrlText(url, {
          requireChurch: true,
          maxChars: 12_000,
          timeoutMs: 15_000,
        });
        return {
          url: result.url,
          ok: result.ok,
          excerpt: result.ok ? result.text?.slice(0, 4000) : undefined,
          error: result.error,
        };
      }),
    );

    const pages = fetched.filter((f) => f.ok);
    if (!pages.length) {
      return fail(
        new Error(
          "No verified ChurchofJesusChrist.org page could be fetched for that query. Do not cite searchNotes alone.",
        ),
      );
    }

    return ok({
      query: q,
      searchNotes: notes,
      pages,
      citationRule:
        "Cite ONLY speakers/titles/quotes present in pages[].excerpt. searchNotes is discovery hints, not proof. Never invent a person or talk.",
    });
  } catch (error) {
    if (isOpenAICreditsError(error)) markOpenAICreditsExhausted();
    logger.warn("church_search_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(error);
  }
}

async function fetchChurchUrl(urlRaw: string): Promise<string> {
  const url = urlRaw.trim();
  if (!url) return fail(new Error("url is required."));
  if (!isChurchUrl(url)) {
    return fail(
      new Error("Only churchofjesuschrist.org URLs are allowed."),
    );
  }

  const result = await fetchUrlText(url, {
    requireChurch: true,
    maxChars: 40_000,
    timeoutMs: 20_000,
  });

  if (!result.ok) {
    return fail(new Error(result.error || `Fetch failed for ${url}`));
  }

  return ok({
    url: result.url,
    status: result.status,
    text: result.text,
    citationRule:
      "Cite only what appears in text. Do not invent speakers, talks, people, or quotes.",
  });
}

const handlers: Record<string, Handler> = {
  search_church_site: async (args) => {
    const query = typeof args.query === "string" ? args.query : "";
    return searchChurchSite(query);
  },
  fetch_church_url: async (args) => {
    const url = typeof args.url === "string" ? args.url : "";
    return fetchChurchUrl(url);
  },
};

export function listChurchToolNames() {
  return Object.keys(handlers);
}

export async function executeChurchTool(name: string, argsJson: string) {
  const handler = handlers[name];
  if (!handler) return fail(new Error(`Unknown church tool: ${name}`));
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }
  try {
    return await handler(args);
  } catch (error) {
    return fail(error);
  }
}
