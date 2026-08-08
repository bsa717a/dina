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
      "List Derek's starred chat messages (soft cap 20). Use when he asks for starred chats, pinned replies, or 'the message I starred'. Returns previews + ids — then get_starred_message for full text.",
      {
        properties: {
          limit: { type: "number", description: "Max items (default/cap 20)." },
        },
      },
    ),
    fn(
      "get_starred_message",
      "Get the full verbatim content of one starred chat message by id. Required before putting starred content into Word/Memory.",
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
