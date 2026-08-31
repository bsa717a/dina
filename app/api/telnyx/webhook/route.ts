/**
 * Telnyx RCS/SMS inbound webhook.
 *
 * Flow:
 * 1. Verify Telnyx webhook signature (when signing secret is configured)
 * 2. Parse the webhook payload
 * 3. Look up sender in the roster (User table by phone number)
 * 4. Hand off to Grok Bot Dina (or log if Grok Bot URL is not set)
 * 5. Send reply back via Telnyx if Grok Bot provides one
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
  type TelnyxWebhookPayload,
  type TelnyxMessagePayload,
  type InboundMessageResult,
} from "@/lib/telnyx";

export const runtime = "nodejs";

async function processInboundMessage(
  message: TelnyxMessagePayload,
): Promise<InboundMessageResult> {
  const from = message.from.phone_number;
  const messageId = message.id;

  const roster = await lookupByPhoneNumber(from);

  if (!roster.found) {
    logger.warn("telnyx_unknown_sender", {
      messageId,
      from,
      text: message.text.slice(0, 50),
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
    textLength: message.text.length,
  });

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
    const replyResult = await sendReply(from, handoffResult.response.reply.text);
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
  const message = payload.data?.payload;

  if (eventType !== "message.received") {
    logger.debug("telnyx_webhook_ignored", { eventType });
    return NextResponse.json({ ok: true, ignored: true, eventType });
  }

  if (!message || message.direction !== "inbound") {
    logger.debug("telnyx_webhook_not_inbound", {
      direction: message?.direction,
    });
    return NextResponse.json({ ok: true, ignored: true, reason: "not_inbound" });
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
