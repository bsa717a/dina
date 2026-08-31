/**
 * Grok Bot Dina handoff: forward inbound messages to Grok Bot for processing.
 *
 * When GROK_BOT_DINA_WEBHOOK_URL is set, messages are forwarded.
 * When unset, messages are logged so the pipe can be tested without Grok Bot.
 */

import { createHmac } from "crypto";
import { logger } from "@/lib/logger";
import { getGrokBotConfig, isGrokBotConfigured } from "./config";
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
    from: message.from.phone_number,
    to: message.to[0]?.phone_number ?? "",
    text: message.text,
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

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function handoffToGrokBot(
  message: TelnyxMessagePayload,
  roster: RosterLookupResult,
): Promise<HandoffResult> {
  const payload = buildHandoffPayload(message, roster);

  if (!isGrokBotConfigured()) {
    logger.info("grok_bot_handoff_logged", {
      messageId: message.id,
      from: message.from.phone_number,
      text: message.text.slice(0, 100),
      userFound: roster.found,
      userId: roster.found ? roster.user.id : null,
      reason: "grok_bot_not_configured",
    });
    return { status: "logged" };
  }

  const config = getGrokBotConfig();
  if (!config) {
    return { status: "logged" };
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.webhookSecret) {
    const signature = signPayload(body, config.webhookSecret);
    headers["X-Grok-Bot-Signature"] = signature;
    headers["X-Grok-Bot-Timestamp"] = String(Math.floor(Date.now() / 1000));
  }

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
