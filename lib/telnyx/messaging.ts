/**
 * Admin and service-token sends, SMS consent, and STOP/START opt-out.
 *
 * Outbound sends require a mobile number, recorded consent, and no STOP
 * on that E.164 from any user. Owner edits never clear STOP. Keyword replies
 * (HELP, STOP, START) do not go through this gate.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { isTelnyxConfigured } from "./config";
import { sendMessage, type SendMessageResult } from "./client";
import { isCarrierRegistrationPending } from "./errors";
import type { TelnyxKeywordKind } from "./keywords";
import {
  channelAttempt,
  isOptedOutForNumber,
  isSmsConsentMethod,
  MessagingRequestError,
  normalizeLoggedChannel,
  sendBlockReason,
  SEND_BLOCK_MESSAGES,
  type SendBlockReason,
  type SendChannel,
  type SmsConsentMethod,
} from "./messaging-policy";
import { isValidE164, normalizePhoneNumber } from "./roster";

export { MessagingRequestError };

export type MessagingActor =
  | { kind: "admin"; userId: string }
  | { kind: "service" };

export interface MessagingUserSummary {
  id: string;
  name: string;
  username: string;
  role: string;
  phoneNumber: string | null;
  smsConsentAt: string | null;
  smsConsentMethod: string | null;
  smsConsentBy: { id: string; name: string } | null;
  smsOptedOutAt: string | null;
  smsOptedOutPhone: string | null;
  canSend: boolean;
  blockReason: SendBlockReason | null;
  blockMessage: string | null;
}

export type SendToUserResult =
  | {
      ok: true;
      messageId?: string;
      channel: string;
      type?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
      channel?: string;
    };

const userSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  phoneNumber: true,
  smsConsentAt: true,
  smsConsentMethod: true,
  smsOptedOutAt: true,
  smsOptedOutPhone: true,
  smsConsentBy: { select: { id: true, name: true } },
} as const;

type MessagingUserRow = {
  id: string;
  name: string;
  username: string;
  role: string;
  phoneNumber: string | null;
  smsConsentAt: Date | null;
  smsConsentMethod: string | null;
  smsOptedOutAt: Date | null;
  smsOptedOutPhone: string | null;
  smsConsentBy: { id: string; name: string } | null;
};

function toSummary(row: MessagingUserRow): MessagingUserSummary {
  const blockReason = sendBlockReason(row);
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    phoneNumber: row.phoneNumber,
    smsConsentAt: row.smsConsentAt?.toISOString() ?? null,
    smsConsentMethod: row.smsConsentMethod,
    smsConsentBy: row.smsConsentBy,
    smsOptedOutAt: row.smsOptedOutAt?.toISOString() ?? null,
    smsOptedOutPhone: row.smsOptedOutPhone,
    canSend: blockReason == null,
    blockReason,
    blockMessage: blockReason ? SEND_BLOCK_MESSAGES[blockReason] : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function writeLog(input: {
  actor: MessagingActor;
  recipientUserId: string;
  toPhone: string;
  channel: string;
  telnyxMessageId?: string;
  status: "sent" | "failed" | "blocked";
  error?: string;
}) {
  try {
    await prisma.smsMessageLog.create({
      data: {
        actorUserId: input.actor.kind === "admin" ? input.actor.userId : null,
        actorKind: input.actor.kind,
        recipientUserId: input.recipientUserId,
        toPhone: input.toPhone,
        channel: input.channel,
        telnyxMessageId: input.telnyxMessageId ?? null,
        status: input.status,
        error: input.error ?? null,
      },
    });
  } catch (error) {
    logger.error("sms_message_log_failed", {
      recipientUserId: input.recipientUserId,
      status: input.status,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function listMessagingUsers(): Promise<MessagingUserSummary[]> {
  const rows = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: userSelect,
  });
  return rows.map(toSummary);
}

export async function applyInboundKeyword(
  userId: string,
  kind: TelnyxKeywordKind,
  rawPhone?: string,
): Promise<void> {
  const phone = rawPhone ? normalizePhoneNumber(rawPhone) : "";
  const optedOutPhone = isValidE164(phone) ? phone : null;

  if (kind === "stop") {
    await prisma.user.update({
      where: { id: userId },
      data: {
        smsOptedOutAt: new Date(),
        ...(optedOutPhone ? { smsOptedOutPhone: optedOutPhone } : {}),
      },
    });
    return;
  }
  if (kind === "start") {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { smsOptedOutPhone: true },
    });
    if (
      row?.smsOptedOutPhone &&
      optedOutPhone &&
      row.smsOptedOutPhone !== optedOutPhone
    ) {
      return;
    }
    await prisma.user.update({
      where: { id: userId },
      data: { smsOptedOutAt: null, smsOptedOutPhone: null },
    });
  }
}

export async function isSmsOptedOut(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      phoneNumber: true,
      smsOptedOutAt: true,
      smsOptedOutPhone: true,
    },
  });
  if (!row) return false;
  return isOptedOutForNumber(row);
}

export async function updateUserPhoneConsent(input: {
  actorUserId: string;
  userId: string;
  phoneNumber: string | null;
  consent: boolean;
  consentMethod?: string | null;
}): Promise<MessagingUserSummary> {
  const existing = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, phoneNumber: true },
  });
  if (!existing) {
    throw new MessagingRequestError("User not found.", 404, "not_found");
  }

  let phoneNumber: string | null = null;
  if (input.phoneNumber?.trim()) {
    phoneNumber = normalizePhoneNumber(input.phoneNumber);
    if (!isValidE164(phoneNumber)) {
      throw new MessagingRequestError(
        "Enter a mobile number in E.164 format, like +14352382071.",
        400,
        "invalid_phone",
      );
    }
  }

  if (input.consent && !phoneNumber) {
    throw new MessagingRequestError(
      "Record a mobile number before recording SMS consent.",
      400,
      "consent_without_phone",
    );
  }

  let consentMethod: SmsConsentMethod | null = null;
  if (input.consent) {
    const method = input.consentMethod?.trim() ?? "";
    if (!isSmsConsentMethod(method)) {
      throw new MessagingRequestError(
        "Choose how SMS consent was recorded.",
        400,
        "invalid_consent_method",
      );
    }
    consentMethod = method;
  }

  const now = new Date();

  try {
    const updated = await prisma.user.update({
      where: { id: input.userId },
      data: {
        phoneNumber,
        smsConsentAt: input.consent ? now : null,
        smsConsentByUserId: input.consent ? input.actorUserId : null,
        smsConsentMethod: input.consent ? consentMethod : null,
      },
      select: userSelect,
    });
    return toSummary(updated);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new MessagingRequestError(
        "That mobile number is already on another user.",
        409,
        "phone_taken",
      );
    }
    throw error;
  }
}

function failureCode(result: SendMessageResult): string {
  if (isCarrierRegistrationPending(result.error)) {
    return "carrier_registration_pending";
  }
  return "send_failed";
}

/** Any user who texted STOP from this E.164, including after the number moved. */
async function smsOptOutHolder(phoneNumber: string): Promise<{ id: string } | null> {
  return prisma.user.findFirst({
    where: {
      smsOptedOutPhone: phoneNumber,
      smsOptedOutAt: { not: null },
    },
    select: { id: true },
  });
}

