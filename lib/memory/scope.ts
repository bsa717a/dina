import type { AuthUser } from "@/lib/auth/types";
import type { MemoryCategory } from "@/lib/memory/types";
import type { ProjectKey } from "@/lib/project-tasks/keys";
import { listMemberProjectKeys } from "@/lib/project-tasks/membership";

export const MEMBER_MEMORY_CATEGORIES: MemoryCategory[] = [
  "projects",
  "decisions",
  "commitments",
  "people",
];

export type MemoryScope = {
  role: "owner" | "member";
  userId: string;
  projectKeys: string[];
};

export async function memoryScopeForUser(
  user: AuthUser,
): Promise<MemoryScope> {
  const projectKeys = await listMemberProjectKeys(user);
  return {
    role: user.role,
    userId: user.id,
    projectKeys,
  };
}

export function memoryVisibilityWhere(scope?: MemoryScope) {
  if (!scope || scope.role === "owner") return {};
  return {
    OR: [
      { ownerUserId: scope.userId },
      ...(scope.projectKeys.length
        ? [
            {
              AND: [
                { projectKey: { in: scope.projectKeys } },
                { category: { in: MEMBER_MEMORY_CATEGORIES } },
              ],
            },
          ]
        : []),
    ],
  };
}

export function isMemberMemoryCategory(
  category: string,
): category is MemoryCategory {
  return MEMBER_MEMORY_CATEGORIES.includes(category as MemoryCategory);
}

export function canMemberWriteCategory(category: string): boolean {
  return isMemberMemoryCategory(category);
}

export function memberCanAccessMemory(
  memory: {
    ownerUserId?: string | null;
    projectKey?: string | null;
    category: string;
  },
  scope: MemoryScope,
): boolean {
  if (memory.ownerUserId === scope.userId) return true;
  return Boolean(
    memory.projectKey &&
      scope.projectKeys.includes(memory.projectKey) &&
      isMemberMemoryCategory(memory.category),
  );
}

export function memberCanWriteMemory(
  memory: { ownerUserId?: string | null },
  scope: MemoryScope,
): boolean {
  return memory.ownerUserId === scope.userId;
}

export type { ProjectKey };
