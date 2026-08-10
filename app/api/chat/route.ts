import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { getModelProvider } from "@/lib/ai/provider";
import { checkDatabase } from "@/lib/db/client";
import {
  createMessage,
  getOrCreateDefaultConversation,
  listMessagesForProvider,
} from "@/lib/db/conversations";
import { jsonError, unauthorized } from "@/lib/http";
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
});

export async function POST(request: NextRequest) {
  if (!(await requireSession())) return unauthorized();

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

  // Ensure foundational document memories + recovered project tasks exist (idempotent).
  await Promise.all([
    seedDerekProfileMemories().catch(() => undefined),
    seedDerekProjectMemories().catch(() => undefined),
    seedDinaMemoryRuleMemories().catch(() => undefined),
    seedDinaOperatingManualMemories().catch(() => undefined),
    seedDinaProjectTasks().catch(() => undefined),
  ]);

  const conversation = await getOrCreateDefaultConversation();
  const providerAttachments = await loadProviderAttachments(parsed.data.attachmentIds);

  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: content || "(attachment)",
    attachmentIds: parsed.data.attachmentIds,
  });

  const history = await listMessagesForProvider(conversation.id);
  const provider = await getModelProvider();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
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

        const relevant = await retrieveRelevantMemories(
          content || "derek preferences projects people",
          { limit: 12 },
        );
        const memoryBlock = formatMemoriesForPrompt(relevant);

        const messages = history.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
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
        const dayTotals = getTodayUsageTotals();

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
          dayUsage: dayTotals,
          dayUsageLabel: formatUsageCompact(dayTotals),
        });
      } catch (error) {
        logger.error("chat_stream_error", {
          error: error instanceof Error ? error.message : "unknown",
        });
        send({
          type: "error",
          error: "Something went wrong while talking to Dina.",
        });
      } finally {
        controller.close();
      }
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
