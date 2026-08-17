import { getRequestUser } from "@/lib/auth/context";
import {
  approveMemory,
  archiveMemory,
  createOrCorrectMemory,
  getMemory,
  listMemories,
  mergeMemories,
  updateMemory,
} from "@/lib/memory/store";
import { retrieveRelevantMemories } from "@/lib/memory/retrieve";
import { confidenceFromLabel } from "@/lib/memory/policy";
import {
  canMemberWriteCategory,
  memberCanAccessMemory,
  memberCanWriteMemory,
  memoryScopeForUser,
  type MemoryScope,
} from "@/lib/memory/scope";
import { MEMORY_CATEGORIES, MEMORY_IMPORTANCE } from "@/lib/memory/types";
import { logger } from "@/lib/logger";
import { ensureProjectCatalog, resolveProjectKey } from "@/lib/project-tasks/keys";
import { userCanAccessProject } from "@/lib/project-tasks/membership";

async function currentScope(): Promise<MemoryScope> {
  const user = getRequestUser();
  if (!user) throw new Error("Not authenticated.");
  return memoryScopeForUser(user);
}

async function assertReadable(id: string) {
  const memory = await getMemory(id);
  if (!memory) throw new Error("Memory not found.");
  const user = getRequestUser();
  if (!user) throw new Error("Not authenticated.");
  if (user.role === "owner") return memory;
  const scope = await memoryScopeForUser(user);
  if (!memberCanAccessMemory(memory, scope)) {
    throw new Error("Memory not found.");
  }
  return memory;
}

function resolveConfidence(args: Record<string, unknown>): number {
  if (typeof args.confidence === "number") return args.confidence;
  if (typeof args.confidenceLabel === "string") {
    return confidenceFromLabel(args.confidenceLabel);
  }
  return 0.7;
}

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Memory tool failed",
  });
}

