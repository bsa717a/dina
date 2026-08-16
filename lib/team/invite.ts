import { generateTempPassword, isValidUsername, normalizeUsername } from "@/lib/auth/password";
import { createMember } from "@/lib/auth/users";
import { getAppUrl } from "@/lib/env";
import { getMicrosoftConfig, isMicrosoftConfigured } from "@/lib/microsoft/config";
import { graphRequest, userPath } from "@/lib/microsoft/graph";
import {
  PROJECT_KEYS,
  displayProjectName,
  resolveProjectKey,
  type ProjectKey,
} from "@/lib/project-tasks/keys";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidInviteEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim()) && value.trim().length <= 200;
}

export function usernameFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return slug;
}

export function resolveInviteProjects(projects: string[]): ProjectKey[] {
  const keys = new Set<ProjectKey>();
  for (const raw of projects) {
    const key = resolveProjectKey(raw);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function buildInviteEmail(input: {
  name: string;
  username: string;
  password: string;
  projectKeys: ProjectKey[];
  appUrl: string;
}): { subject: string; body: string } {
  const loginUrl = `${input.appUrl}/login`;
  const projectList = input.projectKeys.map(displayProjectName).join(", ");
  return {
    subject: "Your Dina login",
    body: [
      `Hi ${input.name.split(" ")[0] || input.name},`,
      "",
      "Derek set up an account for you.",
      "",
      `Sign in: ${loginUrl}`,
      `Username: ${input.username}`,
      `Temporary password: ${input.password}`,
      "",
      `Projects: ${projectList}`,
      "",
      "On first login you'll choose your own password and pick who you'll work with. The temporary password only works once for that setup.",
      "",
      "— Derek",
    ].join("\n"),
  };
}

export async function sendInviteEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  if (!isMicrosoftConfigured()) {
    throw new Error("Microsoft 365 is not configured, so the invite email cannot be sent.");
  }
  await graphRequest(userPath("/sendMail"), {
    method: "POST",
    body: {
      message: {
        subject: input.subject,
        body: { contentType: "Text", content: input.body },
        toRecipients: [{ emailAddress: { address: input.to } }],
      },
      saveToSentItems: true,
    },
  });
}

export async function inviteTeammate(input: {
  name: string;
  email: string;
  username?: string;
  projects: string[];
  sendEmail?: boolean;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const email = input.email.trim();
  if (!isValidInviteEmail(email)) throw new Error("A valid email address is required.");

  const username = normalizeUsername(input.username || usernameFromName(name));
  if (!isValidUsername(username)) {
    throw new Error(
      "Username must be 2–32 letters, numbers, or underscores. Pass username explicitly if the name does not make a good one.",
    );
  }

  const projectKeys = resolveInviteProjects(input.projects);
  if (!projectKeys.length) {
    throw new Error(`At least one known project is required. Known: ${PROJECT_KEYS.join(", ")}`);
  }

  const password = generateTempPassword();
  const user = await createMember({
    name,
    username,
    password,
    projectKeys,
  });

  const message = buildInviteEmail({
    name,
    username: user.username,
    password,
    projectKeys,
    appUrl: getAppUrl(),
  });

  const shouldSend = input.sendEmail !== false;
  let emailed = false;
  let emailError: string | undefined;
  if (shouldSend) {
    try {
      await sendInviteEmail({
        to: email,
        subject: message.subject,
        body: message.body,
      });
      emailed = true;
    } catch (error) {
      emailError =
        error instanceof Error ? error.message : "Failed to send invite email.";
    }
  }

  const from = getMicrosoftConfig()?.userEmail ?? null;
  return {
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email,
      projectKeys,
    },
    temporaryPassword: password,
    loginUrl: `${getAppUrl()}/login`,
    emailed,
    from,
    emailError,
    subject: message.subject,
  };
}
