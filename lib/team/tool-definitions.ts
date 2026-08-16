import type OpenAI from "openai";
import { PROJECT_KEYS } from "@/lib/project-tasks/keys";

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

export function getTeamToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "invite_teammate",
      "Create a teammate login and email them a temporary password from Derek's Outlook. Owner only. Confirm name, email, username, and projects with Derek before calling. They set their own password and pick a personality on first login.",
      {
        properties: {
          name: {
            type: "string",
            description: "Teammate's display name, e.g. Alex Rivera",
          },
          email: {
            type: "string",
            description: "Email address to send the invite from Derek's Outlook",
          },
          username: {
            type: "string",
            description: "Optional login username (letters, numbers, underscore). Defaults from name.",
          },
          projects: {
            type: "array",
            items: { type: "string" },
            description: `Project keys they can access. Known: ${PROJECT_KEYS.join(", ")}`,
          },
          sendEmail: {
            type: "boolean",
            description: "Send the Outlook invite. Default true. Set false to create the account only.",
          },
        },
        required: ["name", "email", "projects"],
      },
    ),
  ];
}
