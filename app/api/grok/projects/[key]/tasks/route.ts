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
 *   Body: { title: string, description?: string, status?: ProjectTaskStatus, section?: string, assigneeEmail?: string | null }
 *
 * PATCH /api/grok/projects/[key]/tasks
 *   Update an existing task by id or by task number.
 *   Body: { id?: string, number?: number, status?: ProjectTaskStatus, title?: string, description?: string, section?: string | null, assigneeEmail?: string | null }
 *   At least one of id or number is required to identify the task.
 *   assigneeEmail null unassigns. A string must match a Piper user on this project.
 *
 * Task responses include assignee: { email, name } | null.
 *
 * All endpoints require a Bearer token. The env Dina token sees every project.
 * A per-user token only sees projects that user belongs to.
 */

import { NextRequest, NextResponse } from "next/server";
import { toAuthUser } from "@/lib/auth/types";
import { isValidEmail, normalizeEmail } from "@/lib/auth/password";
import { prisma } from "@/lib/db/client";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { authorizeProject } from "@/lib/grok-api/scope";
import {
  notifyTaskChange,
  type TaskAssigneePayload,
} from "@/lib/grok-api/task-webhook";
import { userCanAccessProject } from "@/lib/project-tasks/membership";
import { ensureProjectSection } from "@/lib/project-tasks/sections";
import {
  listProjectTasks,
  addProjectTask,
  updateProjectTask,
  resolveProjectTask,
  remainingTaskNumber,
} from "@/lib/project-tasks/store";
import {
  PROJECT_TASK_STATUSES,
  type ProjectTaskStatus,
  type NumberedProjectTask,
} from "@/lib/project-tasks/types";
import { jsonError } from "@/lib/http";

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

const ASSIGNEE_USER_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
  email: true,
  assistantName: true,
  assistantPersona: true,
  assistantKey: true,
  mustChangePassword: true,
  phoneNumber: true,
  sessionVersion: true,
} as const;

function displayName(user: { name: string; username: string }): string {
  return user.name.trim() || user.username.trim();
}

function toAssignee(user: {
  email: string | null;
  name: string;
  username: string;
} | null): TaskAssigneePayload {
  if (!user) return null;
  const email = user.email?.trim().toLowerCase() ?? "";
  const name = displayName(user);
  if (!email && !name) return null;
  return { email, name };
}

async function assigneeForId(
  userId: string | null,
): Promise<TaskAssigneePayload> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, username: true },
  });
  return toAssignee(user);
}

async function assigneesById(
  userIds: Array<string | null>,
): Promise<Map<string, TaskAssigneePayload>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, TaskAssigneePayload>();
  if (ids.length === 0) return map;
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, name: true, username: true },
  });
  for (const user of users) {
    map.set(user.id, toAssignee(user));
  }
  return map;
}

/**
 * Email must match a Piper user who can access this project.
 * Owners belong to every project; other users need a membership row.
 * Missing users and non-members share one 400 so the email is not confirmed.
 */
async function resolveAssigneeEmail(
  projectKey: string,
  raw: unknown,
): Promise<
  | { ok: true; userId: string | null; assignee: TaskAssigneePayload }
  | { ok: false; error: string }
> {
  if (raw === null) return { ok: true, userId: null, assignee: null };
  if (typeof raw !== "string") {
    return { ok: false, error: "assigneeEmail must be a string or null" };
  }
  if (!isValidEmail(raw)) {
    return { ok: false, error: "assigneeEmail must be a valid email address" };
  }
  const email = normalizeEmail(raw);
  const user = await prisma.user.findUnique({
    where: { email },
    select: ASSIGNEE_USER_SELECT,
  });
  if (!user?.email) {
    return {
      ok: false,
      error: `No project member matches assigneeEmail "${email}".`,
    };
  }
  const access = await userCanAccessProject(toAuthUser(user), projectKey);
  if (!access) {
    return {
      ok: false,
      error: `No project member matches assigneeEmail "${email}".`,
    };
  }
  return {
    ok: true,
    userId: user.id,
    assignee: { email, name: displayName(user) },
  };
}

