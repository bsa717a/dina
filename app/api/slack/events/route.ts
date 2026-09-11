/**
 * Slack Events API webhook (Regi project only).
 *
 * Kept for url_verification and as an HTTP fallback. When Socket Mode is
 * enabled in the Slack app, Slack delivers app_mention / message over the
 * WebSocket (see lib/slack/socket.ts), not this Request URL.
 *
 * Telnyx RCS for 4SL is unchanged (see /api/telnyx/webhook).
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { jsonError } from "@/lib/http";
import {
  extractSlackSignatureHeaders,
  getSlackSocketStatus,
  handleSlackInboundCallback,
  isSlackConfigured,
  isSlackSocketModeConfigured,
  resolveRegiProjectKey,
  verifySlackSignature,
  type SlackEventCallback,
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
    const challenge =
      typeof payload.challenge === "string" ? payload.challenge : "";
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

  const callback = payload as unknown as SlackEventCallback;

  try {
    const result = await handleSlackInboundCallback(callback);

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
      eventId: callback.event_id,
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

  const socketMode = getSlackSocketStatus();
  const socketConfigured = isSlackSocketModeConfigured();

  return NextResponse.json({
    ok: true,
    service: "slack-events",
    configured: isSlackConfigured(),
    inbound: socketConfigured ? "socket" : "http",
    socketMode: {
      configured: socketConfigured,
      started: socketMode.started,
      connected: socketMode.connected,
      source: socketMode.source,
      lastError: socketMode.lastError,
      lastEventAt: socketMode.lastEventAt,
    },
    projectKey,
    scope: "regi",
    ...(projectError ? { projectError } : {}),
  });
}
