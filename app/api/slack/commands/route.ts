/**
 * Slack slash commands for the Regi-only Piper bot.
 *
 * Request URL (Slack App → Slash Commands → /piper):
 *   https://dina.clifsmama.com/api/slack/commands
 *
 * Same signing secret as Events API. Same board store as the web UI.
 * Never wakes Grok Bot / Old Dina. Telnyx RCS is unchanged.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { jsonError } from "@/lib/http";
import {
  extractSlackSignatureHeaders,
  inferSlackChannelType,
  isChannelAllowed,
  isSlackConfigured,
  lookupBySlackUserId,
  parseSlackSlashPayload,
  processPiperCommand,
  resolveRegiProjectKey,
  verifySlackSignature,
  NOT_ON_REGI_REPLY,
  PIPER_COMMAND_USAGE,
  UNKNOWN_USER_REPLY,
} from "@/lib/slack";

export const runtime = "nodejs";

function formValue(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? "";
}

function ephemeral(text: string) {
  return NextResponse.json({
    response_type: "ephemeral",
    text,
  });
}

export async function POST(request: NextRequest) {
  if (!isSlackConfigured()) {
    logger.warn("slack_commands_not_configured");
    return jsonError("Slack is not configured", 503);
  }

  const rawBody = await request.text();
  const { signature, timestamp } = extractSlackSignatureHeaders(request.headers);
  const verification = verifySlackSignature(rawBody, signature, timestamp);

  if (!verification.valid) {
    logger.warn("slack_command_signature_invalid", { reason: verification.reason });
    return jsonError("Invalid webhook signature", 401);
  }

  const params = new URLSearchParams(rawBody);

  if (formValue(params, "ssl_check") === "1") {
    return NextResponse.json({ ok: true });
  }

  const command = formValue(params, "command") || "/piper";
  const text = formValue(params, "text");
  const slackUserId = formValue(params, "user_id");
  const channelId = formValue(params, "channel_id");
  const channelName = formValue(params, "channel_name");

  if (!slackUserId) {
    return ephemeral("Missing Slack user id.");
  }

  const channelType = inferSlackChannelType(channelId, channelName);
  if (channelId && !isChannelAllowed(channelId, channelType)) {
    logger.info("slack_command_channel_not_allowed", { channelId, channelType });
    return ephemeral(
      "Piper slash commands only work in the allowed Regi Slack channels.",
    );
  }

  try {
    const roster = await lookupBySlackUserId(slackUserId);
    if (!roster.found) {
      return ephemeral(UNKNOWN_USER_REPLY);
    }
    if (!roster.onRegiProject) {
      return ephemeral(NOT_ON_REGI_REPLY);
    }

    const parsed = parseSlackSlashPayload(command, text);
    const result = await processPiperCommand({
      parsed,
      roster,
      channelId,
    });

    logger.info("slack_slash_command", {
      slackUserId,
      userId: roster.user.id,
      command,
      verb: parsed.verb,
      kind: result.kind,
      taskNumber: result.task?.number,
    });

    return ephemeral(result.text);
  } catch (error) {
    logger.error("slack_command_webhook_error", {
      error: error instanceof Error ? error.message : "unknown",
      slackUserId,
    });
    return ephemeral(
      "Couldn't update the Regi board just now. Try again or use the web board.",
    );
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
    service: "slack-commands",
    configured: isSlackConfigured(),
    projectKey,
    scope: "regi",
    usage: PIPER_COMMAND_USAGE,
    ...(projectError ? { projectError } : {}),
  });
}
