/**
 * Shared Piper chat turn — the same project brain the web text box uses.
 *
 * Slack inbound and POST /api/chat both call runChatTurn so tool use,
 * memory, and the active-project task ledger stay on one path.
 * There is no parallel Slack brain and no Grok Bot handoff here.
 */

import { runWithAuthUser } from "@/lib/auth/context";
import type { AuthUser } from "@/lib/auth/types";
import { getModelProvider } from "@/lib/ai/provider";
import type { ProviderAttachment } from "@/lib/ai/provider";
import {
  createMessage,
  getOrCreateDefaultConversation,
  listMessagesForProvider,
} from "@/lib/db/conversations";
import { memoryScopeForUser } from "@/lib/memory/scope";
import {
  type ActiveProject,
  runWithActiveProject,
} from "@/lib/chat/active-project";
import {
  isRemainingTasksChatContent,
  stripTaskIdsFromChatContent,
} from "@/lib/project-tasks/format";
import { loadRemainingTasksBlock } from "@/lib/project-tasks/runtime";
import { displayProjectName } from "@/lib/project-tasks/keys";
import { listMemberProjectKeys } from "@/lib/project-tasks/membership";
import { logger } from "@/lib/logger";
import {
  formatMemoriesForPrompt,
  retrieveRelevantMemories,
} from "@/lib/memory/retrieve";
import { seedDerekProfileMemories } from "@/lib/memory/seed-derek-profile";
import { seedDerekProjectMemories } from "@/lib/memory/seed-derek-projects";
import { seedDinaMemoryRuleMemories } from "@/lib/memory/seed-dina-memory-rules";
import { seedDinaOperatingManualMemories } from "@/lib/memory/seed-dina-operating-manual";
import { seedDinaProjectTasks } from "@/lib/project-tasks/seed-dina-tasks";
import {
  formatStandingInstructionArchivedMessage,
  formatStandingInstructionHelpMessage,
  formatStandingInstructionMissingMessage,
  formatStandingInstructionSavedMessage,
  formatStandingInstructionsMessage,
  formatStandingInstructionsRuntime,
  isStandingInstructionChatContent,
} from "@/lib/standing-instructions/format";
import { parseStandingInstructionRequest } from "@/lib/standing-instructions/parse";
import { seedStandingInstructions } from "@/lib/standing-instructions/seed";
import {
  archiveStandingInstruction,
  listActiveStandingInstructions,
  setStandingInstruction,
} from "@/lib/standing-instructions/store";
import {
  formatStarredMessagesMessage,
  formatStarredMessagesRuntime,
  isStarredListChatContent,
  isStarredListRequest,
} from "@/lib/stars/format";
import { listStarredMessageRecords } from "@/lib/stars/store";
import { loadProviderAttachments } from "@/lib/uploads/storage";
import { kindFromMime } from "@/lib/uploads/validation";

export const CHAT_SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

export type ChatClientEvent =
  | { type: "status"; status: string; detail?: string }
  | { type: "delta"; text: string }
  | { type: "error"; error: string }
  | {
      type: "done";
      message: {
        id: string;
        role: string;
        content: string;
        createdAt: Date;
        openaiResponseId: string | null;
        usage?: {
          calls: number;
          inputTokens: number;
          outputTokens: number;
          reasoningTokens: number;
          estUsd: number;
          model?: string;
        };
      };
      usage?: {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        estUsd: number;
        model?: string;
      };
      dayUsage?: unknown;
      dayUsageLabel?: string;
    };

export type ChatTurnResult =
  | {
      ok: true;
      text: string;
      conversationId: string;
      code?: undefined;
      error?: undefined;
    }
  | {
      ok: false;
      text: string;
      conversationId?: string;
      error: string;
      code?: "missing_attachments";
    };

export class MissingAttachmentsError extends Error {
  readonly code = "missing_attachments" as const;
  constructor() {
    super("One or more attachments were not found.");
    this.name = "MissingAttachmentsError";
  }
}

