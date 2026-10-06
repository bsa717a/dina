import { prisma } from "@/lib/db/client";
import { assertProjectKey, type ProjectKey } from "@/lib/project-tasks/keys";
import {
  listProjectSections,
  requireProjectSectionById,
  sectionNameMap,
} from "@/lib/project-tasks/sections";
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
  sectionId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}, sectionNames?: Map<string, string>): ProjectTaskRecord {
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
    sectionId: row.sectionId,
    sectionName: row.sectionId
      ? (sectionNames?.get(row.sectionId) ?? null)
      : null,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sectionRank(
  sectionId: string | null,
  order: Map<string, number>,
): number {
  if (!sectionId) return Number.MAX_SAFE_INTEGER;
  return order.get(sectionId) ?? Number.MAX_SAFE_INTEGER;
}

function compareSectioned(
  a: ProjectTaskRecord,
  b: ProjectTaskRecord,
  order: Map<string, number>,
): number {
  const rank = sectionRank(a.sectionId, order) - sectionRank(b.sectionId, order);
  if (rank !== 0) return rank;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.getTime() - b.createdAt.getTime();
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

  const [rows, sections] = await Promise.all([
    prisma.projectTask.findMany({
      where: {
        projectKey,
        status: { in: statuses },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    listProjectSections(projectKey),
  ]);
  const names = new Map(sections.map((section) => [section.id, section.name]));
  const order = new Map(sections.map((section, index) => [section.id, index]));
  const records = rows.map((row) => toRecord(row, names));
  records.sort((a, b) => compareSectioned(a, b, order));

  return withNumbers(records);
}

export async function getProjectTask(
  id: string,
): Promise<ProjectTaskRecord | null> {
  const row = await prisma.projectTask.findUnique({ where: { id } });
  if (!row) return null;
  const names = await sectionNameMap(row.projectKey);
  return toRecord(row, names);
}

export async function addProjectTask(input: {
  project: string;
  title: string;
  description?: string;
  status?: ProjectTaskStatus;
  source?: string;
  createdByUserId?: string;
  assigneeUserId?: string;
  sectionId?: string | null;
}): Promise<ProjectTaskRecord> {
  const projectKey = assertProjectKey(input.project);
  const title = input.title.trim();
  if (!title) throw new Error("Task title is required.");
  if (input.sectionId) {
    await requireProjectSectionById(projectKey, input.sectionId);
  }

  const max = await prisma.projectTask.aggregate({
    where: { projectKey },
    _max: { sortOrder: true },
  });
  const sortOrder = (max._max.sortOrder ?? 0) + 1;
  const status = input.status ?? "open";

  let row;
  try {
    row = await prisma.projectTask.create({
      data: {
        projectKey,
        title,
        description: (input.description || "").trim(),
        status,
        sortOrder,
        source: input.source || "chat",
        createdByUserId: input.createdByUserId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        sectionId: input.sectionId ?? null,
        completedAt: status === "done" ? new Date() : null,
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new Error(`A task titled "${title}" already exists on this project.`);
    }
    throw error;
  }
  const names = await sectionNameMap(projectKey);
  return toRecord(row, names);
}

export async function updateProjectTask(
  id: string,
  patch: {
    title?: string;
    description?: string;
    status?: ProjectTaskStatus;
    sortOrder?: number;
    sectionId?: string | null;
  },
): Promise<ProjectTaskRecord> {
  const existing = await prisma.projectTask.findUnique({ where: { id } });
  if (!existing) throw new Error("Project task not found.");
  if (patch.sectionId) {
    await requireProjectSectionById(existing.projectKey, patch.sectionId);
  }

  const status = patch.status ?? asStatus(existing.status);
  const row = await prisma.projectTask.update({
    where: { id },
    data: {
      title: patch.title !== undefined ? patch.title.trim() : undefined,
      description:
        patch.description !== undefined ? patch.description.trim() : undefined,
      status: patch.status,
      sortOrder: patch.sortOrder,
      sectionId: patch.sectionId,
      completedAt:
        status === "done"
          ? existing.completedAt ?? new Date()
          : status === "cancelled"
            ? existing.completedAt
            : null,
    },
  });
  const names = await sectionNameMap(existing.projectKey);
  return toRecord(row, names);
}

/**
 * Resolve by task id, or by 1-based number within the project's remaining list
 * (open + in_progress), matching list_project_tasks default numbering.
 */
export async function resolveProjectTask(input: {
  taskId?: string;
  project?: string;
  number?: number;
}): Promise<NumberedProjectTask> {
  if (input.taskId) {
    const task = await getProjectTask(input.taskId);
    if (!task) throw new Error("Project task not found.");
    const remaining = await listProjectTasks({
      project: task.projectKey,
      includeDone: true,
    });
    const match = remaining.find((t) => t.id === task.id);
    return match ?? { ...task, number: 0 };
  }

  if (!input.project || typeof input.number !== "number") {
    throw new Error("Provide project + number.");
  }

  const remaining = await listProjectTasks({ project: input.project });
  const match = remaining.find((t) => t.number === input.number);
  if (!match) {
    throw new Error(
      `No remaining task #${input.number} for project "${input.project}". List has ${remaining.length} remaining.`,
    );
  }
  return match;
}

/**
 * Complete by 1-based remaining number (preferred), or by internal task id.
 */
export async function completeProjectTask(input: {
  taskId?: string;
  project?: string;
  number?: number;
}): Promise<NumberedProjectTask> {
  const match = await resolveProjectTask(input);
  const updated = await updateProjectTask(match.id, { status: "done" });
  return { ...updated, number: match.number };
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
