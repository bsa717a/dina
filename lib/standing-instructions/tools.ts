import { getRequestUser } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import {
  archiveStandingInstruction,
  listStandingInstructions,
  setStandingInstruction,
} from "@/lib/standing-instructions/store";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  return JSON.stringify({
    ok: false,
    error:
      error instanceof Error ? error.message : "Standing instruction tool failed",
  });
}

function requireOwner() {
  const user = getRequestUser();
  if (!user) throw new Error("Not authenticated.");
  if (user.role !== "owner") {
    throw new Error("Only Derek can change standing instructions.");
  }
}

function publicItem(item: { title: string; content: string; status: string }) {
  return {
    title: item.title,
    content: item.content,
    status: item.status,
  };
}

const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<string>
> = {
  list_standing_instructions: async (args) => {
    requireOwner();
    const includeArchived = Boolean(args.includeArchived);
    const items = includeArchived
      ? await listStandingInstructions()
      : await listStandingInstructions({ status: "active" });
    return ok({
      instructions: items.map(publicItem),
      count: items.length,
    });
  },
  set_standing_instruction: async (args) => {
    requireOwner();
    const item = await setStandingInstruction({
      title: String(args.title || ""),
      content: String(args.content || ""),
      source: "chat",
    });
    return ok({ instruction: publicItem(item), saved: true });
  },
  archive_standing_instruction: async (args) => {
    requireOwner();
    const item = await archiveStandingInstruction(String(args.title || ""));
    return ok({ instruction: publicItem(item), archived: true });
  },
};

export function listStandingInstructionToolNames() {
  return Object.keys(handlers);
}

export async function executeStandingInstructionTool(
  name: string,
  argsJson: string,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) {
    return fail(new Error(`Unknown standing instruction tool: ${name}`));
  }
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }
  try {
    return await handler(args);
  } catch (error) {
    logger.error("standing_instruction_tool_failed", {
      tool: name,
      error: error instanceof Error ? error.message : "unknown",
    });
    return fail(error);
  }
}
