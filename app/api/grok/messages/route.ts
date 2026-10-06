/**
 * POST /api/grok/messages
 *
 * Service-token send to a Piper user by id. Requires a mobile number,
 * recorded SMS consent, and no STOP opt-out.
 *
 * Body:
 *   - userId: Piper user id (required)
 *   - text: message text (required)
 *   - channel: "rcs_first" (default) or "sms_only"
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { sendToPiperUser } from "@/lib/telnyx/messaging";
import { SEND_CHANNELS } from "@/lib/telnyx/messaging-policy";

export const runtime = "nodejs";

const bodySchema = z.object({
  userId: z.string().min(1, "User id is required"),
  text: z.string().min(1, "Message text is required").max(2000),
  channel: z.enum(SEND_CHANNELS).default("rcs_first"),
});

export async function POST(request: NextRequest) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

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

  const { userId, text, channel } = parsed.data;
  logger.info("grok_api_user_message_request", {
    userId,
    textLength: text.length,
    channel,
  });

  const outcome = await sendToPiperUser({
    actor: { kind: "service" },
    userId,
    text,
    channel,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, error: outcome.error, code: outcome.code },
      { status: outcome.status },
    );
  }

  return NextResponse.json({
    ok: true,
    messageId: outcome.messageId,
    channel: outcome.channel,
    type: outcome.type,
  });
}
