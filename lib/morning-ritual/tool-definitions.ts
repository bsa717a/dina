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
      "Generate Derek's Morning Ritual brief (Come Follow Me deep study for today, Book of Mormon schedule line, web-researched markets, journal prompt). Use when he asks for morning brief / morning ritual. This is NOT the Chief of Staff Daily Briefing and does not include calendar. Returns complete markdown — present it to Derek without rewriting into a CoS brief.",
      {
        properties: {
          note: {
            type: "string",
            description: "Optional note; usually omit.",
          },
        },
      },
    ),
  ];
}
