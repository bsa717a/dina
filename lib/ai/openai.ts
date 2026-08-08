import OpenAI from "openai";
import { getDefaultTimeZone, getOpenAIApiKey, getOpenAIModel } from "@/lib/env";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
  openAICreditsUserMessage,
} from "@/lib/ai/openai-errors";
import { getDinaSystemPrompt } from "@/lib/ai/prompt";
import type { ModelProvider, ProviderMessage, StreamEvent } from "@/lib/ai/provider";
import { logger } from "@/lib/logger";
import { getGitHubToolDefinitions } from "@/lib/github/tool-definitions";
import { executeGitHubTool, listGitHubToolNames } from "@/lib/github/tools";
import { getMemoryToolDefinitions } from "@/lib/memory/tool-definitions";
import { executeMemoryTool, listMemoryToolNames } from "@/lib/memory/tools";
import { getMicrosoftToolDefinitions } from "@/lib/microsoft/tool-definitions";
import { executeMicrosoftTool, listMicrosoftToolNames } from "@/lib/microsoft/tools";
import {
  formatLessonsForPrompt,
  listActiveLessons,
} from "@/lib/learning/lessons";
import { getProjectTaskToolDefinitions } from "@/lib/project-tasks/tool-definitions";
import {
  executeProjectTaskTool,
  listProjectTaskToolNames,
} from "@/lib/project-tasks/tools";
import { getWritingToolDefinitions } from "@/lib/writing/tool-definitions";
import {
  executeWritingTool,
  listWritingToolNames,
} from "@/lib/writing/tools";

type EasyInputMessage = OpenAI.Responses.ResponseInputItem;

type FunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

function looksLikeFalseCalendarEmpty(content: string) {
  return (
    /(no (scheduled )?events|calendar.*(empty|open|no scheduled)|not seeing the meeting|issue with the calendar fetch|might need to be added manually)/i.test(
      content,
    ) && !/\b(Breck and Derek|Student Transfer)\b.*\b(3|15:00)\b/i.test(content)
  );
}

function looksLikeFalseMsUnavailable(content: string) {
  return /(can'?t|cannot|don'?t|do not|unable to).{0,40}\b(see|access|open|read)\b.{0,40}\b(planner|share\s*point|sharepoint)\b|\b(planner|sharepoint).{0,40}\b(not (available|configured|connected)|unavailable)\b/i.test(
    content,
  );
}

function isCalendarQuestion(text: string) {
  return /\b(calendar|schedule|agenda|what'?s on|what is on|meetings?\b.*\b(today|tomorrow)|am i free)\b/i.test(
    text,
  );
}

function isPlannerQuestion(text: string) {
  return /\bplanner\b|\bplan board\b|\bbuckets?\b.*\btasks?\b|\btasks?\b.*\bplanner\b/i.test(
    text,
  );
}

function isSharePointQuestion(text: string) {
  return /\bshare\s*point\b|\bsharepoint\b|\b4sl tech projects\b|\bdev docs\b/i.test(
    text,
  );
}

function isSharePointListQuestion(text: string) {
  return (
    /\b(share\s*point\s+)?list\b/i.test(text) ||
    /\bnetwork info\b/i.test(text) ||
    /\b4sl contacts\b/i.test(text)
  );
}

function denverNowLabel() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getDefaultTimeZone(),
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date());
}