const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<string>
> = {
  search_memory: async (args) => {
    const query = String(args.query || "");
    const memories = await retrieveRelevantMemories(query, {
      limit: typeof args.limit === "number" ? args.limit : 12,
      categories: Array.isArray(args.categories)
        ? (args.categories as string[])
        : undefined,
      scope: await currentScope(),
    });
    return ok({ memories, count: memories.length });
  },
  list_memories: async (args) => {
    const memories = await listMemories({
      category: typeof args.category === "string" ? args.category : undefined,
      status: typeof args.status === "string" ? args.status : undefined,
      limit: typeof args.limit === "number" ? args.limit : 50,
      scope: await currentScope(),
    });
    return ok({ memories, categories: MEMORY_CATEGORIES });
  },
  remember: async (args) => {
    const category = String(args.category || "");
    if (!MEMORY_CATEGORIES.includes(category as (typeof MEMORY_CATEGORIES)[number])) {
      return fail(new Error(`Invalid memory category: ${category}`));
    }
    const user = getRequestUser();
    if (user?.role === "member" && !canMemberWriteCategory(category)) {
      return fail(
        new Error(
          "Members can only store project, decision, commitment, or people memories.",
        ),
      );
    }
    let projectKey =
      typeof args.project === "string"
        ? resolveProjectKey(args.project)
        : null;
    if (user?.role === "member") {
      if (!projectKey) {
        return fail(new Error("project is required for shared project memory."));
      }
      const allowed = await userCanAccessProject(user, projectKey);
      if (!allowed) return fail(new Error(`No access to project "${projectKey}".`));
      projectKey = allowed;
    }
    const memory = await createOrCorrectMemory(
      {
        category: category as (typeof MEMORY_CATEGORIES)[number],
        title: String(args.title || "").trim(),
        content: String(args.content || "").trim(),
        source: "chat",
        confidence: resolveConfidence(args),
        importance: MEMORY_IMPORTANCE.includes(
          args.importance as (typeof MEMORY_IMPORTANCE)[number],
        )
          ? (args.importance as (typeof MEMORY_IMPORTANCE)[number])
          : "normal",
        correctId:
          typeof args.correctId === "string" ? args.correctId : undefined,
        relatedIds: Array.isArray(args.relatedIds)
          ? (args.relatedIds as string[])
          : undefined,
        ownerUserId: user?.id ?? null,
        projectKey,
      },
      { scope: await currentScope() },
    );
    const needsApproval = memory.status === "pending_approval";
    return ok({
      memory,
      corrected: Boolean(args.correctId),
      needsApproval,
      approvalPrompt: needsApproval
        ? `I noticed something worth remembering permanently (${memory.title}). Approve?`
        : undefined,
    });
  },
  approve_memory: async (args) => {
    const user = getRequestUser();
    if (user && user.role !== "owner") {
      return fail(new Error("Only the owner can approve memories."));
    }
    const memory = await approveMemory(String(args.id || ""));
    return ok({ memory, approved: true });
  },
  correct_memory: async (args) => {
    const id = String(args.id || "");
    const existing = await assertReadable(id);
    if (!existing) return fail(new Error("Memory not found."));
    const user = getRequestUser();
    if (user?.role === "member") {
      const scope = await memoryScopeForUser(user);
      if (!memberCanWriteMemory(existing, scope)) {
        return fail(new Error("Memory not found."));
      }
    }
    if (
      user?.role === "member" &&
      typeof args.category === "string" &&
      !canMemberWriteCategory(args.category)
    ) {
      return fail(
        new Error(
          "Members can only store project, decision, commitment, or people memories.",
        ),
      );
    }
    const memory = await updateMemory(id, {
      title: typeof args.title === "string" ? args.title : undefined,
      content: typeof args.content === "string" ? args.content : undefined,
      category:
        typeof args.category === "string" &&
        MEMORY_CATEGORIES.includes(
          args.category as (typeof MEMORY_CATEGORIES)[number],
        )
          ? (args.category as (typeof MEMORY_CATEGORIES)[number])
          : undefined,
      confidence:
        typeof args.confidence === "number" ? args.confidence : undefined,
      importance:
        typeof args.importance === "string" &&
        MEMORY_IMPORTANCE.includes(
          args.importance as (typeof MEMORY_IMPORTANCE)[number],
        )
          ? (args.importance as (typeof MEMORY_IMPORTANCE)[number])
          : undefined,
      source: "correction",
      // correct_memory explicitly activates (unlike PATCH update).
      status: "active",
    });
    return ok({ memory });
  },
  archive_memory: async (args) => {
    const user = getRequestUser();
    if (user && user.role !== "owner") {
      return fail(new Error("Only the owner can archive memories."));
    }
    const memory = await archiveMemory(String(args.id || ""));
    return ok({ memory });
  },
  merge_memories: async (args) => {
    const user = getRequestUser();
    if (user && user.role !== "owner") {
      return fail(new Error("Only the owner can merge memories."));
    }
    const survivorId = String(args.survivorId || "");
    const mergeIds = Array.isArray(args.mergeIds)
      ? (args.mergeIds as string[])
      : [];
    const memory = await mergeMemories({
      survivorId,
      mergeIds,
      title: typeof args.title === "string" ? args.title : undefined,
      content: typeof args.content === "string" ? args.content : undefined,
      confidence:
        typeof args.confidence === "number" ? args.confidence : undefined,
    });
    return ok({ memory });
  },
};

export function listMemoryToolNames() {
  return Object.keys(handlers);
}

export async function executeMemoryTool(
  name: string,
  argsJson: string,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) return fail(new Error(`Unknown memory tool: ${name}`));
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }
  try {
    await ensureProjectCatalog();
    return await handler(args);
  } catch (error) {
    logger.error("memory_tool_failed", {
      tool: name,
      error: error instanceof Error ? error.message : "unknown",
    });
    return fail(error);
  }
}
