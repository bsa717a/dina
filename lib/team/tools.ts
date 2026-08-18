import { getRequestUser } from "@/lib/auth/context";
import { projectNamesFromArgsOrActive } from "@/lib/chat/active-project";
import { logger } from "@/lib/logger";
import {
  archiveProject,
  createProject,
  ensureProjectCatalog,
  listKnownProjects,
} from "@/lib/projects/catalog";
import { inviteTeammate } from "@/lib/team/invite";
import { addTeammateToProjects, listTeammates } from "@/lib/team/members";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Team tool failed",
  });
}

const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<string>
> = {
  list_projects: async () => {
    const user = getRequestUser();
    if (!user || user.role !== "owner") {
      return fail(new Error("Only Derek can list the full project registry."));
    }
    await ensureProjectCatalog();
    const projects = listKnownProjects().map((project) => ({
      key: project.key,
      name: project.name,
      aliases: project.aliases,
    }));
    return ok({ projects, count: projects.length });
  },
  create_project: async (args) => {
    const user = getRequestUser();
    if (!user || user.role !== "owner") {
      return fail(new Error("Only Derek can create projects."));
    }
    const aliases = Array.isArray(args.aliases)
      ? args.aliases.filter((value): value is string => typeof value === "string")
      : [];
    const project = await createProject({
      name: String(args.name || ""),
      key: typeof args.key === "string" ? args.key : undefined,
      aliases,
    });
    return ok({
      project,
      note: `Project ${project.name} is live. Add teammates with add_teammate_to_project. No invite was sent.`,
    });
  },
  archive_project: async (args) => {
    const user = getRequestUser();
    if (!user || user.role !== "owner") {
      return fail(new Error("Only Derek can archive projects."));
    }
    const project = await archiveProject(String(args.project || ""));
    return ok({
      project,
      note: `${project.name} is archived. Tasks and memory remain, but it is no longer on the live project list.`,
    });
  },
  list_teammates: async () => {
    const user = getRequestUser();
    if (!user || user.role !== "owner") {
      return fail(new Error("Only Derek can list teammates."));
    }
    const teammates = await listTeammates();
    return ok({ teammates, count: teammates.length });
  },
  add_teammate_to_project: async (args) => {
    const user = getRequestUser();
    if (!user || user.role !== "owner") {
      return fail(new Error("Only Derek can add teammates to projects."));
    }
    const person = String(args.person || "").trim();
    const projects = projectNamesFromArgsOrActive(args);
    const result = await addTeammateToProjects({ query: person, projects });
    return ok({
      ...result,
      note: result.added.length
        ? `Granted ${result.added.join(", ")} to ${result.user.name}. No invite was sent.`
        : `${result.user.name} already had ${result.alreadyHad.join(", ")}. No invite was sent.`,
    });
  },
  invite_teammate: async (args) => {
    const user = getRequestUser();
    if (!user || user.role !== "owner") {
      return fail(new Error("Only Derek can invite teammates."));
    }
    const name = String(args.name || "").trim();
    const email = String(args.email || "").trim();
    const username =
      typeof args.username === "string" ? args.username : undefined;
    const projects = projectNamesFromArgsOrActive(args);
    const sendEmail =
      typeof args.sendEmail === "boolean" ? args.sendEmail : undefined;

    const result = await inviteTeammate({
      name,
      email,
      username,
      projects,
      sendEmail,
    });
    return ok({
      ...result,
      note: result.emailed
        ? `Invite sent from ${result.from || "Outlook"} to ${email}. Tell Derek the username and that they must finish setup on first login. Quote the temporary password only if he asks.`
        : result.emailError
          ? `Account created, but the email was not sent: ${result.emailError}. Give Derek the username, temporary password, and login URL so he can forward them.`
          : "Account created. Email was not requested. Give Derek the username, temporary password, and login URL.",
    });
  },
};

export function listTeamToolNames() {
  return Object.keys(handlers);
}

export async function executeTeamTool(
  name: string,
  argsJson: string,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) return fail(new Error(`Unknown team tool: ${name}`));
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }
  try {
    return await handler(args);
  } catch (error) {
    logger.error("team_tool_failed", {
      tool: name,
      error: error instanceof Error ? error.message : "unknown",
    });
    return fail(error);
  }
}
