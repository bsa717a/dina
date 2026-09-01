/**
 * POST /api/grok/outbound
 *
 * Send an outbound message via Telnyx (RCS-first, SMS fallback).
 * Requires service token authentication.
 *
 * Body:
 *   - to: phone number in E.164 format (required)
 *   - text: message text (required)
 *   - preferRcs: whether to prefer RCS over SMS (default: true)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { sendMessage } from "@/lib/telnyx/client";
import { isTelnyxConfigured } from "@/lib/telnyx/config";
import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({
  to: z.string().min(1, "Phone number is required"),
  text: z.string().min(1, "Message text is required").max(2000),
  preferRcs: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  if (!isTelnyxConfigured()) {
    return jsonError("Telnyx is not configured", 503);
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

  const { to, text, preferRcs } = parsed.data;

  logger.info("grok_api_outbound_request", {
    to,
    textLength: text.length,
    preferRcs,
  });

  const result = await sendMessage({ to, text, preferRcs });

  if (!result.sent) {
    logger.error("grok_api_outbound_failed", {
      to,
      error: result.error,
    });
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Failed to send message",
      },
      { status: 502 },
    );
  }

  logger.info("grok_api_outbound_sent", {
    to,
    messageId: result.messageId,
    type: result.type,
  });

  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    type: result.type,
  });
}
