import OpenAI from "openai";
import { getOpenAIApiKey, getOpenAIModel } from "@/lib/env";
import { DINA_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import type { ModelProvider, ProviderMessage, StreamEvent } from "@/lib/ai/provider";
import { logger } from "@/lib/logger";
import { getMicrosoftToolDefinitions } from "@/lib/microsoft/tool-definitions";
import { executeMicrosoftTool } from "@/lib/microsoft/tools";

type EasyInputMessage = OpenAI.Responses.ResponseInputItem;

type FunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

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

function buildInstructions(toolCount: number) {
  if (!toolCount) return DINA_SYSTEM_PROMPT;
  return `${DINA_SYSTEM_PROMPT}

RUNTIME: ${toolCount} Microsoft Graph tools are enabled in this request, including brief_inbox, get_email, get_emails, ensure_mail_folder, create_inbox_rule, and mark_matching_emails_read.
For requests to create folders or inbox rules, you MUST call those tools. Do not answer with manual Outlook instructions.
For email summaries/digests/triage, you MUST call brief_inbox (or get_emails) and summarize each textBody.
Never include a Links section, Outlook/OWA links, SendGrid/click-tracking URLs, or CTA buttons like "Save My Seat" / "Read More".`;
}

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";

  async *streamChat(input: {
    messages: ProviderMessage[];
    signal?: AbortSignal;
  }): AsyncIterable<StreamEvent> {
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      yield { type: "error", message: "OpenAI is not configured. Set OPENAI_API_KEY." };
      return;
    }

    const client = new OpenAI({ apiKey, timeout: 120_000 });
    const model = getOpenAIModel();
    const tools = getMicrosoftToolDefinitions();
    const instructions = buildInstructions(tools.length);

    try {
      let nextInput: OpenAI.Responses.ResponseInput = buildInput(input.messages);
      let previousResponseId: string | undefined;
      let finalText = "";
      let finalResponseId: string | undefined;
      const maxRounds = 8;

      for (let round = 0; round < maxRounds; round += 1) {
        if (input.signal?.aborted) break;

        yield {
          type: "status",
          status: round === 0 ? "thinking" : "working",
          detail: round === 0 ? undefined : "Using Microsoft 365 tools…",
        };

        const stream = await client.responses.create(
          {
            model,
            instructions,
            input: nextInput,
            previous_response_id: previousResponseId,
            tools: tools.length ? tools : undefined,
            tool_choice: tools.length ? "auto" : undefined,
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
          logger.info("microsoft_tool_call", { tool: call.name });
          const output = await executeMicrosoftTool(call.name, call.arguments || "{}");
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
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Request was cancelled."
          : "Dina could not reach OpenAI right now. Please try again.";
      yield { type: "error", message };
    }
  }
}
