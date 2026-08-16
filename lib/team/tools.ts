import { getRequestUser } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { inviteTeammate } from "@/lib/team/invite";

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
  invite_teammate: async (args) => {
    const user = getRequestUser();
    if (!user || user.role !== "owner") {
      return fail(new Error("Only Derek can invite teammates."));
    }
    const name = String(args.name || "").trim();
    const email = String(args.email || "").trim();
    const username =
      typeof args.username === "string" ? args.username : undefined;
    const projects = Array.isArray(args.projects)
      ? args.projects.filter((value): value is string => typeof value === "string")
      : [];
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