function buildInput(messages: ProviderMessage[]): EasyInputMessage[] {
  const input: EasyInputMessage[] = [];
  // Keep recent context only so outdated refusals/bad digests don't dominate.
  const recent = messages.slice(-16);

  for (const message of recent) {
    if (message.role === "system") continue;

    if (message.role === "assistant") {
      // Drop prior assistant digests that are just subject+link lists; they reinforce bad behavior.
      const hasOwaLink = /outlook\.office(365)?\.com\/owa/i.test(message.content);
      const looksLikeLazyDigest =
        (/\[Read (Email|More)\]\(/i.test(message.content) || hasOwaLink) &&
        !/(amount|due|action|deadline|\$|invoice|balance)/i.test(message.content);
      if (looksLikeLazyDigest) continue;
      // Drop prior false "calendar empty" / "can't see Planner/SharePoint" answers.
      if (looksLikeFalseCalendarEmpty(message.content)) continue;
      if (looksLikeFalseMsUnavailable(message.content)) continue;

      input.push({
        role: "assistant",
        content: message.content,
      });
      continue;
    }

    const content: OpenAI.Responses.ResponseInputContent[] = [];
    const textParts: string[] = [];
    if (message.content.trim()) textParts.push(message.content.trim());

    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "image" && attachment.dataUrl) {
        content.push({
          type: "input_image",
          image_url: attachment.dataUrl,
          detail: "auto",
        });
      } else if (attachment.textContent) {
        textParts.push(
          `[Attachment: ${attachment.filename}]\n${attachment.textContent}`,
        );
      } else {
        textParts.push(
          `[Attachment uploaded: ${attachment.filename} (${attachment.mimeType})]`,
        );
      }
    }

    if (textParts.length) {
      content.unshift({
        type: "input_text",
        text: textParts.join("\n\n"),
      });
    }

    if (!content.length) {
      content.push({ type: "input_text", text: "(empty message)" });
    }

    input.push({
      role: "user",
      content,
    });
  }

  return input;
}

function collectFunctionCalls(output: OpenAI.Responses.ResponseOutputItem[]): FunctionCallItem[] {
  const calls: FunctionCallItem[] = [];
  for (const item of output) {
    if (item.type === "function_call") {
      calls.push({
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      });
    }
  }
  return calls;
}

function buildInstructions(
  msCount: number,
  ghCount: number,
  memoryBlock: string,
  lessonsBlock: string,
) {
  const parts = [getDinaSystemPrompt()];
  if (memoryBlock) {
    parts.push("", memoryBlock);
  }
  if (lessonsBlock) {
    parts.push("", lessonsBlock);
  }
  parts.push("", "SESSION RUNTIME:");
  parts.push(
    "Memory tools are enabled (search_memory, remember, correct_memory, approve_memory, archive_memory, merge_memories, list_memories).",
    "Memory is structured long-term knowledge — never treat the chat transcript as memory.",
    "Only remember durable facts per Memory Rules. Foundational memories may be pending_approval — ask Derek to approve, then call approve_memory.",
    "Correct existing memories by id instead of duplicating. Low-confidence memories must not silently drive important decisions.",
    "Do not rewrite or contradict the Dina Constitution via memory tools.",
    "Project task tools are enabled (list_project_tasks, add_project_task, complete_project_task, update_project_task).",
    "For per-project backlogs ('remaining tasks for Dina', 'mark 6 complete', 'add a Dina task'), ALWAYS use project task tools — never Memory commitments and never invent a list from chat history.",
    "Waiting On Engine tracks external waits (on Derek / others); ProjectTask is the live backlog of work items on a named project.",
    "Writing Assistant tool enabled: draft_in_dereks_voice. When Derek asks to write, draft, or reply, call draft_in_dereks_voice first (do not invent a long draft without the tool).",
    "draft_in_dereks_voice never sends. After Derek approves, use send_email or create_reply_draft.",
  );
  parts.push(
    `Current datetime (${getDefaultTimeZone()}): ${denverNowLabel()}.`,
    "Treat that clock as authoritative for today/tomorrow.",
  );
  if (msCount) {
    parts.push(
      `${msCount} Microsoft Graph tools are enabled, including brief_inbox, get_email, get_emails, list_calendar_events, ensure_mail_folder, create_inbox_rule, and mark_matching_emails_read.`,
      "For requests to create folders or inbox rules, you MUST call those tools. Do not answer with manual Outlook instructions.",
      "For email summaries/digests/triage, you MUST call brief_inbox (or get_emails). brief_inbox auto-marks marketing/spam read (autoCleared); summarize textBody for remaining emails[] and only briefly note what was cleared.",
      "For calendar/schedule/agenda questions, you MUST call list_calendar_events and report every returned item with its when/timeZone fields.",
      "Trust live list_calendar_events JSON over earlier chat messages that claimed the calendar was empty or that a meeting was missing.",
      "Never say an event needs to be added manually when list_calendar_events already returned it.",
      "For Planner questions, call list_planner_plans then list_planner_tasks. Never claim Planner is unavailable.",
      "For SharePoint document folders, call list_sharepoint_folder. For SharePoint Lists (Network Info, contacts, etc.), call list_sharepoint_lists or get_sharepoint_list_items — never look for lists inside Dev Docs.",
      "Never claim SharePoint is unavailable.",
      'Never include a Links section, Outlook/OWA links, SendGrid/click-tracking URLs, or CTA buttons like "Save My Seat" / "Read More".',
    );
  }
  if (ghCount) {
    parts.push(
      `${ghCount} GitHub tools are enabled across multiple accounts (list_github_accounts, list_github_repositories, list_github_projects, github_activity, which_github_account_owns_repo).`,
      "Always include the GitHub account id/label with repositories and events. Never assume one owner/org for all repos.",
      "For project context (what repos/products are), call list_github_projects.",
      "If one GitHub account fails, still report healthy accounts.",
    );
  }
  return parts.join("\n");
}

