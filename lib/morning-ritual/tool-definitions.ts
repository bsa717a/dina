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
      "Generate or set up the user's Morning Ritual brief. First use (or “Morning brief setup”) returns the section picker — present that list and wait. After they pick numbers/names, call again with userText or sections so their brief is saved. When they already have a saved brief and ask for Morning brief, generate it. This is NOT the Chief of Staff Daily Briefing and does not include calendar. Present returned markdown as-is.",
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
