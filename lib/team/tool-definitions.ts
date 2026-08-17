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

export function getTeamToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "list_projects",
      "List live projects Dina can grant access to and attach tasks/memory to. Owner only. Use this instead of assuming a fixed project list — projects are added and archived over time.",
      {
        properties: {},
        required: [],
      },
    ),
    fn(
      "create_project",
      "Register a new live project (or restore an archived one). Owner only. Use when Derek says create a project / add a project — this is what makes it grantable and usable for tasks. Does not send invites. After creating, use add_teammate_to_project to grant people access.",
      {
        properties: {
          name: {
            type: "string",
            description: "Display name, e.g. Regi or 4StudentLives",
          },
          key: {
            type: "string",
            description: "Optional stable key. Defaults from the name (regi, 4studentlives).",
          },
          aliases: {
            type: "array",
            items: { type: "string" },
            description: "Optional extra names people might say, e.g. reggie, regi-app",
          },
        },
        required: ["name"],
      },
    ),
    fn(
      "archive_project",
      "Remove a project from the live list without deleting its tasks or memory. Owner only. Use when Derek says remove / archive / we are done with this project.",
      {
        properties: {
          project: {
            type: "string",
            description: "Project name or key to archive",
          },
        },
        required: ["project"],
      },
    ),
    fn(
      "list_teammates",
      "List existing teammate accounts and the projects they can access. Owner only. Use this before adding someone to a project so you do not invent usernames or send a second invite.",
      {
        properties: {},
        required: [],
      },
    ),
    fn(
      "add_teammate_to_project",
      "Grant an existing teammate access to one or more projects. Owner only. Does NOT create an account and does NOT send email. Use when Derek says add Adam to Regi / grant project access without another invite. Look up the person with list_teammates first if needed.",
      {
        properties: {
          person: {
            type: "string",
            description: "Teammate name or username, e.g. Adam Bangerter or adam_bangerter",
          },
          projects: {
            type: "array",
            items: { type: "string" },
            description: "Projects to grant. Use list_projects if you are unsure of current names.",
          },
        },
        required: ["person", "projects"],
      },
    ),
    fn(
      "invite_teammate",
      "Create a NEW teammate login and email them a temporary password from Derek's Outlook. Owner only. Do not use this if they already have an account — use add_teammate_to_project instead. Confirm name, email, username, and projects with Derek before calling.",
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
            description: "Projects they can access. Use list_projects if you are unsure of current names.",
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