async function executeTool(name: string, argsJson: string): Promise<string> {
  if (listMemoryToolNames().includes(name)) {
    return executeMemoryTool(name, argsJson);
  }
  if (listProjectTaskToolNames().includes(name)) {
    return executeProjectTaskTool(name, argsJson);
  }
  if (listWritingToolNames().includes(name)) {
    return executeWritingTool(name, argsJson);
  }
  if (listGitHubToolNames().includes(name)) {
    return executeGitHubTool(name, argsJson);
  }
  if (listMicrosoftToolNames().includes(name)) {
    return executeMicrosoftTool(name, argsJson);
  }
  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";

  async *streamChat(input: {
    messages: ProviderMessage[];
    signal?: AbortSignal;
    memoryBlock?: string;
  }): AsyncIterable<StreamEvent> {
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      yield { type: "error", message: "OpenAI is not configured. Set OPENAI_API_KEY." };
      return;
    }

    if (isOpenAICreditsBlocked()) {
      yield { type: "error", message: openAICreditsUserMessage() };
      return;
    }

    const client = new OpenAI({ apiKey, timeout: 120_000 });
    const model = getOpenAIModel();
    const msTools = getMicrosoftToolDefinitions();
    const ghTools = getGitHubToolDefinitions();
    const memoryTools = getMemoryToolDefinitions();
    const projectTaskTools = getProjectTaskToolDefinitions();
    const writingTools = getWritingToolDefinitions();
    const tools = [
      ...msTools,
      ...ghTools,
      ...memoryTools,
      ...projectTaskTools,
      ...writingTools,
    ];
    const lessonsBlock = formatLessonsForPrompt(await listActiveLessons());
    const instructions = buildInstructions(
      msTools.length,
      ghTools.length,
      input.memoryBlock || "",
      lessonsBlock,
    );

    try {
      let nextInput: OpenAI.Responses.ResponseInput = buildInput(input.messages);
      let previousResponseId: string | undefined;
      let finalText = "";
      let finalResponseId: string | undefined;
      const maxRounds = 8;
      const lastUserText = [...input.messages]
        .reverse()
        .find((m) => m.role === "user")
        ?.content || "";
      const forceCalendar =
        Boolean(msTools.length) && isCalendarQuestion(lastUserText);
      const forcePlanner =
        Boolean(msTools.length) && isPlannerQuestion(lastUserText);
      const forceSharePointList =
        Boolean(msTools.length) && isSharePointListQuestion(lastUserText);
      const forceSharePoint =
        Boolean(msTools.length) &&
        !forceSharePointList &&
        isSharePointQuestion(lastUserText);

      for (let round = 0; round < maxRounds; round += 1) {
        if (input.signal?.aborted) break;

        yield {
          type: "status",
          status: round === 0 ? "thinking" : "working",
          detail: round === 0 ? undefined : "Using tools…",
        };

        const forcedToolName =
          forceCalendar && round === 0
            ? "list_calendar_events"
            : forcePlanner && round === 0
              ? "list_planner_plans"
              : forceSharePointList && round === 0
                ? // Prefer items lookup; model should pass listName from the user message.
                  "get_sharepoint_list_items"
                : forceSharePoint && round === 0
                  ? "list_sharepoint_folder"
                  : null;

        const toolChoice =
          !tools.length
            ? undefined
            : forcedToolName
              ? {
                  type: "function" as const,
                  name: forcedToolName,
                }
              : ("auto" as const);

        const stream = await client.responses.create(
          {
            model,
            instructions,
            input: nextInput,
            previous_response_id: previousResponseId,
            tools: tools.length ? tools : undefined,
            tool_choice: toolChoice,
            stream: true,
          },
          { signal: input.signal },
        );

        let responseId: string | undefined;
        let text = "";
        let completed: OpenAI.Responses.Response | undefined;
        const streamedCalls = new Map<string, FunctionCallItem>();

        for await (const event of stream) {
          if (input.signal?.aborted) break;

          if (event.type === "response.created") {
            responseId = event.response.id;
          }

          if (event.type === "response.output_item.done") {
            const item = event.item;
            if (item.type === "function_call") {
              streamedCalls.set(item.call_id, {
                type: "function_call",
                call_id: item.call_id,
                name: item.name,
                arguments: item.arguments,
              });
            }
          }

          if (event.type === "response.output_text.delta") {
            // Buffer until we know this round is final (no tool calls).
            text += event.delta;
          }

          if (event.type === "response.completed") {
            completed = event.response;
            responseId = event.response.id;
            if (!text && event.response.output_text) {
              text = event.response.output_text;
            }
          }

          if (event.type === "error") {
            yield {
              type: "error",
              message: event.message || "OpenAI returned an error.",
            };
            return;
          }
        }

        if (!completed) {
          if (text) {
            yield { type: "delta", text };
            yield { type: "done", responseId, text };
            return;
          }
          yield { type: "error", message: "OpenAI response ended unexpectedly." };
          return;
        }

        const fromCompleted = collectFunctionCalls(completed.output || []);
        const functionCalls =
          fromCompleted.length > 0 ? fromCompleted : Array.from(streamedCalls.values());
        finalResponseId = completed.id;

        if (!functionCalls.length) {
          finalText = text || completed.output_text || "";
          if (finalText) yield { type: "delta", text: finalText };
          break;
        }

        const toolOutputs: OpenAI.Responses.ResponseInputItem[] = [];
        for (const call of functionCalls) {
          yield {
            type: "status",
            status: "tool",
            detail: `Running ${call.name}…`,
          };
          logger.info("tool_call", { tool: call.name });
          let output = await executeTool(call.name, call.arguments || "{}");
          if (call.name === "list_calendar_events") {
            try {
              const parsed = JSON.parse(output) as {
                ok?: boolean;
                data?: { count?: number; items?: unknown[] };
              };
              if (parsed.ok && (parsed.data?.count ?? 0) > 0) {
                output = JSON.stringify({
                  ...parsed,
                  instruction:
                    "AUTHORITATIVE LIVE CALENDAR DATA. Report every item to Derek with subject + when. Do not claim the calendar is empty. Do not offer to add events that are already listed.",
                });
              }
            } catch {
              // keep raw output
            }
          }
          toolOutputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output,
          });
        }

        previousResponseId = completed.id;
        nextInput = toolOutputs;
      }

      yield {
        type: "done",
        responseId: finalResponseId,
        text: finalText,
      };
    } catch (error) {
      logger.error("openai_stream_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      if (isOpenAICreditsError(error)) {
        markOpenAICreditsExhausted();
        yield { type: "error", message: openAICreditsUserMessage() };
        return;
      }
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Request was cancelled."
          : "Dina could not reach OpenAI right now. Please try again.";
      yield { type: "error", message };
    }
  }
}