export async function sendToPiperUser(input: {
  actor: MessagingActor;
  userId: string;
  text: string;
  channel: SendChannel;
}): Promise<SendToUserResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: userSelect,
  });
  if (!user) {
    return { ok: false, status: 404, error: "User not found.", code: "not_found" };
  }

  const block = sendBlockReason(user);
  if (block) {
    const channel = channelAttempt(input.channel);
    await writeLog({
      actor: input.actor,
      recipientUserId: user.id,
      toPhone: user.phoneNumber ?? "",
      channel,
      status: "blocked",
      error: SEND_BLOCK_MESSAGES[block],
    });
    return {
      ok: false,
      status: 409,
      error: SEND_BLOCK_MESSAGES[block],
      code: block,
      channel,
    };
  }

  const phone = user.phoneNumber as string;
  const holder = await smsOptOutHolder(phone);
  if (holder) {
    const channel = channelAttempt(input.channel);
    await writeLog({
      actor: input.actor,
      recipientUserId: user.id,
      toPhone: phone,
      channel,
      status: "blocked",
      error: SEND_BLOCK_MESSAGES.opted_out,
    });
    return {
      ok: false,
      status: 409,
      error: SEND_BLOCK_MESSAGES.opted_out,
      code: "opted_out",
      channel,
    };
  }

  if (!isTelnyxConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Telnyx is not configured",
      code: "not_configured",
    };
  }

  const preferRcs = input.channel === "rcs_first";
  const result = await sendMessage({
    to: phone,
    text: input.text,
    preferRcs,
    allowSmsFallback: false,
  });
  const channel = normalizeLoggedChannel(result.type, input.channel);

  if (!result.sent) {
    await writeLog({
      actor: input.actor,
      recipientUserId: user.id,
      toPhone: phone,
      channel,
      telnyxMessageId: result.messageId,
      status: "failed",
      error: result.error ?? "Failed to send message",
    });
    return {
      ok: false,
      status: 502,
      error: result.error ?? "Failed to send message",
      code: failureCode(result),
      channel,
    };
  }

  await writeLog({
    actor: input.actor,
    recipientUserId: user.id,
    toPhone: phone,
    channel,
    telnyxMessageId: result.messageId,
    status: "sent",
  });

  logger.info("sms_message_sent", {
    actorKind: input.actor.kind,
    actorUserId: input.actor.kind === "admin" ? input.actor.userId : null,
    recipientUserId: user.id,
    channel,
    telnyxMessageId: result.messageId ?? null,
  });

  return {
    ok: true,
    messageId: result.messageId,
    channel,
    type: result.type,
  };
}

export async function sendToPhoneOrUser(input: {
  actor: MessagingActor;
  to: string;
  text: string;
  channel: SendChannel;
}): Promise<SendToUserResult | { raw: true; result: SendMessageResult }> {
  const phoneNumber = normalizePhoneNumber(input.to);
  if (isValidE164(phoneNumber)) {
    const optedOut = await smsOptOutHolder(phoneNumber);
    if (optedOut) {
      const channel = channelAttempt(input.channel);
      await writeLog({
        actor: input.actor,
        recipientUserId: optedOut.id,
        toPhone: phoneNumber,
        channel,
        status: "blocked",
        error: SEND_BLOCK_MESSAGES.opted_out,
      });
      return {
        ok: false,
        status: 409,
        error: SEND_BLOCK_MESSAGES.opted_out,
        code: "opted_out",
        channel,
      };
    }

    const user = await prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });
    if (user) {
      return sendToPiperUser({
        actor: input.actor,
        userId: user.id,
        text: input.text,
        channel: input.channel,
      });
    }
  }

  if (!isTelnyxConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "Telnyx is not configured",
      code: "not_configured",
    };
  }

  const result = await sendMessage({
    to: input.to,
    text: input.text,
    preferRcs: input.channel === "rcs_first",
    allowSmsFallback: false,
  });
  return { raw: true, result };
}

