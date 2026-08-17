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
