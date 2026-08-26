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

export function getStandingInstructionToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "list_standing_instructions",
      "List Derek's binding behavior rules (not Memory). SESSION RUNTIME already includes the active list — recite that block when asked. Use this only if you need archived items too.",
      {
        properties: {
          includeArchived: {
            type: "boolean",
            description: "Include archived standing instructions",
          },
        },
        required: [],
      },
    ),
    fn(
      "set_standing_instruction",
      'Create or update a binding behavior rule that is injected every turn. Use when Derek says "from now on", "always", "never show X", or similar about how you talk or present. Do not only remember() that — Memory is retrieved by relevance and will be forgotten. Upserts by title. Activates immediately. Do not include internal ids in the content.',
      {
        properties: {
          title: {
            type: "string",
            description: "Short name, e.g. Never show task IDs",
          },
          content: {
            type: "string",
            description: "The rule in one or two sentences",
          },
        },
        required: ["title", "content"],
      },
    ),
    fn(
      "archive_standing_instruction",
      "Forget a standing instruction so it is no longer injected. Pass the title from SESSION RUNTIME.",
      {
        properties: {
          title: {
            type: "string",
            description: "Title of the standing instruction to archive",
          },
        },
        required: ["title"],
      },
    ),
  ];
}
