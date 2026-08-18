import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "@/lib/auth/types";
import { displayProjectName } from "@/lib/project-tasks/keys";
import { userCanAccessProject } from "@/lib/project-tasks/membership";

export type ActiveProject = {
  key: string;
  name: string;
};

const store = new AsyncLocalStorage<ActiveProject>();

export function runWithActiveProject<T>(
  project: ActiveProject | null | undefined,
  fn: () => T,
): T {
  if (!project) return fn();
  return store.run(project, fn);
}

export function getActiveProject(): ActiveProject | null {
  return store.getStore() ?? null;
}

/** Named project from tool args, else the user's selected project. */
export function projectArgOrActive(args: Record<string, unknown>): string {
  if (typeof args.project === "string" && args.project.trim()) {
    return args.project.trim();
  }
  const active = getActiveProject();
  if (active) return active.key;
  throw new Error("Select a project or name one.");
}

export function projectNamesFromArgsOrActive(
  args: Record<string, unknown>,
): string[] {
  const listed = Array.isArray(args.projects)
    ? args.projects.filter((value): value is string => typeof value === "string")
    : [];
  if (listed.length) return listed;
  const active = getActiveProject();
  return active ? [active.name] : [];
}

export async function resolveActiveProjectForUser(
  user: AuthUser,
  raw?: string | null,
): Promise<ActiveProject | null> {
  if (!raw?.trim()) return null;
  const key = await userCanAccessProject(user, raw.trim());
  if (!key) return null;
  return { key, name: displayProjectName(key) };
}
