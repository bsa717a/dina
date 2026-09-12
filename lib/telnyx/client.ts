/**
 * Telnyx API client for sending RCS and SMS messages.
 *
 * preferRcs uses POST /v2/messages/rcs with agent_id + messaging_profile_id
 * and agent_message.content_message.text. Send agent_id is the string
 * `dina_4n1bd8jt_agent` (TELNYX_RCS_AGENT_ID). Status GETs use UUID
 * 42257dc9-586a-4f72-bba3-6b816d1ec6ed — do not send with that UUID.
 *
 * Do not attach sms_fallback. Telnyx will create an SMS from TELNYX_SMS_FROM,
 * return HTTP 200, and still look like a successful RCS send.
 *
 * SMS fallback is opt-in via allowSmsFallback and is reported as SMS.
 */

import { logger } from "@/lib/logger";
import { getTelnyxConfig } from "./config";
import { isRcsMessageType } from "./inbound";
import type {
  TelnyxMessageType,
  TelnyxRcsSendMessageRequest,
  TelnyxSendMessageRequest,
  TelnyxSendMessageResponse,
} from "./types";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

export interface SendMessageOptions {
  to: string;
  text: string;
  mediaUrls?: string[];
  preferRcs?: boolean;
  /**
   * When true, fall back to POST /v2/messages after an RCS failure.
   * Never report that SMS as type rcs.
   */
  allowSmsFallback?: boolean;
  /**
   * Rare override of TELNYX_RCS_AGENT_ID. Webhook/keyword/Grok replies
   * must not set this from inbound `to[].agent_id` (that value is the
   * status-GET UUID, not the send string).
   */
  agentId?: string;
}

export interface SendMessageResult {
  sent: boolean;
  messageId?: string;
  type?: TelnyxMessageType;
  error?: string;
}

async function telnyxRequest<T>(
  path: string,
  options: {
    method: "GET" | "POST" | "DELETE";
    body?: unknown;
  },
): Promise<T> {
  const config = getTelnyxConfig();
  if (!config) {
    throw new Error("Telnyx is not configured");
  }

  const url = `${TELNYX_API_BASE}${path}`;
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telnyx API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<T>;
}

async function sendRcsMessage(
  to: string,
  text: string,
  agentId: string,
): Promise<TelnyxSendMessageResponse> {
  const config = getTelnyxConfig();
  if (!config) {
    throw new Error("Telnyx is not configured");
  }
  if (!config.messagingProfileId) {
    throw new Error("Messaging profile not configured for RCS");
  }

  const body: TelnyxRcsSendMessageRequest = {
    agent_id: agentId,
    to,
    messaging_profile_id: config.messagingProfileId,
    type: "RCS",
    agent_message: {
      content_message: { text },
    },
  };

  return telnyxRequest<TelnyxSendMessageResponse>("/messages/rcs", {
    method: "POST",
    body,
  });
}

async function sendSmsMessage(
  to: string,
  text: string,
  mediaUrls?: string[],
): Promise<TelnyxSendMessageResponse> {
  const config = getTelnyxConfig();
  if (!config) {
    throw new Error("Telnyx is not configured");
  }

  const body: TelnyxSendMessageRequest = {
    from: config.smsFrom,
    to,
    text,
    type: mediaUrls?.length ? "MMS" : "SMS",
  };

  if (config.messagingProfileId) {
    body.messaging_profile_id = config.messagingProfileId;
  }

  if (mediaUrls?.length) {
    body.media_urls = mediaUrls;
  }

  return telnyxRequest<TelnyxSendMessageResponse>("/messages", {
    method: "POST",
    body,
  });
}

function rcsFailure(
  to: string,
  error: string,
  extras?: Record<string, unknown>,
): SendMessageResult {
  logger.error("telnyx_rcs_failed", { to, error, ...extras });
  return { sent: false, error };
}

export async function sendMessage(
  options: SendMessageOptions,
): Promise<SendMessageResult> {
  const config = getTelnyxConfig();
  if (!config) {
    return { sent: false, error: "Telnyx is not configured" };
  }

  const {
    to,
    text,
    mediaUrls,
    preferRcs = true,
    allowSmsFallback = false,
    agentId,
  } = options;
  const rcsAgentId = agentId?.trim() || config.rcsAgentId;

  if (preferRcs && rcsAgentId) {
    try {
      const response = await sendRcsMessage(to, text, rcsAgentId);
      const sentType = response.data?.type;
      const messageId = response.data?.id;
      const from = response.data?.from;

      if (isRcsMessageType(sentType)) {
        logger.info("telnyx_rcs_sent", {
          messageId,
          to,
          type: sentType,
          agentId: rcsAgentId,
          fromAgentId: from?.agent_id ?? null,
        });
        return {
          sent: true,
          messageId,
          type: sentType,
        };
      }

      const fallbackError =
        `Telnyx POST /v2/messages/rcs returned type ${String(sentType ?? "unknown")} ` +
        `(message ${messageId ?? "unknown"}) instead of RCS` +
        (from?.phone_number ? ` from ${from.phone_number}` : "");

      if (allowSmsFallback && (sentType === "SMS" || sentType === "MMS")) {
        logger.warn("telnyx_rcs_returned_sms", {
          to,
          messageId,
          type: sentType,
          from: from?.phone_number ?? null,
        });
        return {
          sent: true,
          messageId,
          type: sentType,
        };
      }

      return {
        ...rcsFailure(to, fallbackError, {
          messageId,
          type: sentType,
          fromPhone: from?.phone_number ?? null,
          fromAgentId: from?.agent_id ?? null,
        }),
        messageId,
        type: sentType,
      };
    } catch (rcsError) {
      const errorMsg =
        rcsError instanceof Error ? rcsError.message : "RCS send failed";
      if (!allowSmsFallback) {
        return rcsFailure(to, errorMsg);
      }
      logger.warn("telnyx_rcs_failed_trying_sms", {
        to,
        error: errorMsg,
      });
    }
  }

  try {
    const response = await sendSmsMessage(to, text, mediaUrls);
    logger.info("telnyx_sms_sent", {
      messageId: response.data.id,
      to,
      type: response.data.type,
    });
    return {
      sent: true,
      messageId: response.data.id,
      type: response.data.type,
    };
  } catch (smsError) {
    const errorMsg =
      smsError instanceof Error ? smsError.message : "SMS send failed";
    logger.error("telnyx_send_failed", {
      to,
      error: errorMsg,
    });
    return {
      sent: false,
      error: errorMsg,
    };
  }
}

export async function sendReply(
  to: string,
  text: string,
  preferRcs = true,
  extras?: Pick<SendMessageOptions, "allowSmsFallback" | "agentId">,
): Promise<SendMessageResult> {
  return sendMessage({ to, text, preferRcs, ...extras });
}
