/**
 * POST /api/grok/outbound
 *
 * Send an outbound message via Telnyx (RCS when preferRcs, else SMS).
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
import { isCarrierRegistrationPending } from "@/lib/telnyx/errors";
import { sendToPhoneOrUser } from "@/lib/telnyx/messaging";
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
  const channel = preferRcs ? "rcs_first" : "sms_only";

  logger.info("grok_api_outbound_request", {
    to,
    textLength: text.length,
    preferRcs,
  });

  const outcome = await sendToPhoneOrUser({
    actor: { kind: "service" },
    to,
    text,
    channel,
  });

  if ("raw" in outcome) {
    const result = outcome.result;
    if (!result.sent) {
      logger.error("grok_api_outbound_failed", {
        to,
        error: result.error,
      });
      return NextResponse.json(
        {
          ok: false,
          error: result.error ?? "Failed to send message",
          ...(isCarrierRegistrationPending(result.error)
            ? { code: "carrier_registration_pending" }
            : {}),
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

  if (!outcome.ok) {
    logger.error("grok_api_outbound_failed", {
      to,
      error: outcome.error,
      code: outcome.code,
    });
    return NextResponse.json(
      { ok: false, error: outcome.error, code: outcome.code },
      { status: outcome.status },
    );
  }

  logger.info("grok_api_outbound_sent", {
    to,
    messageId: outcome.messageId,
    type: outcome.type,
    channel: outcome.channel,
  });

  return NextResponse.json({
    ok: true,
    messageId: outcome.messageId,
    type: outcome.type,
    channel: outcome.channel,
  });
}
