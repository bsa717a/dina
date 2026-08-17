import { prisma } from "@/lib/db/client";
import { findUserByUsername } from "@/lib/auth/users";
import { normalizeUsername } from "@/lib/auth/password";
import { toAuthUser, type AuthUser } from "@/lib/auth/types";
import {
  displayProjectName,
  ensureProjectCatalog,
  listKnownProjects,
  resolveProjectKey,
  type ProjectKey,
} from "@/lib/project-tasks/keys";
import { listMemberProjectKeys } from "@/lib/project-tasks/membership";

export type TeammateSummary = {
  id: string;
  name: string;
  username: string;
  assistantName: string;
  projectKeys: ProjectKey[];
  projects: string[];
};

export async function listTeammates(): Promise<TeammateSummary[]> {
  const rows = await prisma.user.findMany({
    where: { role: "member" },
    orderBy: { name: "asc" },
  });
  const summaries: TeammateSummary[] = [];
  for (const row of rows) {
    const user = toAuthUser(row);
    const projectKeys = await listMemberProjectKeys(user);
    summaries.push({
      id: user.id,
      name: user.name,
      username: user.username,
      assistantName: user.assistantName,
      projectKeys,
      projects: projectKeys.map(displayProjectName),
    });
  }
  return summaries;
}

export async function findTeammate(query: string): Promise<AuthUser> {
  const raw = query.trim();
  if (!raw) throw new Error("Name or username is required.");

  const byUsername = await findUserByUsername(raw);
  if (byUsername) {
    if (byUsername.role !== "member") {
      throw new Error("Only teammates can be added to projects this way.");
    }
    return byUsername;
  }

  const matches = await prisma.user.findMany({
    where: {
      role: "member",
      OR: [
        { name: { contains: raw, mode: "insensitive" } },
        { username: { contains: normalizeUsername(raw), mode: "insensitive" } },
      ],
    },
  });
  if (matches.length === 1) return toAuthUser(matches[0]);
  if (matches.length > 1) {
    const names = matches.map((row) => `${row.name} (${row.username})`).join(", ");
    throw new Error(`Several teammates match "${raw}": ${names}. Use a username.`);
  }
  throw new Error(`No teammate found for "${raw}". Use list_teammates.`);
}

export async function addTeammateToProjects(input: {
  query: string;
  projects: string[];
}): Promise<{
  user: { id: string; name: string; username: string };
  added: string[];
  alreadyHad: string[];
  projects: string[];
}> {
  await ensureProjectCatalog();
  const user = await findTeammate(input.query);
  const keys = [
    ...new Set(
      input.projects
        .map((project) => resolveProjectKey(project))
        .filter((key): key is ProjectKey => Boolean(key)),
    ),
  ];
  if (!keys.length) {
    throw new Error(
      `At least one known project is required. Known: ${listKnownProjects().map((p) => p.name).join(", ")}`,
    );
  }

  const existing = new Set(await listMemberProjectKeys(user));
  const toAdd = keys.filter((key) => !existing.has(key));
  if (toAdd.length) {
    await prisma.projectMember.createMany({
      data: toAdd.map((projectKey) => ({
        userId: user.id,
        projectKey,
        role: "member",
      })),
      skipDuplicates: true,
    });
  }

  const all = await listMemberProjectKeys(user);
  return {
    user: { id: user.id, name: user.name, username: user.username },
    added: toAdd.map(displayProjectName),
    alreadyHad: keys.filter((key) => existing.has(key)).map(displayProjectName),
    projects: all.map(displayProjectName),
  };
}
