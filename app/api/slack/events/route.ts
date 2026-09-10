/**
 * Slack Events API webhook (Regi project only).
 *
 * Flow:
 * 1. url_verification → echo challenge
 * 2. Verify Slack signing secret
 * 3. Parse app_mention / message events
 * 4. Roster lookup → Regi task/Attention → Grok Bot handoff
 * 5. Reply in the same Slack thread
 *
 * Telnyx RCS for 4SL is unchanged (see /api/telnyx/webhook).
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { jsonError } from "@/lib/http";
import {
  deliverSlackReply,
  extractSlackSignatureHeaders,
  isSlackConfigured,
  parseSlackInboundEvent,
  processSlackInbound,
  resolveRegiProjectKey,
  verifySlackSignature,
  type SlackEventCallback,
  type SlackUrlVerification,
} from "@/lib/slack";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSlackConfigured()) {
    logger.warn("slack_webhook_not_configured");
    return jsonError("Slack is not configured", 503);
  }

  const rawBody = await request.text();
  const { signature, timestamp } = extractSlackSignatureHeaders(request.headers);
  const verification = verifySlackSignature(rawBody, signature, timestamp);

  if (!verification.valid) {
    logger.warn("slack_signature_invalid", { reason: verification.reason });
    return jsonError("Invalid webhook signature", 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    logger.error("slack_webhook_parse_error");
    return jsonError("Invalid JSON payload", 400);
  }

  if (payload.type === "url_verification") {
    const challenge = (payload as SlackUrlVerification).challenge;
    if (!challenge) {
      return jsonError("Missing challenge", 400);
    }
    return NextResponse.json({ challenge });
  }

  if (payload.type !== "event_callback") {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "unhandled_type",
    });
  }

  const callback = payload as SlackEventCallback;
  const event = parseSlackInboundEvent(callback);
  if (!event) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "unhandled_event",
    });
  }

  try {
    const result = await processSlackInbound(event);
    await deliverSlackReply(result);

    return NextResponse.json({
      ok: true,
      handled: result.handled,
      ignored: result.ignored ?? false,
      reason: result.reason,
      handoff: result.handoff,
      task: result.task
        ? {
            id: result.task.id,
            number: result.task.number,
            created: result.task.created,
          }
        : undefined,
    });
  } catch (error) {
    logger.error("slack_webhook_error", {
      error: error instanceof Error ? error.message : "unknown",
      eventTs: event.ts,
    });
    return jsonError("Internal server error", 500);
  }
}

export async function GET() {
  let projectKey: string | null = null;
  let projectError: string | undefined;
  try {
    projectKey = isSlackConfigured() ? resolveRegiProjectKey() : null;
  } catch (error) {
    projectError = error instanceof Error ? error.message : "invalid project slug";
  }

  return NextResponse.json({
    ok: true,
    service: "slack-events",
    configured: isSlackConfigured(),
    projectKey,
    scope: "regi",
    ...(projectError ? { projectError } : {}),
  });
}
