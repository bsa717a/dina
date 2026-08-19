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

export function getStarToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "list_starred_messages",
      "List Derek's starred chat messages (soft cap 20). Prefer the starred block already in SESSION RUNTIME — do not call this just to recite that list. Returns previews + ids.",
      {
        properties: {
          limit: { type: "number", description: "Max items (default/cap 20)." },
        },
      },
    ),
    fn(
      "get_starred_message",
      "Get the full verbatim content of one starred chat message by id. Prefer the SESSION RUNTIME starred block. Use this only if a starred id is missing from that block.",
      {
        properties: {
          messageId: { type: "string" },
        },
        required: ["messageId"],
      },
    ),
    fn(
      "unstar_message",
      "Remove a star from a chat message (frees a slot under the 20-star cap).",
      {
        properties: {
          messageId: { type: "string" },
        },
        required: ["messageId"],
      },
    ),
  ];
}
