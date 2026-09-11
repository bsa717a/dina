/**
 * Slack inbound processing for the Regi-only Piper bot.
 *
 * Flow (mirrors Telnyx):
 * 1. Ignore bots / disallowed channels / irrelevant subtypes
 * 2. Roster lookup (Slack user → Piper member)
 * 3. Unknown / not-on-Regi → clear reply asking Derek
 * 4. Create or update a Regi task + Attention item
 * 5. Hand off to Grok Bot Dina (same webhook as Telnyx)
 * 6. Reply in-thread only when Grok returns sync text, or when
 *    handoff is logged/error (local ledger ack). A successful async
 *    handoff (`sent` without reply.text) stays silent so outbound-slack
 *    can post the real answer later.
 */

import { logger } from "@/lib/logger";
import { postSlackMessage } from "./client";
import { handoffSlackToGrokBot } from "./handoff";
import {
  findSlackThreadAttention,
  upsertSlackThreadLedger,
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

  const cleanedEvent: SlackInboundEvent = {
    ...event,
    text: stripSlackMentions(event.text) || event.text,
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

  const ledger = await upsertSlackThreadLedger({
    event: cleanedEvent,
    roster,
  });

  const handoffResult = await handoffSlackToGrokBot(cleanedEvent, roster);

  let replyText = handoffResult.response?.ok
    ? handoffResult.response.reply?.text
    : undefined;

  // Async handoff accepted: Dina will POST the real answer via outbound-slack.
  // Do not invent a local ledger ack — that double-posts and misleads.
  if (!replyText && handoffResult.status !== "sent") {
    replyText = ledger.task.created
      ? `Got it — logged on Regi as “${ledger.task.title}” (task #${ledger.task.number}).`
      : `Updated Regi task #${ledger.task.number} (“${ledger.task.title}”).`;
  }

  return {
    handled: true,
    reason: "ok",
    reply: replyText
      ? {
          text: replyText,
          channelId: event.channelId,
          threadTs: event.threadTs,
        }
      : undefined,
    task: ledger.task,
    attention: ledger.attention,
    handoff: handoffResult.status,
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
