import { prisma } from "@/lib/db/client";

export type ProjectKey = string;

export type ProjectRecord = {
  key: ProjectKey;
  name: string;
  aliases: string[];
  archived: boolean;
};

export const SEED_PROJECTS: Array<Omit<ProjectRecord, "archived">> = [
  { key: "dina", name: "Dina", aliases: ["dina project"] },
  { key: "beacon", name: "Beacon", aliases: [] },
  {
    key: "4studentlives",
    name: "4StudentLives",
    aliases: ["4 student lives", "four student lives", "4sl"],
  },
  {
    key: "metabolicos",
    name: "MetabolicOS",
    aliases: ["metabolic", "metabolic os"],
  },
  {
    key: "hidden_guardians",
    name: "Hidden Guardians",
    aliases: ["hidden guardians"],
  },
  {
    key: "clifsmama",
    name: "ClifsMama",
    aliases: ["clifs mama", "cliffsmana"],
  },
  {
    key: "regi",
    name: "Regi",
    aliases: ["reggie", "regi-app", "regi app", "regi project"],
  },
];

let cache: ProjectRecord[] | null = null;

function seedRecords(): ProjectRecord[] {
  return SEED_PROJECTS.map((project) => ({ ...project, archived: false }));
}

function parseAliases(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeQuery(input: string): { raw: string; stripped: string; compact: string } {
  const raw = input.trim().toLowerCase().replace(/\s+/g, " ");
  const stripped = raw
    .replace(/\bprojects?\b/g, "")
    .replace(/\btasks?\b/g, "")
    .replace(/\bcommitments?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { raw, stripped, compact: stripped.replace(/[\s_-]+/g, "") };
}

function matchProject(input: string, projects: ProjectRecord[]): ProjectKey | null {
  const { raw, stripped, compact } = normalizeQuery(input);
  if (!raw) return null;

  for (const project of projects) {
    const names = [project.key, project.name.toLowerCase(), ...project.aliases.map((a) => a.toLowerCase())];
    if (names.includes(raw) || names.includes(stripped)) return project.key;
  }

  for (const project of projects) {
    const keyWords = project.key.replace(/_/g, " ");
    const nameWords = project.name.toLowerCase();
    if (raw.includes(keyWords) || stripped.includes(keyWords)) return project.key;
    if (raw.includes(nameWords) || stripped.includes(nameWords)) return project.key;
  }

  for (const project of projects) {
    if (compact === project.key.replace(/_/g, "")) return project.key;
    if (compact === project.name.toLowerCase().replace(/[\s_-]+/g, "")) return project.key;
  }

  return null;
}

function activeCached(): ProjectRecord[] {
  return (cache ?? seedRecords()).filter((project) => !project.archived);
}

export function invalidateProjectCatalog() {
  cache = null;
}

export function listKnownProjectKeys(): ProjectKey[] {
  return activeCached().map((project) => project.key);
}

export function listKnownProjects(): ProjectRecord[] {
  return activeCached();
}

export function displayProjectName(key: ProjectKey): string {
  return (
    activeCached().find((project) => project.key === key)?.name ??
    seedRecords().find((project) => project.key === key)?.name ??
    key
  );
}

export function resolveProjectKey(input: string): ProjectKey | null {
  return matchProject(input, activeCached());
}

export function assertProjectKey(input: string): ProjectKey {
  const key = resolveProjectKey(input);
  if (!key) {
    throw new Error(
      `Unknown project: "${input}". Known: ${listKnownProjects().map((p) => p.name).join(", ")}`,
    );
  }
  return key;
}

export function projectKeyFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

async function loadFromDb(): Promise<ProjectRecord[]> {
  const rows = await prisma.project.findMany({ orderBy: { name: "asc" } });
  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    aliases: parseAliases(row.aliasesJson),
    archived: Boolean(row.archivedAt),
  }));
}

async function seedProjectsIfNeeded() {
  for (const project of SEED_PROJECTS) {
    await prisma.project.upsert({
      where: { key: project.key },
      create: {
        key: project.key,
        name: project.name,
        aliasesJson: JSON.stringify(project.aliases),
      },
      update: {},
    });
  }
}

export async function ensureProjectCatalog(): Promise<ProjectRecord[]> {
  if (cache) return activeCached();
  try {
    await seedProjectsIfNeeded();
    cache = await loadFromDb();
  } catch {
    cache = seedRecords();
  }
  return activeCached();
}

export async function createProject(input: {
  name: string;
  key?: string;
  aliases?: string[];
}): Promise<ProjectRecord> {
  const name = input.name.trim();
  if (!name) throw new Error("Project name is required.");
  const key = projectKeyFromName(input.key || name);
  if (key.length < 2) throw new Error("Project key must be at least 2 characters.");

  const aliases = (input.aliases || [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  await ensureProjectCatalog();
  const existing = await prisma.project.findUnique({ where: { key } });
  if (existing && !existing.archivedAt) {
    throw new Error(`Project "${existing.name}" already exists.`);
  }

  const row = existing
    ? await prisma.project.update({
        where: { key },
        data: {
          name,
          aliasesJson: JSON.stringify(aliases),
          archivedAt: null,
        },
      })
    : await prisma.project.create({
        data: {
          key,
          name,
          aliasesJson: JSON.stringify(aliases),
        },
      });

  invalidateProjectCatalog();
  await ensureProjectCatalog();
  return {
    key: row.key,
    name: row.name,
    aliases: parseAliases(row.aliasesJson),
    archived: false,
  };
}

export async function archiveProject(input: string): Promise<ProjectRecord> {
  await ensureProjectCatalog();
  const key = resolveProjectKey(input);
  if (!key) throw new Error(`Unknown project: "${input}".`);

  const row = await prisma.project.update({
    where: { key },
    data: { archivedAt: new Date() },
  });
  invalidateProjectCatalog();
  await ensureProjectCatalog();
  return {
    key: row.key,
    name: row.name,
    aliases: parseAliases(row.aliasesJson),
    archived: true,
  };
}
