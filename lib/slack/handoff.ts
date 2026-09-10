/**
 * Grok Bot Dina handoff for Slack inbound (mirrors Telnyx handoff).
 *
 * Same webhook URL / HMAC headers as lib/telnyx/handoff.ts.
 * Payload is tagged channel:"slack" and projectKeys is forced to Regi.
 */

import { createHmac } from "crypto";
import { logger } from "@/lib/logger";
import { getGrokBotConfig, isGrokBotConfigured } from "@/lib/telnyx/config";
import type { GrokBotHandoffResponse } from "@/lib/telnyx/types";
import type { SlackHandoffPayload, SlackInboundEvent, SlackRosterLookupResult } from "./types";
import { resolveRegiProjectKey } from "./scope";

export interface SlackHandoffResult {
  status: "sent" | "logged" | "error";
  response?: GrokBotHandoffResponse;
  error?: string;
}

export function buildSlackHandoffPayload(
  event: SlackInboundEvent,
  roster: SlackRosterLookupResult,
): SlackHandoffPayload {
  const regiKey = resolveRegiProjectKey();
  return {
    messageId: event.eventId || event.ts,
    channel: "slack",
    from: event.slackUserId,
    to: event.channelId,
    text: event.text,
    messageType: "slack",
    receivedAt: new Date().toISOString(),
    user: roster.found
      ? {
          id: roster.user.id,
          name: roster.user.name,
          username: roster.user.username,
        }
      : null,
    projectKeys: roster.found && roster.onRegiProject ? [regiKey] : [],
    slack: {
      teamId: event.teamId,
      channelId: event.channelId,
      threadTs: event.threadTs,
      eventTs: event.ts,
      slackUserId: event.slackUserId,
    },
  };
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function handoffSlackToGrokBot(
  event: SlackInboundEvent,
  roster: SlackRosterLookupResult,
): Promise<SlackHandoffResult> {
  const payload = buildSlackHandoffPayload(event, roster);

  if (!isGrokBotConfigured()) {
    logger.info("grok_bot_slack_handoff_logged", {
      messageId: payload.messageId,
      from: payload.from,
      text: payload.text.slice(0, 100),
      userFound: roster.found,
      userId: roster.found ? roster.user.id : null,
      projectKeys: payload.projectKeys,
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
    headers["X-Grok-Bot-Signature"] = signPayload(body, config.webhookSecret);
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
      logger.error("grok_bot_slack_handoff_failed", {
        messageId: payload.messageId,
        status: response.status,
        error: errorText,
      });
      return {
        status: "error",
        error: `Grok Bot returned ${response.status}: ${errorText}`,
      };
    }

    const result = (await response.json()) as GrokBotHandoffResponse;
    logger.info("grok_bot_slack_handoff_sent", {
      messageId: payload.messageId,
      from: payload.from,
      hasReply: Boolean(result.reply),
      projectKeys: payload.projectKeys,
    });

    return { status: "sent", response: result };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown error";
    logger.error("grok_bot_slack_handoff_error", {
      messageId: payload.messageId,
      error: errorMsg,
    });
    return { status: "error", error: errorMsg };
  }
}