function formatTask(
  t: {
    id: string;
    number: number;
    title: string;
    description: string;
    status: ProjectTaskStatus;
    sectionName?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  assignee: TaskAssigneePayload,
) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    status: t.status,
    section: t.sectionName ?? null,
    assignee,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

async function sectionIdFromName(
  projectKey: string,
  section: unknown,
): Promise<string | null | undefined> {
  if (section === undefined) return undefined;
  if (section === null || section === "") return null;
  if (typeof section !== "string") {
    throw new Error("section must be a string");
  }
  const row = await ensureProjectSection({ project: projectKey, name: section });
  return row.id;
}

async function openProject(request: NextRequest, rawKey: string) {
  const auth = await requireServiceToken(request);
  if (!auth.ok) return auth;
  const project = await authorizeProject(auth.actor, rawKey);
  if (!project.ok) {
    return { ok: false as const, response: jsonError(project.error, project.status) };
  }
  return { ok: true as const, projectKey: project.projectKey };
}

export async function GET(request: NextRequest, context: RouteParams) {
  const { key: rawKey } = await context.params;
  const opened = await openProject(request, rawKey);
  if (!opened.ok) return opened.response;
  const { projectKey } = opened;

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
  const assignees = await assigneesById(tasks.map((task) => task.assigneeUserId));

  return NextResponse.json({
    ok: true,
    projectKey,
    tasks: tasks.map((task) =>
      formatTask(
        task,
        task.assigneeUserId ? (assignees.get(task.assigneeUserId) ?? null) : null,
      ),
    ),
  });
}

export async function POST(request: NextRequest, context: RouteParams) {
  const { key: rawKey } = await context.params;
  const opened = await openProject(request, rawKey);
  if (!opened.ok) return opened.response;
  const { projectKey } = opened;

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
    title,
    description,
    status: rawStatus,
    section,
    assigneeEmail,
  } = body as Record<string, unknown>;

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

  let assigneeUserId: string | undefined;
  let assignee: TaskAssigneePayload = null;
  if (assigneeEmail !== undefined) {
    const resolved = await resolveAssigneeEmail(projectKey, assigneeEmail);
    if (!resolved.ok) return jsonError(resolved.error, 400);
    if (resolved.userId) assigneeUserId = resolved.userId;
    assignee = resolved.assignee;
  }

  let sectionId: string | null | undefined;
  try {
    sectionId = await sectionIdFromName(projectKey, section);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Invalid section";
    return jsonError(msg, 400);
  }

  try {
    const created = await addProjectTask({
      project: projectKey,
      title: title.trim(),
      description: descStr,
      status,
      source: "grok-api",
      ...(sectionId ? { sectionId } : {}),
      ...(assigneeUserId ? { assigneeUserId } : {}),
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
        section: created.sectionName,
        assignee,
      },
    });

    return NextResponse.json({
      ok: true,
      projectKey,
      task: formatTask({ ...created, number: taskNumber }, assignee),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to create task";
    return jsonError(msg, 400);
  }
}

export async function PATCH(request: NextRequest, context: RouteParams) {
  const { key: rawKey } = await context.params;
  const opened = await openProject(request, rawKey);
  if (!opened.ok) return opened.response;
  const { projectKey } = opened;

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
    section,
    assigneeEmail,
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
    sectionId?: string | null;
    assigneeUserId?: string | null;
  } = {};
  let explicitAssignee: TaskAssigneePayload | undefined;

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

  if (section !== undefined) {
    try {
      const sectionId = await sectionIdFromName(projectKey, section);
      if (sectionId !== undefined) patch.sectionId = sectionId;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Invalid section";
      return jsonError(msg, 400);
    }
  }

  if (assigneeEmail !== undefined) {
    const resolved = await resolveAssigneeEmail(projectKey, assigneeEmail);
    if (!resolved.ok) return jsonError(resolved.error, 400);
    patch.assigneeUserId = resolved.userId;
    explicitAssignee = resolved.assignee;
  }

  if (Object.keys(patch).length === 0) {
    return jsonError(
      "At least one field to update is required (status, title, description, section, or assigneeEmail)",
      400,
    );
  }

  try {
    const updated = await updateProjectTask(task.id, patch);
    const number =
      patch.sectionId !== undefined
        ? ((await remainingTaskNumber(projectKey, updated.id)) ?? task.number)
        : task.number;
    const assignee =
      explicitAssignee !== undefined
        ? explicitAssignee
        : await assigneeForId(updated.assigneeUserId);

    void notifyTaskChange({
      event: "task.updated",
      projectKey,
      task: {
        id: updated.id,
        number,
        title: updated.title,
        description: updated.description,
        status: updated.status,
        section: updated.sectionName,
        assignee,
      },
      changes: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.sectionId !== undefined ? { section: updated.sectionName } : {}),
        ...(explicitAssignee !== undefined ? { assignee: explicitAssignee } : {}),
      },
    });

    return NextResponse.json({
      ok: true,
      projectKey,
      task: formatTask({ ...updated, number }, assignee),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update task";
    return jsonError(msg, 400);
  }
}
