import type OpenAI from "openai";
import { PROJECT_TASK_STATUSES } from "@/lib/project-tasks/types";

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

export function getProjectTaskToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "list_project_tasks",
      "List the live backlog for a project. Prefer the remaining-task block already in SESSION RUNTIME — do not call this just to recite that list. Use this for includeDone, a status filter, or a project not already listed. Returns 1-based numbers and titles only — never show ids. Default: remaining tasks (open + in_progress). Do NOT use Memory commitments for project task lists. Omit project when the user has a selected/active project.",
      {
        properties: {
          project: {
            type: "string",
            description:
              "Project name or key. Optional when SESSION RUNTIME names an Active project. Use list_projects if you are unsure of the current list.",
          },
          status: {
            type: "string",
            enum: [...PROJECT_TASK_STATUSES],
            description: "Optional single status filter",
          },
          includeDone: {
            type: "boolean",
            description: "Include done/cancelled in the numbered list",
          },
        },
        required: [],
      },
    ),
    fn(
      "add_project_task",
      "Append a task to a project's live backlog. Use for 'add to Dina tasks' / project commitments that are work items — not for Waiting On external waits, and not for Memory. Omit project when the user has a selected/active project.",
      {
        properties: {
          project: {
            type: "string",
            description:
              "Project name or key. Optional when SESSION RUNTIME names an Active project.",
          },
          title: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["open", "in_progress"],
          },
        },
        required: ["title"],
      },
    ),
    fn(
      "complete_project_task",
      "Mark a project task done. Prefer project + number from the remaining list (e.g. project='Dina', number=6). Omit project when the user has a selected/active project. Confirm with number and title only — never an id.",
      {
        properties: {
          project: {
            type: "string",
            description:
              "Project name or key. Optional when SESSION RUNTIME names an Active project.",
          },
          number: {
            type: "number",
            description: "1-based number from list_project_tasks remaining list",
          },
        },
        required: [],
      },
    ),
    fn(
      "update_project_task",
      "Update a project task title, description, or status (open / in_progress / done / cancelled). Prefer project + number from the remaining list. Omit project when the user has a selected/active project. Confirm with number and title only — never an id.",
      {
        properties: {
          project: {
            type: "string",
            description:
              "Project name or key. Optional when SESSION RUNTIME names an Active project.",
          },
          number: {
            type: "number",
            description: "1-based number from the remaining list",
          },
          title: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: [...PROJECT_TASK_STATUSES],
          },
        },
        required: [],
      },
    ),
  ];
}
