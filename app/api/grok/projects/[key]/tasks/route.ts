/**
 * Grok Bot Dina Task API
 *
 * GET /api/grok/projects/[key]/tasks
 *   List open/in-progress tasks for a project.
 *   Query params:
 *     - status: comma-separated list of statuses (default: open,in_progress)
 *
 * POST /api/grok/projects/[key]/tasks
 *   Create a new task on the project.
 *   Body: { title: string, description?: string, status?: ProjectTaskStatus }
 *
 * PATCH /api/grok/projects/[key]/tasks
 *   Update an existing task by id or by task number.
 *   Body: { id?: string, number?: number, status?: ProjectTaskStatus, title?: string, description?: string }
 *   At least one of id or number is required to identify the task.
 *
 * All endpoints require Bearer token authentication via GROK_BOT_DINA_API_TOKEN.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireServiceToken } from "@/lib/grok-api/auth";
import {
  ensureProjectCatalog,
  resolveProjectKey,
} from "@/lib/projects/catalog";
import {
  listProjectTasks,
  addProjectTask,
  updateProjectTask,
  resolveProjectTask,
} from "@/lib/project-tasks/store";
import {
  PROJECT_TASK_STATUSES,
  type ProjectTaskStatus,
  type NumberedProjectTask,
} from "@/lib/project-tasks/types";
import { jsonError } from "@/lib/http";
import { notifyTaskChange } from "@/lib/grok-api/task-webhook";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ key: string }>;
}

const STATUS_ALIASES: Record<string, ProjectTaskStatus> = {
  closed: "done",
  complete: "done",
  completed: "done",
  finished: "done",
  active: "in_progress",
  working: "in_progress",
  todo: "open",
  pending: "open",
  cancel: "cancelled",
  canceled: "cancelled",
};

function normalizeStatus(raw: string): ProjectTaskStatus | null {
  const lower = raw.trim().toLowerCase();
  if (PROJECT_TASK_STATUSES.includes(lower as ProjectTaskStatus)) {
    return lower as ProjectTaskStatus;
  }
  return STATUS_ALIASES[lower] ?? null;
}

function formatTask(t: NumberedProjectTask) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest, context: RouteParams) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { key: rawKey } = await context.params;

  await ensureProjectCatalog();
  const projectKey = resolveProjectKey(rawKey);
  if (!projectKey) {
    return jsonError(`Unknown project: "${rawKey}"`, 404);
  }

  const statusParam = request.nextUrl.searchParams.get("status");
  let statuses: ProjectTaskStatus[] = ["open", "in_progress"];

  if (statusParam) {
    const requested = statusParam.split(",").map((s) => s.trim().toLowerCase());
    const validStatuses = requested.filter((s): s is ProjectTaskStatus =>
      PROJECT_TASK_STATUSES.includes(s as ProjectTaskStatus),
    );
    if (validStatuses.length > 0) {
      statuses = validStatuses;
    }
  }

  const tasks = await listProjectTasks({
    project: projectKey,
    statuses,
  });

  return NextResponse.json({
    ok: true,
    projectKey,
    tasks: tasks.map(formatTask),
  });
}

export async function POST(request: NextRequest, context: RouteParams) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { key: rawKey } = await context.params;

  await ensureProjectCatalog();
  const projectKey = resolveProjectKey(rawKey);
  if (!projectKey) {
    return jsonError(`Unknown project: "${rawKey}"`, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object") {
    return jsonError("Request body must be an object", 400);
  }

  const { title, description, status: rawStatus } = body as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return jsonError("title is required and must be a non-empty string", 400);
  }

  let status: ProjectTaskStatus = "open";
  if (rawStatus !== undefined) {
    if (typeof rawStatus !== "string") {
      return jsonError("status must be a string", 400);
    }
    const normalized = normalizeStatus(rawStatus);
    if (!normalized) {
      return jsonError(
        `Invalid status "${rawStatus}". Valid values: ${PROJECT_TASK_STATUSES.join(", ")}`,
        400,
      );
    }
    status = normalized;
  }

  const descStr = typeof description === "string" ? description : "";

  try {
    const created = await addProjectTask({
      project: projectKey,
      title: title.trim(),
      description: descStr,
      status,
      source: "grok-api",
    });

    const tasks = await listProjectTasks({
      project: projectKey,
      includeDone: true,
    });
    const numbered = tasks.find((t) => t.id === created.id);
    const taskNumber = numbered?.number ?? 0;

    void notifyTaskChange({
      event: "task.created",
      projectKey,
      task: {
        id: created.id,
        number: taskNumber,
        title: created.title,
        description: created.description,
        status: created.status,
      },
    });

    return NextResponse.json({
      ok: true,
      projectKey,
      task: {
        id: created.id,
        number: taskNumber,
        title: created.title,
        description: created.description,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to create task";
    return jsonError(msg, 400);
  }
}

export async function PATCH(request: NextRequest, context: RouteParams) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { key: rawKey } = await context.params;

  await ensureProjectCatalog();
  const projectKey = resolveProjectKey(rawKey);
  if (!projectKey) {
    return jsonError(`Unknown project: "${rawKey}"`, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object") {
    return jsonError("Request body must be an object", 400);
  }

  const {
    id: taskId,
    number: taskNumber,
    status: rawStatus,
    title,
    description,
  } = body as Record<string, unknown>;

  if (taskId === undefined && taskNumber === undefined) {
    return jsonError("Either id or number is required to identify the task", 400);
  }

  if (taskId !== undefined && typeof taskId !== "string") {
    return jsonError("id must be a string", 400);
  }

  if (taskNumber !== undefined && typeof taskNumber !== "number") {
    return jsonError("number must be a number", 400);
  }

  let task: NumberedProjectTask;
  try {
    task = await resolveProjectTask({
      taskId: taskId as string | undefined,
      project: projectKey,
      number: taskNumber as number | undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Task not found";
    return jsonError(msg, 404);
  }

  if (task.projectKey !== projectKey) {
    return jsonError(
      `Task belongs to project "${task.projectKey}", not "${projectKey}"`,
      400,
    );
  }

  const patch: {
    title?: string;
    description?: string;
    status?: ProjectTaskStatus;
  } = {};

  if (rawStatus !== undefined) {
    if (typeof rawStatus !== "string") {
      return jsonError("status must be a string", 400);
    }
    const normalized = normalizeStatus(rawStatus);
    if (!normalized) {
      return jsonError(
        `Invalid status "${rawStatus}". Valid values: ${PROJECT_TASK_STATUSES.join(", ")}`,
        400,
      );
    }
    patch.status = normalized;
  }

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return jsonError("title must be a non-empty string", 400);
    }
    patch.title = title.trim();
  }

  if (description !== undefined) {
    if (typeof description !== "string") {
      return jsonError("description must be a string", 400);
    }
    patch.description = description;
  }

  if (Object.keys(patch).length === 0) {
    return jsonError(
      "At least one field to update is required (status, title, or description)",
      400,
    );
  }

  try {
    const updated = await updateProjectTask(task.id, patch);

    void notifyTaskChange({
      event: "task.updated",
      projectKey,
      task: {
        id: updated.id,
        number: task.number,
        title: updated.title,
        description: updated.description,
        status: updated.status,
      },
      changes: patch,
    });

    return NextResponse.json({
      ok: true,
      projectKey,
      task: {
        id: updated.id,
        number: task.number,
        title: updated.title,
        description: updated.description,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update task";
    return jsonError(msg, 400);
  }
}
