/**
 * Owner messaging admin.
 *
 * GET   list users with phone, consent, and opt-out
 * POST  send a text to a user (rcs_first or sms_only)
 * PATCH set a user's mobile number and SMS consent
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { logger } from "@/lib/logger";
import {
  listMessagingUsers,
  sendToPiperUser,
  updateUserPhoneConsent,
} from "@/lib/telnyx/messaging";
import {
  MessagingRequestError,
  SEND_CHANNELS,
  SMS_CONSENT_METHODS,
} from "@/lib/telnyx/messaging-policy";

export const runtime = "nodejs";

async function requireOwnerUser() {
  const user = await requireSession();
  if (!user) return { ok: false as const, response: unauthorized() };
  if (user.role !== "owner") {
    return { ok: false as const, response: forbidden("Only the owner can message teammates.") };
  }
  return { ok: true as const, user };
}

const sendSchema = z.object({
  userId: z.string().min(1, "Choose a user."),
  text: z.string().min(1, "Message text is required.").max(2000),
  channel: z.enum(SEND_CHANNELS).default("rcs_first"),
});

const phoneSchema = z.object({
  userId: z.string().min(1, "Choose a user."),
  phoneNumber: z.string().nullable(),
  consent: z.boolean(),
  consentMethod: z.enum(SMS_CONSENT_METHODS).nullable().optional(),
});

export async function GET() {
  const auth = await requireOwnerUser();
  if (!auth.ok) return auth.response;

  const users = await listMessagingUsers();
  return NextResponse.json({ ok: true, users });
}

export async function POST(request: NextRequest) {
  const auth = await requireOwnerUser();
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = sendSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request body", 400);
  }

  const { userId, text, channel } = parsed.data;
  logger.info("admin_message_send_request", {
    actorUserId: auth.user.id,
    userId,
    textLength: text.length,
    channel,
  });

  const outcome = await sendToPiperUser({
    actor: { kind: "admin", userId: auth.user.id },
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

export async function PATCH(request: NextRequest) {
  const auth = await requireOwnerUser();
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = phoneSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid request body", 400);
  }

  try {
    const user = await updateUserPhoneConsent({
      actorUserId: auth.user.id,
      userId: parsed.data.userId,
      phoneNumber: parsed.data.phoneNumber,
      consent: parsed.data.consent,
      consentMethod: parsed.data.consentMethod,
    });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    if (error instanceof MessagingRequestError) {
      return jsonError(error.message, error.status, { code: error.code });
    }
    logger.error("admin_phone_consent_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return jsonError("Could not save the mobile number.", 500);
  }
}
