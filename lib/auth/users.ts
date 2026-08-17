import { prisma } from "@/lib/db/client";
import { verifyAccessCode } from "@/lib/auth/access-code";
import {
  hashPassword,
  isValidPassword,
  isValidUsername,
  normalizeUsername,
  verifyPassword,
} from "@/lib/auth/password";
import {
  needsOnboarding,
  toAuthUser,
  type AuthUser,
  type UserRole,
} from "@/lib/auth/types";
import {
  ensureProjectCatalog,
  listKnownProjectKeys,
  resolveProjectKey,
} from "@/lib/project-tasks/keys";
import { getAccessCode } from "@/lib/env";

const OWNER_NAME = "Derek";
const OWNER_USERNAME = "derek";
const OWNER_ASSISTANT = "Dina";

export async function getUserById(id: string): Promise<AuthUser | null> {
  const row = await prisma.user.findUnique({ where: { id } });
  return row ? toAuthUser(row) : null;
}

export async function findUserByUsername(
  username: string,
): Promise<AuthUser | null> {
  const row = await prisma.user.findUnique({
    where: { username: normalizeUsername(username) },
  });
  return row ? toAuthUser(row) : null;
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const normalized = normalizeUsername(username);
  const row = await prisma.user.findUnique({ where: { username: normalized } });
  if (row) {
    return verifyPassword(password, row.passwordHash) ? toAuthUser(row) : null;
  }

  const count = await prisma.user.count();
  if (count === 0 && normalized === OWNER_USERNAME) {
    try {
      const envCode = getAccessCode();
      if (verifyAccessCode(password, envCode)) {
        return seedOwner({ password: envCode });
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function seedOwner(input?: {
  password?: string;
  name?: string;
}): Promise<AuthUser> {
  const existing = await prisma.user.findFirst({ where: { role: "owner" } });
  if (existing) return toAuthUser(existing);

  const password = input?.password ?? getAccessCode();
  const user = await prisma.user.create({
    data: {
      name: input?.name ?? OWNER_NAME,
      username: OWNER_USERNAME,
      role: "owner",
      assistantName: OWNER_ASSISTANT,
      assistantPersona: "",
      assistantKey: "dina",
      passwordHash: hashPassword(password),
      mustChangePassword: false,
    },
  });

  await ensureProjectCatalog();
  await prisma.projectMember.createMany({
    data: listKnownProjectKeys().map((projectKey) => ({
      userId: user.id,
      projectKey,
      role: "owner",
    })),
    skipDuplicates: true,
  });

  return toAuthUser(user);
}

export async function ensureOwnerSeeded(): Promise<AuthUser> {
  const existing = await prisma.user.findFirst({ where: { role: "owner" } });
  if (existing) return toAuthUser(existing);
  return seedOwner();
}

export async function createMember(input: {
  name: string;
  username: string;
  password: string;
  projectKeys: string[];
}): Promise<AuthUser> {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const username = normalizeUsername(input.username);
  if (!isValidUsername(username)) {
    throw new Error("Username must be 2–32 letters, numbers, or underscores.");
  }
  if (!isValidPassword(input.password)) {
    throw new Error("Password must be at least 10 characters.");
  }

  await ensureProjectCatalog();
  const keys = [
    ...new Set(
      input.projectKeys
        .map((key) => resolveProjectKey(key))
        .filter((key): key is string => Boolean(key)),
    ),
  ];
  if (!keys.length) {
    throw new Error(
      `At least one known project is required. Known: ${listKnownProjectKeys().join(", ")}`,
    );
  }

  const taken = await prisma.user.findUnique({ where: { username } });
  if (taken) throw new Error(`Username "${username}" is already taken.`);

  const user = await prisma.user.create({
    data: {
      name,
      username,
      role: "member",
      assistantName: "",
      assistantPersona: "",
      assistantKey: null,
      passwordHash: hashPassword(input.password),
      mustChangePassword: true,
      memberships: {
        create: keys.map((projectKey) => ({
          projectKey,
          role: "member",
        })),
      },
    },
  });

  return toAuthUser(user);
}

export async function completeOnboarding(input: {
  userId: string;
  password: string;
  assistantKey: string;
}): Promise<AuthUser> {
  const user = await getUserById(input.userId);
  if (!user) throw new Error("User not found.");
  if (user.role !== "member") {
    throw new Error("Only teammates complete onboarding.");
  }
  if (!needsOnboarding(user)) {
    throw new Error("Onboarding is already complete.");
  }
  if (!isValidPassword(input.password)) {
    throw new Error("Password must be at least 10 characters.");
  }

  const { formatAssistantPersona, getAssistantProfile, isMemberAssistantKey } =
    await import("@/lib/assistants/catalog");
  if (!isMemberAssistantKey(input.assistantKey)) {
    throw new Error("Choose a valid assistant personality.");
  }
  const profile = getAssistantProfile(input.assistantKey);
  if (!profile) throw new Error("Choose a valid assistant personality.");

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(input.password),
      mustChangePassword: false,
      assistantKey: profile.key,
      assistantName: profile.name,
      assistantPersona: formatAssistantPersona(profile),
    },
  });
  return toAuthUser(updated);
}

export function isOwner(user: { role: UserRole } | null | undefined): boolean {
  return user?.role === "owner";
}

export { needsOnboarding };
