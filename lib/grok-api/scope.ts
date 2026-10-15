/**
 * Per-user Grok tokens can only see that user's projects, the tasks on
 * those projects, and messages to people on those projects (including
 * themselves). The env Dina token is unrestricted. Owners already belong
 * to every project.
 */

import type { AuthUser } from "@/lib/auth/types";
import { toAuthUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db/client";
import type { ServiceActor } from "@/lib/grok-api/auth";
import { forbidden, jsonError } from "@/lib/http";
import {
  listMemberProjectKeys,
  userCanAccessProject,
} from "@/lib/project-tasks/membership";
import {
  ensureProjectCatalog,
  listKnownProjects,
  resolveProjectKey,
  type ProjectRecord,
} from "@/lib/projects/catalog";
import { isValidE164, normalizePhoneNumber } from "@/lib/telnyx/roster";

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
  assistantName: true,
  assistantPersona: true,
  assistantKey: true,
  mustChangePassword: true,
  phoneNumber: true,
  sessionVersion: true,
} as const;

export async function authorizeProject(
  actor: ServiceActor,
  rawKey: string,
): Promise<
  | { ok: true; projectKey: string }
  | { ok: false; status: 403 | 404; error: string }
> {
  await ensureProjectCatalog();
  const projectKey = resolveProjectKey(rawKey);
  if (!projectKey) {
    return { ok: false, status: 404, error: `Unknown project: "${rawKey}"` };
  }
  if (actor.kind === "service") return { ok: true, projectKey };
  const allowed = await userCanAccessProject(actor.user, projectKey);
  if (!allowed) {
    return { ok: false, status: 403, error: "Not a member of this project" };
  }
  return { ok: true, projectKey };
}

export async function projectsVisibleToActor(
  actor: ServiceActor,
): Promise<ProjectRecord[]> {
  await ensureProjectCatalog();
  const projects = listKnownProjects();
  if (actor.kind === "service") return projects;
  const keys = new Set(await listMemberProjectKeys(actor.user));
  return projects.filter((project) => keys.has(project.key));
}

export async function visibleProjectKeys(
  actor: ServiceActor,
  keys: string[],
): Promise<string[]> {
  if (actor.kind === "service" || actor.user.role === "owner") return keys;
  const mine = new Set(await listMemberProjectKeys(actor.user));
  return keys.filter((key) => mine.has(key));
}

async function sharesProject(actor: AuthUser, target: AuthUser): Promise<boolean> {
  const mine = new Set(await listMemberProjectKeys(actor));
  const theirs = await listMemberProjectKeys(target);
  return theirs.some((key) => mine.has(key));
}

export async function actorCanReachUser(
  actor: ServiceActor,
  userId: string,
): Promise<"ok" | "missing" | "forbidden"> {
  if (actor.kind === "service") return "ok";
  if (actor.user.id === userId) return "ok";
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT,
  });
  if (!target) return "missing";
  if (actor.user.role === "owner") return "ok";
  return (await sharesProject(actor.user, toAuthUser(target))) ? "ok" : "forbidden";
}

export async function reachUserResponse(
  actor: ServiceActor,
  userId: string,
): Promise<Response | null> {
  const reach = await actorCanReachUser(actor, userId);
  if (reach === "ok") return null;
  if (reach === "missing") return jsonError("User not found.", 404);
  return forbidden("Not allowed to access this user");
}

export async function reachPhoneResponse(
  actor: ServiceActor,
  rawPhone: string,
): Promise<Response | null> {
  if (actor.kind === "service") return null;
  const phoneNumber = normalizePhoneNumber(rawPhone);
  if (!isValidE164(phoneNumber)) {
    return forbidden("Not allowed to message this number");
  }
  const row = await prisma.user.findUnique({
    where: { phoneNumber },
    select: { id: true },
  });
  if (!row) return forbidden("Not allowed to message this number");
  return reachUserResponse(actor, row.id);
}
