import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { assertProjectKey } from "@/lib/project-tasks/keys";
import type { ProjectSectionRecord } from "@/lib/project-tasks/types";

function toRecord(row: {
  id: string;
  projectKey: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): ProjectSectionRecord {
  return {
    id: row.id,
    projectKey: row.projectKey,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function normalizeSectionName(raw: string): { name: string; nameKey: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Section name is required.");
  if (name.length > 80) throw new Error("Section name must be 80 characters or fewer.");
  return { name, nameKey: name.toLowerCase() };
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

export async function listProjectSections(
  project: string,
): Promise<ProjectSectionRecord[]> {
  const projectKey = assertProjectKey(project);
  const rows = await prisma.projectSection.findMany({
    where: { projectKey },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toRecord);
}

export async function sectionNameMap(
  projectKey: string,
): Promise<Map<string, string>> {
  const sections = await listProjectSections(projectKey);
  return new Map(sections.map((section) => [section.id, section.name]));
}

export async function findProjectSection(
  project: string,
  name: string,
): Promise<ProjectSectionRecord | null> {
  const projectKey = assertProjectKey(project);
  const { nameKey } = normalizeSectionName(name);
  const row = await prisma.projectSection.findUnique({
    where: { projectKey_nameKey: { projectKey, nameKey } },
  });
  return row ? toRecord(row) : null;
}

export async function addProjectSection(input: {
  project: string;
  name: string;
}): Promise<ProjectSectionRecord> {
  const projectKey = assertProjectKey(input.project);
  const { name, nameKey } = normalizeSectionName(input.name);
  const existing = await prisma.projectSection.findUnique({
    where: { projectKey_nameKey: { projectKey, nameKey } },
  });
  if (existing) {
    throw new Error(`${existing.name} is already a section on this project.`);
  }

  const max = await prisma.projectSection.aggregate({
    where: { projectKey },
    _max: { sortOrder: true },
  });
  const sortOrder = (max._max.sortOrder ?? 0) + 1;

  try {
    const row = await prisma.projectSection.create({
      data: { projectKey, name, nameKey, sortOrder },
    });
    return toRecord(row);
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const raced = await prisma.projectSection.findUnique({
      where: { projectKey_nameKey: { projectKey, nameKey } },
    });
    throw new Error(
      `${raced?.name ?? name} is already a section on this project.`,
    );
  }
}

/** Find a section or create it. Used when a chat turn names a section and a task together. */
export async function ensureProjectSection(input: {
  project: string;
  name: string;
}): Promise<ProjectSectionRecord> {
  const existing = await findProjectSection(input.project, input.name);
  if (existing) return existing;
  return addProjectSection(input);
}

export async function requireProjectSection(
  project: string,
  name: string,
): Promise<ProjectSectionRecord> {
  const { name: label } = normalizeSectionName(name);
  const section = await findProjectSection(project, label);
  if (!section) {
    throw new Error(
      `No section named "${label}" on this project. Add the section first.`,
    );
  }
  return section;
}

export async function requireProjectSectionById(
  project: string,
  sectionId: string,
): Promise<ProjectSectionRecord> {
  const projectKey = assertProjectKey(project);
  const row = await prisma.projectSection.findUnique({ where: { id: sectionId } });
  if (!row || row.projectKey !== projectKey) {
    throw new Error("That section is not on this project.");
  }
  return toRecord(row);
}
