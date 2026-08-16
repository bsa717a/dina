import { getRequestUser } from "@/lib/auth/context";
import {
  displayProjectName,
  type ProjectKey,
} from "@/lib/project-tasks/keys";
import {
  assertUserCanAccessProject,
  assertUserCanAccessProjectKey,
} from "@/lib/project-tasks/membership";
import {
  addProjectTask,
  completeProjectTask,
  getProjectTask,
  listProjectTasks,
  updateProjectTask,
} from "@/lib/project-tasks/store";
import {
  PROJECT_TASK_STATUSES,
  type ProjectTaskStatus,
} from "@/lib/project-tasks/types";
import { logger } from "@/lib/logger";

async function requireProjectAccess(project: string): Promise<ProjectKey> {
  const user = getRequestUser();
  if (!user) throw new Error("Not authenticated.");
  return assertUserCanAccessProject(user, project);
}

async function requireTaskAccess(taskId: string) {
  const task = await getProjectTask(taskId);
  if (!task) throw new Error("Project task not found.");
  const user = getRequestUser();
  if (!user) throw new Error("Not authenticated.");
  await assertUserCanAccessProjectKey(user, task.projectKey);
  return task;
}

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Project task tool failed",
  });
}

function asStatus(value: unknown): ProjectTaskStatus | undefined {
  if (
    typeof value === "string" &&
    PROJECT_TASK_STATUSES.includes(value as ProjectTaskStatus)
  ) {
    return value as ProjectTaskStatus;
  }
  return undefined;
}

const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<string>
> = {
  list_project_tasks: async (args) => {
    const project = String(args.project || "");
    const key = await requireProjectAccess(project);
    const status = asStatus(args.status);
    const includeDone = Boolean(args.includeDone);
    const tasks = await listProjectTasks({
      project: key,
      statuses: status ? [status] : undefined,
      includeDone: includeDone && !status,
    });
    return ok({
      projectKey: key,
      projectName: displayProjectName(key),
      tasks: tasks.map((t) => ({
        number: t.number,
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        sortOrder: t.sortOrder,
      })),
      count: tasks.length,
      remainingCount: tasks.filter(
        (t) => t.status === "open" || t.status === "in_progress",
      ).length,
    });
  },
  add_project_task: async (args) => {
    const project = await requireProjectAccess(String(args.project || ""));
    const user = getRequestUser();
    const task = await addProjectTask({
      project,
      title: String(args.title || ""),
      description:
        typeof args.description === "string" ? args.description : undefined,
      status: asStatus(args.status) === "in_progress" ? "in_progress" : "open",
      source: "chat",
      createdByUserId: user?.id,
    });
    return ok({ task });
  },
  complete_project_task: async (args) => {
    if (typeof args.taskId === "string" && args.taskId) {
      await requireTaskAccess(args.taskId);
    } else if (typeof args.project === "string") {
      await requireProjectAccess(args.project);
    }
    const task = await completeProjectTask({
      taskId: typeof args.taskId === "string" ? args.taskId : undefined,
      project: typeof args.project === "string" ? args.project : undefined,
      number: typeof args.number === "number" ? args.number : undefined,
    });
    return ok({ task, completed: true });
  },
  update_project_task: async (args) => {
    const taskId = String(args.taskId || "");
    if (!taskId) return fail(new Error("taskId is required."));
    await requireTaskAccess(taskId);
    const task = await updateProjectTask(taskId, {
      title: typeof args.title === "string" ? args.title : undefined,
      description:
        typeof args.description === "string" ? args.description : undefined,
      status: asStatus(args.status),
    });
    return ok({ task });
  },
};

export function listProjectTaskToolNames() {
  return Object.keys(handlers);
}

export async function executeProjectTaskTool(
  name: string,
  argsJson: string,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) return fail(new Error(`Unknown project task tool: ${name}`));
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }
  try {
    return await handler(args);
  } catch (error) {
    logger.error("project_task_tool_failed", {
      tool: name,
      error: error instanceof Error ? error.message : "unknown",
    });
    return fail(error);
  }
}
