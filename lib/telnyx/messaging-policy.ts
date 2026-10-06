/**
 * Pure send gates. No database access, so the admin UI and tests can share them.
 */

export const SMS_CONSENT_METHODS = [
  "verbal",
  "written",
  "web_form",
  "in_person",
] as const;

export type SmsConsentMethod = (typeof SMS_CONSENT_METHODS)[number];

export const SEND_CHANNELS = ["rcs_first", "sms_only"] as const;

export type SendChannel = (typeof SEND_CHANNELS)[number];

export type SendBlockReason = "no_phone" | "no_consent" | "opted_out";

export const SEND_BLOCK_MESSAGES: Record<SendBlockReason, string> = {
  no_phone: "This user has no mobile number.",
  no_consent: "SMS consent has not been recorded for this user.",
  opted_out:
    "This user opted out of messages. They can reply START to resume.",
};

export function isSmsConsentMethod(value: string): value is SmsConsentMethod {
  return (SMS_CONSENT_METHODS as readonly string[]).includes(value);
}

/**
 * STOP sticks to the E.164 that sent it. A different saved number is not opted out.
 * Rows that predate smsOptedOutPhone treat the number currently on file as the STOP number.
 */
export function isOptedOutForNumber(user: {
  phoneNumber: string | null;
  smsOptedOutAt: Date | string | null;
  smsOptedOutPhone?: string | null;
}): boolean {
  if (!user.smsOptedOutAt || !user.phoneNumber?.trim()) return false;
  if (!user.smsOptedOutPhone) return true;
  return user.smsOptedOutPhone === user.phoneNumber;
}

export function sendBlockReason(user: {
  phoneNumber: string | null;
  smsConsentAt: Date | string | null;
  smsOptedOutAt: Date | string | null;
  smsOptedOutPhone?: string | null;
}): SendBlockReason | null {
  if (!user.phoneNumber?.trim()) return "no_phone";
  if (isOptedOutForNumber(user)) return "opted_out";
  if (!user.smsConsentAt) return "no_consent";
  return null;
}

export function channelAttempt(channel: SendChannel): "rcs" | "sms" {
  return channel === "sms_only" ? "sms" : "rcs";
}

export class MessagingRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "MessagingRequestError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeLoggedChannel(
  type: string | undefined,
  channel: SendChannel,
): string {
  const normalized = type?.toLowerCase();
  if (normalized === "rcs" || normalized === "sms" || normalized === "mms") {
    return normalized;
  }
  return channelAttempt(channel);
}
