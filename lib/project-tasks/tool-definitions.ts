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
          section: {
            type: "string",
            description:
              "Section name to group this task under, such as sales. Creates the section if the project does not have it yet. Omit to leave the task ungrouped.",
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
      "Update a project task title, description, status (open / in_progress / done / cancelled), or section. Prefer project + number from the remaining list. Omit project when the user has a selected/active project. Confirm with number, title, and section name only — never an id.",
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
          section: {
            type: "string",
            description:
              "Section name to group this task under. Empty string removes it from its section. Creates the section if needed.",
          },
        },
        required: [],
      },
    ),
    fn(
      "list_project_sections",
      "List the sections that group tasks inside a project (for example Sales under 4StudentLives). Returns names only — never ids. Omit project when the user has a selected/active project.",
      {
        properties: {
          project: {
            type: "string",
            description:
              "Project name or key. Optional when SESSION RUNTIME names an Active project.",
          },
        },
        required: [],
      },
    ),
    fn(
      "add_project_section",
      "Add a section to a project so tasks can be grouped under it. Example: add a sales section to 4StudentLives. Does not create a task. Omit project when the user has a selected/active project. Confirm with the section name only — never an id.",
      {
        properties: {
          project: {
            type: "string",
            description:
              "Project name or key. Optional when SESSION RUNTIME names an Active project.",
          },
          name: {
            type: "string",
            description: "Section name, such as sales",
          },
        },
        required: ["name"],
      },
    ),
  ];
}
