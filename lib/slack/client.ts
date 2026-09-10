/**
 * Slack Web API client (chat.postMessage only — no extra SDK).
 */

import { logger } from "@/lib/logger";
import { getSlackConfig } from "./config";

const SLACK_API_BASE = "https://slack.com/api";

export interface SlackPostMessageResult {
  sent: boolean;
  messageTs?: string;
  error?: string;
}

export async function postSlackMessage(input: {
  channelId: string;
  text: string;
  threadTs?: string;
}): Promise<SlackPostMessageResult> {
  const config = getSlackConfig();
  if (!config) {
    return { sent: false, error: "Slack is not configured" };
  }

  const text = input.text.trim();
  if (!text) {
    return { sent: false, error: "Message text is required" };
  }

  try {
    const response = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: input.channelId,
        text,
        thread_ts: input.threadTs,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      ts?: string;
      error?: string;
    };

    if (!response.ok || !payload.ok) {
      const error = payload.error || `Slack HTTP ${response.status}`;
      logger.error("slack_post_message_failed", {
        channelId: input.channelId,
        threadTs: input.threadTs,
        error,
      });
      return { sent: false, error };
    }

    logger.info("slack_post_message_sent", {
      channelId: input.channelId,
      threadTs: input.threadTs,
      messageTs: payload.ts,
    });

    return { sent: true, messageTs: payload.ts };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown error";
    logger.error("slack_post_message_error", {
      channelId: input.channelId,
      error: errorMsg,
    });
    return { sent: false, error: errorMsg };
  }
}