export async function runChatTurn(input: {
  user: AuthUser;
  content: string;
  attachmentIds?: string[];
  /** Preloaded attachments (HTTP path checks 404 before opening the SSE). */
  providerAttachments?: ProviderAttachment[];
  activeProject?: ActiveProject | null;
  signal?: AbortSignal;
  onEvent?: (event: ChatClientEvent) => void;
}): Promise<ChatTurnResult> {
  const user = input.user;
  const content = input.content;
  const attachmentIds = input.attachmentIds ?? [];
  const activeProject = input.activeProject ?? null;
  const emit = input.onEvent ?? (() => undefined);

  if (user.role === "owner") {
    await Promise.all([
      seedDerekProfileMemories().catch(() => undefined),
      seedDerekProjectMemories().catch(() => undefined),
      seedDinaMemoryRuleMemories().catch(() => undefined),
      seedDinaOperatingManualMemories().catch(() => undefined),
      seedDinaProjectTasks().catch(() => undefined),
      seedStandingInstructions().catch(() => undefined),
    ]);
  }

  const conversation = await getOrCreateDefaultConversation(
    user.id,
    user.assistantName,
  );

  let providerAttachments = input.providerAttachments;
  if (!providerAttachments) {
    providerAttachments = await loadProviderAttachments(attachmentIds, user.id);
    if (providerAttachments.length !== attachmentIds.length) {
      return {
        ok: false,
        text: "",
        conversationId: conversation.id,
        error: "One or more attachments were not found.",
        code: "missing_attachments",
      };
    }
  }

  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: content || "(attachment)",
    attachmentIds,
  });

  if (
    user.role === "owner" &&
    attachmentIds.length === 0 &&
    isStarredListRequest(content)
  ) {
    const items = await listStarredMessageRecords(user.id);
    return emitDirectReply(
      conversation.id,
      formatStarredMessagesMessage(items),
      emit,
    );
  }

  const standingRequest =
    user.role === "owner" && attachmentIds.length === 0
      ? parseStandingInstructionRequest(content)
      : null;
  if (standingRequest) {
    const markdown = await standingInstructionMarkdown(standingRequest);
    return emitDirectReply(conversation.id, markdown, emit);
  }

  return runWithAuthUser(user, () =>
    runWithActiveProject(activeProject, () =>
      streamModelTurn({
        user,
        content,
        conversationId: conversation.id,
        activeProject,
        providerAttachments,
        signal: input.signal,
        emit,
      }),
    ),
  );
}

