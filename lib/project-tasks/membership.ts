import { prisma } from "@/lib/db/client";
import type { AuthUser } from "@/lib/auth/types";
import {
  assertProjectKey,
  displayProjectName,
  ensureProjectCatalog,
  listKnownProjectKeys,
  resolveProjectKey,
  type ProjectKey,
} from "@/lib/project-tasks/keys";

export type AssignableUser = {
  id: string;
  name: string;
};

function personName(user: { name: string; username: string }): string {
  return user.name.trim() || user.username.trim();
}

/** People who can own a task on this project: members, plus owners. */
export async function listAssignableUsers(
  projectKey: string,
): Promise<AssignableUser[]> {
  await ensureProjectCatalog();
  const key = assertProjectKey(projectKey);
  const [members, owners] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectKey: key },
      select: { user: { select: { id: true, name: true, username: true } } },
    }),
    prisma.user.findMany({
      where: { role: "owner" },
      select: { id: true, name: true, username: true },
    }),
  ]);
  const byId = new Map<string, AssignableUser>();
  for (const owner of owners) {
    const name = personName(owner);
    if (name) byId.set(owner.id, { id: owner.id, name });
  }
  for (const member of members) {
    const name = personName(member.user);
    if (name) byId.set(member.user.id, { id: member.user.id, name });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Assignable people, plus anyone already assigned so the picker can show them. */
export async function listBoardPeople(
  projectKey: string,
  extraUserIds: Array<string | null | undefined> = [],
): Promise<AssignableUser[]> {
  const people = await listAssignableUsers(projectKey);
  const known = new Set(people.map((person) => person.id));
  const missing = [
    ...new Set(
      extraUserIds.filter((id): id is string => Boolean(id && !known.has(id))),
    ),
  ];
  if (!missing.length) return people;
  const extras = await prisma.user.findMany({
    where: { id: { in: missing } },
    select: { id: true, name: true, username: true },
  });
  for (const extra of extras) {
    const name = personName(extra);
    if (name) people.push({ id: extra.id, name });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return people;
}

export async function listMemberProjectKeys(
  user: AuthUser,
): Promise<ProjectKey[]> {
  await ensureProjectCatalog();
  if (user.role === "owner") return listKnownProjectKeys();
  const rows = await prisma.projectMember.findMany({
    where: { userId: user.id },
    select: { projectKey: true },
  });
  const keys: ProjectKey[] = [];
  for (const row of rows) {
    const key = resolveProjectKey(row.projectKey);
    if (key) keys.push(key);
  }
  return keys;
}

export async function userCanAccessProject(
  user: AuthUser,
  project: string,
): Promise<ProjectKey | null> {
  await ensureProjectCatalog();
  const key = resolveProjectKey(project);
  if (!key) return null;
  if (user.role === "owner") return key;
  const row = await prisma.projectMember.findUnique({
    where: { userId_projectKey: { userId: user.id, projectKey: key } },
  });
  return row ? key : null;
}

export async function assertUserCanAccessProject(
  user: AuthUser,
  project: string,
): Promise<ProjectKey> {
  const key = await userCanAccessProject(user, project);
  if (!key) {
    throw new Error(
      `Unknown project or no access: "${project}".`,
    );
  }
  return key;
}

export async function assertUserCanAccessProjectKey(
  user: AuthUser,
  projectKey: string,
): Promise<ProjectKey> {
  return assertUserCanAccessProject(user, projectKey);
}

export function formatProjectList(keys: ProjectKey[]): string {
  return keys.map(displayProjectName).join(", ");
}

export { assertProjectKey };
