import { prisma } from "@/lib/db/client";
import { assertProjectKey, type ProjectKey } from "@/lib/project-tasks/keys";
import {
  PROJECT_TASK_STATUSES,
  REMAINING_STATUSES,
  type NumberedProjectTask,
  type ProjectTaskRecord,
  type ProjectTaskStatus,
} from "@/lib/project-tasks/types";

function asStatus(value: string): ProjectTaskStatus {
  if (PROJECT_TASK_STATUSES.includes(value as ProjectTaskStatus)) {
    return value as ProjectTaskStatus;
  }
  return "open";
}

function toRecord(row: {
  id: string;
  projectKey: string;
  title: string;
  description: string;
  status: string;
  sortOrder: number;
  source: string;
  createdByUserId: string | null;
  assigneeUserId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ProjectTaskRecord {
  return {
    id: row.id,
    projectKey: row.projectKey,
    title: row.title,
    description: row.description,
    status: asStatus(row.status),
    sortOrder: row.sortOrder,
    source: row.source,
    createdByUserId: row.createdByUserId,
    assigneeUserId: row.assigneeUserId,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function withNumbers(tasks: ProjectTaskRecord[]): NumberedProjectTask[] {
  return tasks.map((task, index) => ({ ...task, number: index + 1 }));
}

export async function listProjectTasks(options: {
  project: string;
  statuses?: ProjectTaskStatus[];
  includeDone?: boolean;
}): Promise<NumberedProjectTask[]> {
  const projectKey = assertProjectKey(options.project);
  const statuses =
    options.statuses ??
    (options.includeDone
      ? [...PROJECT_TASK_STATUSES]
      : [...REMAINING_STATUSES]);

  const rows = await prisma.projectTask.findMany({
    where: {
      projectKey,
      status: { in: statuses },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return withNumbers(rows.map(toRecord));
}

export async function getProjectTask(
  id: string,
): Promise<ProjectTaskRecord | null> {
  const row = await prisma.projectTask.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

export async function addProjectTask(input: {
  project: string;
  title: string;
  description?: string;
  status?: ProjectTaskStatus;
  source?: string;
  createdByUserId?: string;
  assigneeUserId?: string;
}): Promise<ProjectTaskRecord> {
  const projectKey = assertProjectKey(input.project);
  const title = input.title.trim();
  if (!title) throw new Error("Task title is required.");

  const max = await prisma.projectTask.aggregate({
    where: { projectKey },
    _max: { sortOrder: true },
  });
  const sortOrder = (max._max.sortOrder ?? 0) + 1;
  const status = input.status ?? "open";

  const row = await prisma.projectTask.create({
    data: {
      projectKey,
      title,
      description: (input.description || "").trim(),
      status,
      sortOrder,
      source: input.source || "chat",
      createdByUserId: input.createdByUserId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      completedAt: status === "done" ? new Date() : null,
    },
  });
  return toRecord(row);
}

export async function updateProjectTask(
  id: string,
  patch: {
    title?: string;
    description?: string;
    status?: ProjectTaskStatus;
    sortOrder?: number;
  },
): Promise<ProjectTaskRecord> {
  const existing = await prisma.projectTask.findUnique({ where: { id } });
  if (!existing) throw new Error("Project task not found.");

  const status = patch.status ?? asStatus(existing.status);
  const row = await prisma.projectTask.update({
    where: { id },
    data: {
      title: patch.title !== undefined ? patch.title.trim() : undefined,
      description:
        patch.description !== undefined ? patch.description.trim() : undefined,
      status: patch.status,
      sortOrder: patch.sortOrder,
      completedAt:
        status === "done"
          ? existing.completedAt ?? new Date()
          : status === "cancelled"
            ? existing.completedAt
            : null,
    },
  });
  return toRecord(row);
}

/**
 * Complete by task id, or by 1-based number within the project's remaining list
 * (open + in_progress), matching list_project_tasks default numbering.
 */
export async function completeProjectTask(input: {
  taskId?: string;
  project?: string;
  number?: number;
}): Promise<ProjectTaskRecord> {
  if (input.taskId) {
    return updateProjectTask(input.taskId, { status: "done" });
  }

  if (!input.project || typeof input.number !== "number") {
    throw new Error("Provide taskId, or project + number.");
  }

  const remaining = await listProjectTasks({ project: input.project });
  const match = remaining.find((t) => t.number === input.number);
  if (!match) {
    throw new Error(
      `No remaining task #${input.number} for project "${input.project}". List has ${remaining.length} remaining.`,
    );
  }
  return updateProjectTask(match.id, { status: "done" });
}

/**
 * Upsert by projectKey+title for idempotent seeds.
 * When preserveExistingStatus is true (default for seeds), never overwrite
 * status/completedAt on an existing row — only fill empty description / sortOrder.
 */
export async function upsertProjectTask(input: {
  projectKey: ProjectKey;
  title: string;
  description?: string;
  status: ProjectTaskStatus;
  sortOrder: number;
  source?: string;
  preserveExistingStatus?: boolean;
}): Promise<{ task: ProjectTaskRecord; created: boolean }> {
  const title = input.title.trim();
  const preserve = input.preserveExistingStatus !== false;
  const existing = await prisma.projectTask.findUnique({
    where: {
      projectKey_title: {
        projectKey: input.projectKey,
        title,
      },
    },
  });

  if (existing) {
    if (preserve) {
      const row = await prisma.projectTask.update({
        where: { id: existing.id },
        data: {
          description: existing.description.trim()
            ? existing.description
            : (input.description || "").trim(),
          sortOrder: input.sortOrder,
        },
      });
      return { task: toRecord(row), created: false };
    }
    const row = await prisma.projectTask.update({
      where: { id: existing.id },
      data: {
        description: (input.description || existing.description).trim(),
        status: input.status,
        sortOrder: input.sortOrder,
        completedAt:
          input.status === "done"
            ? existing.completedAt ?? new Date()
            : input.status === "open" || input.status === "in_progress"
              ? null
              : existing.completedAt,
      },
    });
    return { task: toRecord(row), created: false };
  }

  const row = await prisma.projectTask.create({
    data: {
      projectKey: input.projectKey,
      title,
      description: (input.description || "").trim(),
      status: input.status,
      sortOrder: input.sortOrder,
      source: input.source || "seed",
      completedAt: input.status === "done" ? new Date() : null,
    },
  });
  return { task: toRecord(row), created: true };
}
