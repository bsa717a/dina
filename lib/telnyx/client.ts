/**
 * Telnyx API client for sending RCS and SMS messages.
 *
 * Attempts RCS first when the RCS agent is configured, falls back to SMS.
 */

import { logger } from "@/lib/logger";
import { getTelnyxConfig } from "./config";
import type {
  TelnyxMessageType,
  TelnyxSendMessageRequest,
  TelnyxSendMessageResponse,
} from "./types";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

export interface SendMessageOptions {
  to: string;
  text: string;
  mediaUrls?: string[];
  preferRcs?: boolean;
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
): Promise<TelnyxSendMessageResponse> {
  const config = getTelnyxConfig();
  if (!config?.rcsAgentId) {
    throw new Error("RCS agent not configured");
  }

  return telnyxRequest<TelnyxSendMessageResponse>("/messages", {
    method: "POST",
    body: {
      from: config.smsFrom,
      to,
      text,
      type: "rcs",
      messaging_profile_id: config.messagingProfileId ?? undefined,
    } satisfies TelnyxSendMessageRequest,
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

export async function sendMessage(
  options: SendMessageOptions,
): Promise<SendMessageResult> {
  const config = getTelnyxConfig();
  if (!config) {
    return { sent: false, error: "Telnyx is not configured" };
  }

  const { to, text, mediaUrls, preferRcs = true } = options;

  if (preferRcs && config.rcsAgentId) {
    try {
      const response = await sendRcsMessage(to, text);
      logger.info("telnyx_rcs_sent", {
        messageId: response.data.id,
        to,
      });
      return {
        sent: true,
        messageId: response.data.id,
        type: "rcs",
      };
    } catch (rcsError) {
      logger.warn("telnyx_rcs_failed_trying_sms", {
        to,
        error: rcsError instanceof Error ? rcsError.message : "unknown",
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
): Promise<SendMessageResult> {
  return sendMessage({ to, text, preferRcs });
}
