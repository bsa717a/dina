import type OpenAI from "openai";
import { WRITING_AUDIENCES, WRITING_MEDIUMS } from "@/lib/writing/types";

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

export function getWritingToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "draft_in_dereks_voice",
      "Draft text in Derek's voice for email, Teams, or a GitHub review note. Use whenever Derek asks to write, draft, or reply. Returns subject/body only — does NOT send. After Derek approves, use send_email or create_reply_draft for Outlook.",
      {
        properties: {
          medium: {
            type: "string",
            enum: [...WRITING_MEDIUMS],
            description: "email | teams | github_review",
          },
          purpose: {
            type: "string",
            description: "What the message should accomplish",
          },
          to: {
            type: "string",
            description: "Recipient name or email (e.g. Adam)",
          },
          points: {
            type: "array",
            items: { type: "string" },
            description: "Optional bullet points to include",
          },
          audience: {
            type: "string",
            enum: [...WRITING_AUDIENCES],
          },
          toneHint: {
            type: "string",
            description: "Optional extra tone guidance from Derek",
          },
        },
        required: ["medium", "purpose"],
      },
    ),
  ];
}
