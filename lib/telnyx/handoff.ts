/**
 * Grok Bot handoff: forward inbound messages to the sender's Grok Bot.
 *
 * A sender with grokWebhookUrl is delivered to that bot. Everyone else,
 * including unknown numbers, falls back to GROK_BOT_DINA_WEBHOOK_URL.
 * When neither is set, messages are logged so the pipe can be tested.
 */

import { logger } from "@/lib/logger";
import { resolveInboundGrokBot } from "@/lib/grok-api/bots";
import { buildGrokBotWebhookHeaders } from "@/lib/grok-api/webhook-headers";
import { isGrokBotConfigured } from "./config";
import {
  extractInboundFromPhone,
  extractInboundText,
  extractInboundTo,
} from "./inbound";
import type {
  GrokBotHandoffPayload,
  GrokBotHandoffResponse,
  TelnyxMessagePayload,
  RosterLookupResult,
} from "./types";

export interface HandoffResult {
  status: "sent" | "logged" | "error";
  response?: GrokBotHandoffResponse;
  error?: string;
}

function buildHandoffPayload(
  message: TelnyxMessagePayload,
  roster: RosterLookupResult,
): GrokBotHandoffPayload {
  return {
    messageId: message.id,
    from: extractInboundFromPhone(message) || message.from?.phone_number || "",
    to: extractInboundTo(message) || message.to[0]?.phone_number || "",
    text: extractInboundText(message),
    messageType: message.type,
    receivedAt: message.received_at,
    user: roster.found
      ? {
          id: roster.user.id,
          name: roster.user.name,
          username: roster.user.username,
        }
      : null,
    projectKeys: roster.found ? roster.projectKeys : [],
    media: message.media,
  };
}

export async function handoffToGrokBot(
  message: TelnyxMessagePayload,
  roster: RosterLookupResult,
): Promise<HandoffResult> {
  const payload = buildHandoffPayload(message, roster);
  const userId = roster.found ? roster.user.id : null;
  const config = await resolveInboundGrokBot(userId);

  if (!config) {
    logger.info("grok_bot_handoff_logged", {
      messageId: message.id,
      from: extractInboundFromPhone(message) || message.from?.phone_number || "",
      text: extractInboundText(message).slice(0, 100),
      userFound: roster.found,
      userId,
      reason: "grok_bot_not_configured",
    });
    return { status: "logged" };
  }

  const body = JSON.stringify(payload);
  const headers = buildGrokBotWebhookHeaders(body, config.webhookSecret);

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("grok_bot_handoff_failed", {
        messageId: message.id,
        status: response.status,
        error: errorText,
      });
      return {
        status: "error",
        error: `Grok Bot returned ${response.status}: ${errorText}`,
      };
    }

    const result = (await response.json()) as GrokBotHandoffResponse;
    logger.info("grok_bot_handoff_sent", {
      messageId: message.id,
      from: message.from.phone_number,
      hasReply: Boolean(result.reply),
    });

    return {
      status: "sent",
      response: result,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown error";
    logger.error("grok_bot_handoff_error", {
      messageId: message.id,
      error: errorMsg,
    });
    return {
      status: "error",
      error: errorMsg,
    };
  }
}

export { isGrokBotConfigured };
