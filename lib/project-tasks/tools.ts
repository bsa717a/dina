import { getRequestUser } from "@/lib/auth/context";
import { projectArgOrActive } from "@/lib/chat/active-project";
import { ensureProjectCatalog } from "@/lib/projects/catalog";
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
  resolveProjectTask,
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

/** User-facing task fields. Never include internal ids. */
function publicTask(task: {
  title: string;
  description: string;
  status: string;
  projectKey: string;
  number?: number;
}) {
  return {
    ...(typeof task.number === "number" && task.number > 0
      ? { number: task.number }
      : {}),
    title: task.title,
    description: task.description,
    status: task.status,
    projectKey: task.projectKey,
    projectName: displayProjectName(task.projectKey),
  };
}

const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<string>
> = {
  list_project_tasks: async (args) => {
    const project = projectArgOrActive(args);
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
      tasks: tasks.map((t) => publicTask(t)),
      count: tasks.length,
      remainingCount: tasks.filter(
        (t) => t.status === "open" || t.status === "in_progress",
      ).length,
    });
  },
  add_project_task: async (args) => {
    const project = await requireProjectAccess(projectArgOrActive(args));
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
    const remaining = await listProjectTasks({ project });
    const number = remaining.find((t) => t.id === task.id)?.number;
    return ok({ task: publicTask({ ...task, number }) });
  },
  complete_project_task: async (args) => {
    if (typeof args.taskId === "string" && args.taskId) {
      await requireTaskAccess(args.taskId);
      const task = await completeProjectTask({ taskId: args.taskId });
      return ok({ task: publicTask(task), completed: true });
    }
    const project = projectArgOrActive(args);
    await requireProjectAccess(project);
    const task = await completeProjectTask({
      project,
      number: typeof args.number === "number" ? args.number : undefined,
    });
    return ok({ task: publicTask(task), completed: true });
  },
  update_project_task: async (args) => {
    const resolved =
      typeof args.taskId === "string" && args.taskId
        ? await requireTaskAccess(args.taskId).then((task) =>
            resolveProjectTask({ taskId: task.id }),
          )
        : await (async () => {
            const project = projectArgOrActive(args);
            await requireProjectAccess(project);
            return resolveProjectTask({
              project,
              number: typeof args.number === "number" ? args.number : undefined,
            });
          })();
    await requireTaskAccess(resolved.id);
    const task = await updateProjectTask(resolved.id, {
      title: typeof args.title === "string" ? args.title : undefined,
      description:
        typeof args.description === "string" ? args.description : undefined,
      status: asStatus(args.status),
    });
    return ok({ task: publicTask({ ...task, number: resolved.number }) });
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
    await ensureProjectCatalog();
    return await handler(args);
  } catch (error) {
    logger.error("project_task_tool_failed", {
      tool: name,
      error: error instanceof Error ? error.message : "unknown",
    });
    return fail(error);
  }
}
