/**
 * Telnyx RCS/SMS inbound webhook.
 *
 * Flow:
 * 1. Verify Telnyx webhook signature (when signing secret is configured)
 * 2. Parse the webhook payload
 * 3. Look up sender in the roster (User table by phone number)
 * 4. HELP / STOP / START (and aliases) send a local Telnyx reply immediately
 *    (RCS agent when inbound type is RCS). These must not wait on Grok.
 * 5. Other traffic hands off to Grok Bot Dina (or logs if the URL is unset)
 * 6. Send a Telnyx reply if Grok Bot returns sync `reply.text`
 *
 * Unknown numbers are safely rejected (logged, not auto-provisioned).
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { jsonError } from "@/lib/http";
import {
  isTelnyxConfigured,
  verifyTelnyxSignature,
  extractSignatureHeaders,
  lookupByPhoneNumber,
  handoffToGrokBot,
  sendReply,
  extractInboundFromPhone,
  extractInboundText,
  isRcsMessageType,
  matchTelnyxKeyword,
  normalizeInboundMessage,
  type TelnyxWebhookPayload,
  type TelnyxMessagePayload,
  type InboundMessageResult,
} from "@/lib/telnyx";

export const runtime = "nodejs";

async function processInboundMessage(
  message: TelnyxMessagePayload,
): Promise<InboundMessageResult> {
  const from = extractInboundFromPhone(message);
  const text = extractInboundText(message);
  const messageId = message.id;

  const roster = await lookupByPhoneNumber(from);

  if (!roster.found) {
    logger.warn("telnyx_unknown_sender", {
      messageId,
      from,
      text: text.slice(0, 50),
    });
    return {
      messageId,
      from,
      handled: false,
      handoff: "logged",
      roster,
    };
  }

  logger.info("telnyx_inbound_message", {
    messageId,
    from,
    userId: roster.user.id,
    userName: roster.user.name,
    projectKeys: roster.projectKeys,
    type: message.type,
    textLength: text.length,
  });

  const keyword = matchTelnyxKeyword(text);
  if (keyword) {
    const preferRcs = isRcsMessageType(message.type);
    const replyResult = await sendReply(from, keyword.text, preferRcs, {
      agentId: message.to[0]?.agent_id,
    });

    if (replyResult.sent) {
      logger.info("telnyx_keyword_reply_sent", {
        messageId,
        replyMessageId: replyResult.messageId,
        to: from,
        type: replyResult.type,
        keyword: keyword.kind,
        preferRcs,
      });
    } else {
      logger.error("telnyx_keyword_reply_failed", {
        messageId,
        to: from,
        keyword: keyword.kind,
        error: replyResult.error,
      });
    }

    return {
      messageId,
      from,
      handled: true,
      handoff: "skipped",
      roster,
      reply: replyResult,
    };
  }

  const handoffResult = await handoffToGrokBot(message, roster);

  const result: InboundMessageResult = {
    messageId,
    from,
    handled: roster.found,
    handoff: handoffResult.status,
    roster,
  };

  if (
    handoffResult.status === "sent" &&
    handoffResult.response?.ok &&
    handoffResult.response.reply?.text
  ) {
    const replyResult = await sendReply(
      from,
      handoffResult.response.reply.text,
      isRcsMessageType(message.type),
      { agentId: message.to[0]?.agent_id },
    );
    result.reply = replyResult;

    if (replyResult.sent) {
      logger.info("telnyx_reply_sent", {
        messageId,
        replyMessageId: replyResult.messageId,
        to: from,
        type: replyResult.type,
      });
    } else {
      logger.error("telnyx_reply_failed", {
        messageId,
        to: from,
        error: replyResult.error,
      });
    }
  }

  return result;
}

export async function POST(request: NextRequest) {
  if (!isTelnyxConfigured()) {
    logger.warn("telnyx_webhook_not_configured");
    return jsonError("Telnyx is not configured", 503);
  }

  const rawBody = await request.text();

  const { signature, timestamp } = extractSignatureHeaders(request.headers);
  const verification = verifyTelnyxSignature(rawBody, signature, timestamp);

  if (!verification.valid) {
    logger.warn("telnyx_signature_invalid", {
      reason: verification.reason,
    });
    return jsonError("Invalid webhook signature", 401);
  }

  let payload: TelnyxWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as TelnyxWebhookPayload;
  } catch {
    logger.error("telnyx_webhook_parse_error");
    return jsonError("Invalid JSON payload", 400);
  }

  const eventType = payload.data?.event_type;
  const rawMessage = payload.data?.payload;

  if (eventType !== "message.received") {
    logger.debug("telnyx_webhook_ignored", { eventType });
    return NextResponse.json({ ok: true, ignored: true, eventType });
  }

  if (!rawMessage || rawMessage.direction === "outbound") {
    logger.debug("telnyx_webhook_not_inbound", {
      direction: rawMessage?.direction,
    });
    return NextResponse.json({ ok: true, ignored: true, reason: "not_inbound" });
  }

  const message = normalizeInboundMessage(rawMessage, payload.data?.occurred_at);
  if (!message) {
    logger.warn("telnyx_webhook_unrecognized_payload", {
      eventType,
      hasPayload: Boolean(rawMessage),
    });
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "unrecognized_payload",
    });
  }

  try {
    const result = await processInboundMessage(message);
    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      handled: result.handled,
      handoff: result.handoff,
      reply: result.reply
        ? {
            sent: result.reply.sent,
            type: result.reply.type,
            ...(result.reply.error ? { error: result.reply.error } : {}),
          }
        : undefined,
    });
  } catch (error) {
    logger.error("telnyx_webhook_error", {
      error: error instanceof Error ? error.message : "unknown",
      messageId: message.id,
    });
    return jsonError("Internal server error", 500);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "telnyx-webhook",
    configured: isTelnyxConfigured(),
  });
}
