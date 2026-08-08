import type OpenAI from "openai";
import { PROJECT_KEYS } from "@/lib/project-tasks/keys";
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
      "List the live backlog for a project. Returns 1-based numbers for the filtered list so Derek can say 'mark 6 complete'. Default: remaining tasks (open + in_progress). Use includeDone=true to show completed items too. Do NOT use Memory commitments for project task lists.",
      {
        properties: {
          project: {
            type: "string",
            description: `Project name or key. Known: ${PROJECT_KEYS.join(", ")}`,
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
        required: ["project"],
      },
    ),
    fn(
      "add_project_task",
      "Append a task to a project's live backlog. Use for 'add to Dina tasks' / project commitments that are work items — not for Waiting On external waits, and not for Memory.",
      {
        properties: {
          project: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["open", "in_progress"],
          },
        },
        required: ["project", "title"],
      },
    ),
    fn(
      "complete_project_task",
      "Mark a project task done. Prefer project + number from the latest list_project_tasks remaining list (e.g. project='Dina', number=6). Or pass taskId.",
      {
        properties: {
          project: { type: "string" },
          number: {
            type: "number",
            description: "1-based number from list_project_tasks remaining list",
          },
          taskId: { type: "string" },
        },
        required: [],
      },
    ),
    fn(
      "update_project_task",
      "Update a project task title, description, or status (open / in_progress / done / cancelled).",
      {
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: [...PROJECT_TASK_STATUSES],
          },
        },
        required: ["taskId"],
      },
    ),
  ];
}
