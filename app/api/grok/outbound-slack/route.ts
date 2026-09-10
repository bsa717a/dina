/**
 * POST /api/grok/outbound-slack
 *
 * Send an outbound Slack reply into a channel / thread.
 * Requires service token authentication.
 *
 * Body:
 *   - channelId: Slack channel id (required)
 *   - text: message text (required)
 *   - threadTs: Slack thread timestamp (optional, required to stay in-thread)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { isSlackConfigured } from "@/lib/slack/config";
import { postSlackMessage } from "@/lib/slack/client";
import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({
  channelId: z.string().min(1, "channelId is required"),
  text: z.string().min(1, "Message text is required").max(4000),
  threadTs: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  if (!isSlackConfigured()) {
    return jsonError("Slack is not configured", 503);
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request body", 400);
  }

  const { channelId, text, threadTs } = parsed.data;

  logger.info("grok_api_outbound_slack_request", {
    channelId,
    threadTs,
    textLength: text.length,
  });

  const result = await postSlackMessage({ channelId, text, threadTs });

  if (!result.sent) {
    logger.error("grok_api_outbound_slack_failed", {
      channelId,
      error: result.error,
    });
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Failed to send Slack message",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    messageTs: result.messageTs,
  });
}
