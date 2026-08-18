import type OpenAI from "openai";

type FunctionTool = OpenAI.Responses.FunctionTool;

function fn(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): FunctionTool {
  return {
    type: "function",
    name,
    description,
    parameters: {
      type: "object",
      additionalProperties: false,
      ...parameters,
    },
    strict: false,
  };
}

export function getMorningRitualToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "generate_morning_brief",
      "Generate or set up the user's Morning Ritual brief. Call this and pass userText. Members without saved sections get a numbered picker in data.markdown — that list must be shown verbatim. “Morning brief setup” also returns the picker. After they pick numbers, call again with userText. When they already have a saved brief and ask for Morning brief, generate it. Do not set setup=true unless they said Morning brief setup. This is NOT the CoS Daily Briefing. Present returned markdown as-is.",
      {
        properties: {
          userText: {
            type: "string",
            description: "The user's latest message (required for setup picks like '1, 7, 9').",
          },
          sections: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional section ids: book_of_mormon, come_follow_me, market_brief, market_intelligence, stock_movers, trader_edge, top_stories, st_george_news, todays_win, journal_prompt.",
          },
          setup: {
            type: "boolean",
            description: "True when they asked for Morning brief setup.",
          },
          note: {
            type: "string",
            description: "Optional note; usually omit.",
          },
        },
      },
    ),
  ];
}