export async function streamChatTurnResponse(input: {
  user: AuthUser;
  content: string;
  attachmentIds?: string[];
  activeProject?: ActiveProject | null;
  signal?: AbortSignal;
}): Promise<Response> {
  const attachmentIds = input.attachmentIds ?? [];
  const providerAttachments = await loadProviderAttachments(
    attachmentIds,
    input.user.id,
  );
  if (providerAttachments.length !== attachmentIds.length) {
    const { jsonError } = await import("@/lib/http");
    return jsonError("One or more attachments were not found.", 404);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        await runChatTurn({
          user: input.user,
          content: input.content,
          attachmentIds,
          providerAttachments,
          activeProject: input.activeProject,
          signal: input.signal,
          onEvent: (event) => send(event),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: CHAT_SSE_HEADERS });
}

async function standingInstructionMarkdown(
  standingRequest: NonNullable<ReturnType<typeof parseStandingInstructionRequest>>,
): Promise<string> {
  if (standingRequest.kind === "help") {
    return formatStandingInstructionHelpMessage();
  }
  if (standingRequest.kind === "list") {
    const items = await listActiveStandingInstructions();
    return formatStandingInstructionsMessage(items);
  }
  if (standingRequest.kind === "set") {
    try {
      const item = await setStandingInstruction({
        title: standingRequest.title,
        content: standingRequest.content,
        source: "chat",
      });
      return formatStandingInstructionSavedMessage(item);
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Could not save that standing instruction.";
    }
  }
  try {
    const item = await archiveStandingInstruction(standingRequest.title);
    return formatStandingInstructionArchivedMessage(item.title);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return /not found/i.test(message)
      ? formatStandingInstructionMissingMessage(standingRequest.title)
      : message || "Could not archive that standing instruction.";
  }
}

async function emitDirectReply(
  conversationId: string,
  markdown: string,
  emit: (event: ChatClientEvent) => void,
): Promise<ChatTurnResult> {
  const assistant = await createMessage({
    conversationId,
    role: "assistant",
    content: markdown,
  });
  emit({ type: "delta", text: markdown });
  emit({
    type: "done",
    message: {
      id: assistant.id,
      role: assistant.role,
      content: assistant.content,
      createdAt: assistant.createdAt,
      openaiResponseId: assistant.openaiResponseId,
    },
  });
  return { ok: true, text: markdown, conversationId };
}

async function streamModelTurn(input: {
  user: AuthUser;
  content: string;
  conversationId: string;
  activeProject: ActiveProject | null;
  providerAttachments: ProviderAttachment[];
  signal?: AbortSignal;
  emit: (event: ChatClientEvent) => void;
}): Promise<ChatTurnResult> {
  const { user, content, conversationId, activeProject, providerAttachments, emit } =
    input;

  try {
    emit({ type: "status", status: "thinking" });

    const history = await listMessagesForProvider(conversationId);
    const provider = await getModelProvider();

    let fullText = "";
    let responseId: string | undefined;
    let turnUsage:
      | {
          calls: number;
          inputTokens: number;
          outputTokens: number;
          reasoningTokens: number;
          estUsd: number;
          model?: string;
        }
      | undefined;

    const scope = await memoryScopeForUser(user);
    const fallbackQuery =
      user.role === "owner"
        ? "derek preferences projects people"
        : "project tasks decisions";
    const [relevant, projectKeys, starred, standing] = await Promise.all([
      retrieveRelevantMemories(
        [content || fallbackQuery, activeProject?.name].filter(Boolean).join(" "),
        { limit: 12, scope },
      ),
      listMemberProjectKeys(user),
      user.role === "owner"
        ? listStarredMessageRecords(user.id)
        : Promise.resolve([]),
      user.role === "owner"
        ? listActiveStandingInstructions()
        : Promise.resolve([]),
    ]);
    const memoryBlock = formatMemoriesForPrompt(relevant, user.role);
    const projectNames = projectKeys.map(displayProjectName);
    const tasksBlock = activeProject
      ? await loadRemainingTasksBlock(activeProject.key)
      : "";
    const starsBlock =
      user.role === "owner" ? formatStarredMessagesRuntime(starred) : "";
    const standingBlock =
      user.role === "owner" ? formatStandingInstructionsRuntime(standing) : "";

    const currentMessageId = history[history.length - 1]?.id;
    const messages = history
      .filter(
        (m) =>
          m.id === currentMessageId ||
          !(
            isRemainingTasksChatContent(m.role, m.content) ||
            isStarredListChatContent(m.role, m.content) ||
            isStandingInstructionChatContent(m.role, m.content)
          ),
      )
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: stripTaskIdsFromChatContent(m.content),
        attachments:
          m.id === history[history.length - 1]?.id
            ? providerAttachments
            : m.attachments.map((a) => ({
                id: a.id,
                filename: a.filename,
                mimeType: a.mimeType,
                size: a.size,
                storageKey: a.storageKey,
                kind: kindFromMime(a.mimeType),
              })),
      }));

    for await (const event of provider.streamChat({
      messages,
      signal: input.signal,
      memoryBlock,
      tasksBlock,
      standingBlock,
      starsBlock,
      actor: {
        id: user.id,
        name: user.name,
        role: user.role,
        assistantName: user.assistantName,
        assistantPersona: user.assistantPersona,
        projectNames,
        activeProject,
      },
    })) {
      if (event.type === "status") {
        emit({
          type: "status",
          status: event.status,
          detail: event.detail,
        });
      } else if (event.type === "delta") {
        fullText += event.text;
        emit({ type: "delta", text: event.text });
      } else if (event.type === "error") {
        emit({ type: "error", error: event.message });
        return {
          ok: false,
          text: "",
          conversationId,
          error: event.message,
        };
      } else if (event.type === "done") {
        responseId = event.responseId;
        if (!fullText && event.text) fullText = event.text;
        if (event.usage) turnUsage = event.usage;
      }
    }

    const assistant = await createMessage({
      conversationId,
      role: "assistant",
      content: fullText || "…",
      openaiResponseId: responseId,
    });

    const { formatUsageCompact, getTodayUsageTotals } = await import(
      "@/lib/ai/usage"
    );
    const dayTotals = user.role === "owner" ? getTodayUsageTotals() : null;

    emit({
      type: "done",
      message: {
        id: assistant.id,
        role: assistant.role,
        content: assistant.content,
        createdAt: assistant.createdAt,
        openaiResponseId: assistant.openaiResponseId,
        usage: turnUsage,
      },
      usage: turnUsage,
      ...(dayTotals
        ? {
            dayUsage: dayTotals,
            dayUsageLabel: formatUsageCompact(dayTotals),
          }
        : {}),
    });

    return {
      ok: true,
      text: assistant.content,
      conversationId,
    };
  } catch (error) {
    const message = `Something went wrong while talking to ${user.assistantName}.`;
    logger.error("chat_stream_error", {
      error: error instanceof Error ? error.message : "unknown",
    });
    emit({ type: "error", error: message });
    return { ok: false, text: "", conversationId, error: message };
  }
}
