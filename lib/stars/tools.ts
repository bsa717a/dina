import { getRequestUser } from "@/lib/auth/context";
import {
  getStarredMessage,
  listStarredMessages,
  setMessageStarred,
  STAR_SOFT_CAP,
} from "@/lib/stars/store";

function requireUserId() {
  const user = getRequestUser();
  if (!user) throw new Error("Not authenticated.");
  return user.id;
}

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown, extra?: Record<string, unknown>) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

type Handler = (args: Record<string, unknown>) => Promise<string>;

const handlers: Record<string, Handler> = {
  list_starred_messages: async (args) => {
    const limit = typeof args.limit === "number" ? args.limit : STAR_SOFT_CAP;
    const items = await listStarredMessages(requireUserId(), limit);
    return ok({
      count: items.length,
      cap: STAR_SOFT_CAP,
      note: "Use get_starred_message with an id for full verbatim content. Prefer these over paraphrasing chat history.",
      items,
    });
  },
  get_starred_message: async (args) => {
    const id = String(args.messageId || args.id || "").trim();
    if (!id) return fail(new Error("messageId is required."));
    const item = await getStarredMessage(id, requireUserId());
    if (!item) return fail(new Error("Starred message not found."));
    return ok({
      item,
      note: "Content is verbatim. When exporting to Word or Memory, paste it in full — do not summarize.",
    });
  },
  unstar_message: async (args) => {
    const id = String(args.messageId || args.id || "").trim();
    if (!id) return fail(new Error("messageId is required."));
    const result = await setMessageStarred(id, false, requireUserId());
    if (!result.ok) return fail(new Error(result.error), { status: result.status });
    return ok({
      unstarred: true,
      messageId: id,
      count: result.count,
      cap: result.cap,
    });
  },
};

export function listStarToolNames() {
  return Object.keys(handlers);
}

export async function executeStarTool(name: string, argsJson: string) {
  const handler = handlers[name];
  if (!handler) return fail(new Error(`Unknown star tool: ${name}`));
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }
  try {
    return await handler(args);
  } catch (error) {
    return fail(error);
  }
}
