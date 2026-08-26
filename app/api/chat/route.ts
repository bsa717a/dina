import { NextRequest } from "next/server";
import { z } from "zod";
import { runWithAuthUser } from "@/lib/auth/context";
import { requireSession } from "@/lib/auth/session";
import { needsOnboarding } from "@/lib/auth/types";
import { getModelProvider } from "@/lib/ai/provider";
import { checkDatabase } from "@/lib/db/client";
import {
  createMessage,
  getOrCreateDefaultConversation,
  listMessagesForProvider,
} from "@/lib/db/conversations";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { memoryScopeForUser } from "@/lib/memory/scope";
import {
  resolveActiveProjectForUser,
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

export const runtime = "nodejs";
/**
 * Morning Ritual runs week-plan + markets in parallel then compose.
 * Budget target is well under 300s (see lib/morning-ritual timeouts).
 */
export const maxDuration = 300;

const bodySchema = z.object({
  content: z.string().max(50_000).default(""),
  attachmentIds: z.array(z.string()).max(8).default([]),
  project: z.string().max(80).optional(),
});

export async function POST(request: NextRequest) {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (needsOnboarding(user)) return forbidden("Onboarding required.");

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid chat request.");
  }

  const content = parsed.data.content.trim();
  if (!content && parsed.data.attachmentIds.length === 0) {
    return jsonError("Message or attachment is required.");
  }

  const requestedProject = parsed.data.project?.trim();
  const activeProject = await resolveActiveProjectForUser(
    user,
    requestedProject,
  );
  if (requestedProject && !activeProject) {
    return jsonError("Unknown project or no access.", 400);
  }

  if (user.role === "owner") {
    // Ensure foundational document memories + recovered project tasks exist (idempotent).
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
  const providerAttachments = await loadProviderAttachments(
    parsed.data.attachmentIds,
    user.id,
  );
  if (providerAttachments.length !== parsed.data.attachmentIds.length) {
    return jsonError("One or more attachments were not found.", 404);
  }

  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: content || "(attachment)",
    attachmentIds: parsed.data.attachmentIds,
  });

  if (
    user.role === "owner" &&
    parsed.data.attachmentIds.length === 0 &&
    isStarredListRequest(content)
  ) {
    const items = await listStarredMessageRecords(user.id);
    return directAssistantReply(
      conversation.id,
      formatStarredMessagesMessage(items),
    );
  }

  const standingRequest =
    user.role === "owner" && parsed.data.attachmentIds.length === 0
      ? parseStandingInstructionRequest(content)
      : null;
  if (standingRequest) {
    let markdown = "";
    if (standingRequest.kind === "help") {
      markdown = formatStandingInstructionHelpMessage();
    } else if (standingRequest.kind === "list") {
      const items = await listActiveStandingInstructions();
      markdown = formatStandingInstructionsMessage(items);
    } else if (standingRequest.kind === "set") {
      try {
        const item = await setStandingInstruction({
          title: standingRequest.title,
          content: standingRequest.content,
          source: "chat",
        });
        markdown = formatStandingInstructionSavedMessage(item);
      } catch (error) {
        markdown =
          error instanceof Error
            ? error.message
            : "Could not save that standing instruction.";
      }
    } else {
      try {
        const item = await archiveStandingInstruction(standingRequest.title);
        markdown = formatStandingInstructionArchivedMessage(item.title);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        markdown = /not found/i.test(message)
          ? formatStandingInstructionMissingMessage(standingRequest.title)
          : message || "Could not archive that standing instruction.";
      }
    }
    return directAssistantReply(conversation.id, markdown);
  }

  const history = await listMessagesForProvider(conversation.id);
  const provider = await getModelProvider();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      await runWithAuthUser(user, () =>
        runWithActiveProject(activeProject, async () => {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        send({ type: "status", status: "thinking" });

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
            [content || fallbackQuery, activeProject?.name]
              .filter(Boolean)
              .join(" "),
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
          user.role === "owner"
            ? formatStandingInstructionsRuntime(standing)
            : "";

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
          signal: request.signal,
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
            send({
              type: "status",
              status: event.status,
              detail: event.detail,
            });
          } else if (event.type === "delta") {
            fullText += event.text;
            send({ type: "delta", text: event.text });
          } else if (event.type === "error") {
            send({ type: "error", error: event.message });
            controller.close();
            return;
          } else if (event.type === "done") {
            responseId = event.responseId;
            if (!fullText && event.text) fullText = event.text;
            if (event.usage) turnUsage = event.usage;
          }
        }

        const assistant = await createMessage({
          conversationId: conversation.id,
          role: "assistant",
          content: fullText || "…",
          openaiResponseId: responseId,
        });

        const { formatUsageCompact, getTodayUsageTotals } = await import(
          "@/lib/ai/usage"
        );
        const dayTotals =
          user.role === "owner" ? getTodayUsageTotals() : null;

        send({
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
      } catch (error) {
        logger.error("chat_stream_error", {
          error: error instanceof Error ? error.message : "unknown",
        });
        send({
          type: "error",
          error: `Something went wrong while talking to ${user.assistantName}.`,
        });
      } finally {
        controller.close();
      }
        }),
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function directAssistantReply(conversationId: string, markdown: string) {
  const assistant = await createMessage({
    conversationId,
    role: "assistant",
    content: markdown,
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      send({ type: "delta", text: markdown });
      send({
        type: "done",
        message: {
          id: assistant.id,
          role: assistant.role,
          content: assistant.content,
          createdAt: assistant.createdAt,
          openaiResponseId: assistant.openaiResponseId,
        },
      });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
