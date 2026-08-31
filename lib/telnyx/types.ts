/**
 * Telnyx RCS/SMS webhook and API types.
 */

export type TelnyxMessageType = "rcs" | "SMS" | "MMS";

export type TelnyxWebhookEventType =
  | "message.received"
  | "message.sent"
  | "message.finalized"
  | "message.delivery_update";

export type TelnyxDirection = "inbound" | "outbound";

export interface TelnyxWebhookPayload {
  data: {
    event_type: TelnyxWebhookEventType;
    id: string;
    occurred_at: string;
    payload: TelnyxMessagePayload;
    record_type: "event";
  };
  meta: {
    attempt: number;
    delivered_to: string;
  };
}

export interface TelnyxMessagePayload {
  completed_at: string | null;
  cost: { amount: string; currency: string } | null;
  direction: TelnyxDirection;
  encoding: string;
  errors: unknown[];
  from: TelnyxPhoneAddress;
  id: string;
  media?: TelnyxMedia[];
  messaging_profile_id: string;
  organization_id: string;
  parts: number;
  received_at: string;
  record_type: "message";
  sent_at: string | null;
  text: string;
  to: TelnyxPhoneAddress[];
  type: TelnyxMessageType;
  valid_until: string | null;
  webhook_failover_url: string | null;
  webhook_url: string | null;
}

export interface TelnyxPhoneAddress {
  carrier: string;
  line_type: string;
  phone_number: string;
  status?: string;
}

export interface TelnyxMedia {
  content_type: string;
  sha256: string;
  size: number;
  url: string;
}

export interface TelnyxSendMessageRequest {
  from: string;
  to: string;
  text: string;
  messaging_profile_id?: string;
  type?: TelnyxMessageType;
  subject?: string;
  media_urls?: string[];
}

export interface TelnyxRcsSendMessageRequest {
  from: string;
  to: string;
  text: string;
  messaging_profile_id?: string;
}

export interface TelnyxSendMessageResponse {
  data: {
    id: string;
    record_type: "message";
    direction: TelnyxDirection;
    type: TelnyxMessageType;
    from: TelnyxPhoneAddress;
    to: TelnyxPhoneAddress[];
    text: string;
    messaging_profile_id: string;
    organization_id: string;
    cost: { amount: string; currency: string } | null;
    parts: number;
    encoding: string;
    errors: unknown[];
    webhook_url: string | null;
    webhook_failover_url: string | null;
    valid_until: string | null;
  };
}

export type RosterLookupResult =
  | {
      found: true;
      user: {
        id: string;
        name: string;
        username: string;
        phoneNumber: string;
      };
      projectKeys: string[];
    }
  | {
      found: false;
      phoneNumber: string;
      reason: "unknown_number";
    };

export interface GrokBotHandoffPayload {
  messageId: string;
  from: string;
  to: string;
  text: string;
  messageType: TelnyxMessageType;
  receivedAt: string;
  user: {
    id: string;
    name: string;
    username: string;
  } | null;
  projectKeys: string[];
  media?: TelnyxMedia[];
}

export interface GrokBotHandoffResponse {
  ok: boolean;
  reply?: {
    text: string;
    mediaUrls?: string[];
  };
  error?: string;
}

export interface InboundMessageResult {
  messageId: string;
  from: string;
  handled: boolean;
  handoff: "sent" | "logged" | "error";
  roster: RosterLookupResult;
  reply?: {
    sent: boolean;
    messageId?: string;
    type?: TelnyxMessageType;
    error?: string;
  };
}
