/**
 * Slack inbound processing for the Regi-only Piper bot.
 *
 * Flow:
 * 1. Ignore bots / disallowed channels / irrelevant subtypes
 * 2. Roster lookup (Slack user → Piper member)
 * 3. Unknown / not-on-Regi → clear reply asking Derek
 * 4. Mark the Slack thread so follow-ups stay in this conversation
 * 5. Run the same chat turn as the Piper web text box (Gemini/provider
 *    + project tools), scoped to Regi. Do not call Grok Bot / Old Dina.
 *
 * Telnyx RCS still uses lib/telnyx/handoff.ts — that path is unchanged.
 */

import { logger } from "@/lib/logger";
import { postSlackMessage } from "./client";
import { runSlackPiperChat } from "./chat";
import {
  findSlackThreadAttention,
  rememberSlackThread,
  stripSlackMentions,
} from "./ledger";
import { lookupBySlackUserId } from "./roster";
import {
  isChannelAllowed,
  isOwnBotMessage,
  shouldIgnoreMessageSubtype,
} from "./scope";
import type {
  SlackEventCallback,
  SlackInboundEvent,
  SlackInboundResult,
} from "./types";
import { NOT_ON_REGI_REPLY, UNKNOWN_USER_REPLY } from "./types";

const HANDLED_EVENT_TYPES = new Set(["app_mention", "message"]);

/** Slack retries if the Events ack is slow; share one in-flight chat turn. */
const inflightByEvent = new Map<string, Promise<SlackInboundResult>>();

function slackEventDedupeKey(event: SlackInboundEvent): string {
  return event.eventId || `${event.channelId}:${event.ts}`;
}

export function parseSlackInboundEvent(
  payload: SlackEventCallback,
): SlackInboundEvent | null {
  const inner = payload.event;
  if (!inner || !HANDLED_EVENT_TYPES.has(inner.type)) return null;
  if (!inner.user || !inner.channel || !inner.ts) return null;

  const threadTs = inner.thread_ts || inner.ts;
  return {
    type: inner.type as SlackInboundEvent["type"],
    slackUserId: inner.user,
    text: inner.text || "",
    channelId: inner.channel,
    ts: inner.ts,
    threadTs,
    channelType: inner.channel_type,
    botId: inner.bot_id,
    subtype: inner.subtype,
    teamId: payload.team_id || inner.team,
    eventId: payload.event_id,
  };
}

export async function processSlackInbound(
  event: SlackInboundEvent,
): Promise<SlackInboundResult> {
  const key = slackEventDedupeKey(event);
  const existing = inflightByEvent.get(key);
  if (existing) return existing;

  const work = processSlackInboundOnce(event).finally(() => {
    setTimeout(() => inflightByEvent.delete(key), 60_000);
  });
  inflightByEvent.set(key, work);
  return work;
}

async function processSlackInboundOnce(
  event: SlackInboundEvent,
): Promise<SlackInboundResult> {
  if (isOwnBotMessage(event) || shouldIgnoreMessageSubtype(event.subtype)) {
    return { handled: false, ignored: true, reason: "bot_or_subtype" };
  }

  if (!isChannelAllowed(event.channelId, event.channelType)) {
    logger.info("slack_channel_not_allowed", {
      channelId: event.channelId,
      channelType: event.channelType,
    });
    return { handled: false, ignored: true, reason: "channel_not_allowed" };
  }

  if (event.type === "message" && event.channelType !== "im" && event.channelType !== "mpim") {
    if (event.threadTs === event.ts) {
      return { handled: false, ignored: true, reason: "channel_message_without_mention" };
    }
    const existingThread = await findSlackThreadAttention(
      event.channelId,
      event.threadTs,
    );
    if (!existingThread) {
      return { handled: false, ignored: true, reason: "unknown_thread" };
    }
  }

  const roster = await lookupBySlackUserId(event.slackUserId);

  if (!roster.found) {
    logger.warn("slack_unknown_sender", {
      slackUserId: event.slackUserId,
      channelId: event.channelId,
      text: event.text.slice(0, 50),
    });
    const reply = {
      text: UNKNOWN_USER_REPLY,
      channelId: event.channelId,
      threadTs: event.threadTs,
    };
    return { handled: false, reason: "unknown_user", reply, roster };
  }

  if (!roster.onRegiProject) {
    logger.warn("slack_sender_not_on_regi", {
      slackUserId: event.slackUserId,
      userId: roster.user.id,
      projectKeys: roster.projectKeys,
    });
    const reply = {
      text: NOT_ON_REGI_REPLY,
      channelId: event.channelId,
      threadTs: event.threadTs,
    };
    return { handled: false, reason: "not_on_regi", reply, roster };
  }

  const cleanedText = stripSlackMentions(event.text).trim();
  const cleanedEvent: SlackInboundEvent = {
    ...event,
    text: cleanedText || "Hello",
  };

  logger.info("slack_inbound_message", {
    messageId: event.ts,
    slackUserId: event.slackUserId,
    userId: roster.user.id,
    userName: roster.user.name,
    channelId: event.channelId,
    threadTs: event.threadTs,
    textLength: cleanedEvent.text.length,
  });

  let attention: { id: string } | undefined;
  try {
    const marked = await rememberSlackThread({
      event: cleanedEvent,
      roster,
    });
    attention = marked.attention;
  } catch (error) {
    logger.error("slack_thread_mark_failed", {
      messageId: event.ts,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const chat = await runSlackPiperChat({
    user: roster.authUser,
    text: cleanedEvent.text,
  });

  logger.info("slack_chat_reply", {
    messageId: event.ts,
    ok: chat.ok,
    userId: roster.user.id,
  });

  return {
    handled: true,
    reason: "ok",
    reply: {
      text: chat.text,
      channelId: event.channelId,
      threadTs: event.threadTs,
    },
    attention,
    handoff: "skipped",
    replyKind: "chat",
    roster,
  };
}

export async function deliverSlackReply(result: SlackInboundResult): Promise<void> {
  if (!result.reply) return;
  const sent = await postSlackMessage({
    channelId: result.reply.channelId,
    threadTs: result.reply.threadTs,
    text: result.reply.text,
  });
  if (!sent.sent) {
    logger.error("slack_reply_failed", {
      channelId: result.reply.channelId,
      threadTs: result.reply.threadTs,
      error: sent.error,
    });
  }
}
