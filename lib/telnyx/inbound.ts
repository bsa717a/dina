/**
 * Coerce Telnyx inbound SMS / RCS payloads into a safe string text.
 *
 * SMS: `payload.text` is a plain string.
 * RCS: Telnyx nests the body at `payload.body.text` (object, not string).
 * Some agents also send `text` as JSON (`{"text":"Help"}`) or `{ text: "Help" }`.
 */

import type {
  TelnyxDirection,
  TelnyxMessagePayload,
  TelnyxMessageType,
  TelnyxPhoneAddress,
} from "./types";

const MESSAGE_TYPES = new Set<TelnyxMessageType>(["rcs", "RCS", "SMS", "MMS"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Extract user-visible text from a string, `{ text: "..." }` object,
 * or a JSON string of that object. Recurses one nested `body` / suggestion.
 */
export function extractInboundText(raw: unknown, depth = 0): string {
  if (raw == null || depth > 4) return "";

  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === "string") return parsed;
        const nested = extractInboundText(parsed, depth + 1);
        if (nested) return nested;
      } catch {
        // Literal SMS that happens to look like JSON.
      }
    }
    return raw;
  }

  const obj = asRecord(raw);
  if (!obj) return "";

  if ("text" in obj) {
    const fromText = extractInboundText(obj.text, depth + 1);
    if (fromText) return fromText;
  }

  if ("body" in obj) {
    const fromBody = extractInboundText(obj.body, depth + 1);
    if (fromBody) return fromBody;
  }

  const suggestion = asRecord(obj.suggestion_response);
  if (suggestion) {
    const fromSuggestion = extractInboundText(suggestion.text, depth + 1);
    if (fromSuggestion) return fromSuggestion;
  }

  return "";
}

export function extractInboundFromPhone(payload: unknown): string {
  const obj = asRecord(payload);
  if (!obj) return "";

  const from = obj.from;
  if (typeof from === "string") return from.trim();

  const fromObj = asRecord(from);
  if (fromObj && typeof fromObj.phone_number === "string") {
    return fromObj.phone_number.trim();
  }

  return "";
}

export function extractInboundTo(payload: unknown): string {
  const obj = asRecord(payload);
  if (!obj) return "";

  if (typeof obj.to === "string") return obj.to.trim();

  const first = Array.isArray(obj.to) ? obj.to[0] : null;
  if (typeof first === "string") return first.trim();

  const dest = asRecord(first);
  if (!dest) return "";

  if (typeof dest.phone_number === "string" && dest.phone_number.trim()) {
    return dest.phone_number.trim();
  }
  if (typeof dest.agent_id === "string" && dest.agent_id.trim()) {
    return dest.agent_id.trim();
  }

  return "";
}

/**
 * Inbound with no user text and no suggestion postback.
 * Logged by the webhook and never forwarded as a blank handoff.
 */
export type NonTextInboundKind = "is_typing" | "reaction" | "media" | "blank";

function bodyEventType(body: Record<string, unknown> | null): string {
  const value = body?.event_type;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isReactionBody(
  body: Record<string, unknown> | null,
  eventType: string,
): boolean {
  if (!body) return false;
  if (eventType === "reaction" || eventType.endsWith("_reaction")) return true;
  const reaction = body.reaction;
  return Boolean(reaction && typeof reaction === "object");
}

function hasInboundMedia(
  obj: Record<string, unknown> | null,
  body: Record<string, unknown> | null,
): boolean {
  if (Array.isArray(obj?.media) && obj.media.length > 0) return true;
  const file = body?.user_file;
  return Boolean(file && typeof file === "object");
}

/**
 * `is_typing` is `body.event_type` on a message.received payload.
 * RCS files are `body.user_file`; MMS files are `media[]`.
 * A reaction object on `body` (or an event_type ending in reaction) is logged
 * the same way. Text or a suggestion postback returns null so Done still runs.
 */
export function classifyNonTextInbound(raw: unknown): NonTextInboundKind | null {
  if (extractInboundText(raw).trim() || extractSuggestionPostback(raw).trim()) {
    return null;
  }

  const obj = asRecord(raw);
  const body = obj ? asRecord(obj.body) : null;
  const eventType = bodyEventType(body);
  if (eventType === "is_typing") return "is_typing";
  if (isReactionBody(body, eventType)) return "reaction";
  if (hasInboundMedia(obj, body)) return "media";
  return "blank";
}

/** Postback from a tapped RCS suggestion (`body.suggestion_response.postback_data`). */
export function extractSuggestionPostback(raw: unknown): string {
  const obj = asRecord(raw);
  if (!obj) return "";

  const body = asRecord(obj.body);
  const nested = body ? asRecord(body.suggestion_response) : null;
  const top = asRecord(obj.suggestion_response);
  const data = nested?.postback_data ?? top?.postback_data;
  return typeof data === "string" ? data.trim() : "";
}

export function isRcsMessageType(
  type: TelnyxMessageType | string | undefined,
): boolean {
  return type === "rcs" || type === "RCS";
}

function normalizeMessageType(raw: unknown): TelnyxMessageType {
  if (typeof raw === "string" && MESSAGE_TYPES.has(raw as TelnyxMessageType)) {
    return raw as TelnyxMessageType;
  }
  return "SMS";
}

function normalizeAddress(
  raw: unknown,
  fallbackPhone: string,
): TelnyxPhoneAddress {
  const obj = asRecord(raw);
  return {
    carrier: typeof obj?.carrier === "string" ? obj.carrier : "",
    line_type: typeof obj?.line_type === "string" ? obj.line_type : "",
    phone_number:
      typeof obj?.phone_number === "string" && obj.phone_number.trim()
        ? obj.phone_number.trim()
        : fallbackPhone,
    status: typeof obj?.status === "string" ? obj.status : undefined,
    agent_id: typeof obj?.agent_id === "string" ? obj.agent_id : undefined,
    agent_name: typeof obj?.agent_name === "string" ? obj.agent_name : undefined,
  };
}

/**
 * Produce a TelnyxMessagePayload whose `text` and `from.phone_number` are
 * always strings, whether the wire payload was SMS or RCS.
 */
export function normalizeInboundMessage(
  raw: unknown,
  occurredAt?: string,
): TelnyxMessagePayload | null {
  const p = asRecord(raw);
  if (!p) return null;

  const id = typeof p.id === "string" ? p.id : "";
  if (!id) return null;

  const fromPhone = extractInboundFromPhone(p);
  const toValue = extractInboundTo(p);
  const toRaw = Array.isArray(p.to) ? p.to[0] : p.to;

  const direction: TelnyxDirection =
    p.direction === "outbound" ? "outbound" : "inbound";

  return {
    completed_at: typeof p.completed_at === "string" ? p.completed_at : null,
    cost:
      p.cost && typeof p.cost === "object"
        ? (p.cost as TelnyxMessagePayload["cost"])
        : null,
    direction,
    encoding: typeof p.encoding === "string" ? p.encoding : "",
    errors: Array.isArray(p.errors) ? p.errors : [],
    from: normalizeAddress(p.from, fromPhone),
    id,
    media: Array.isArray(p.media) ? (p.media as TelnyxMessagePayload["media"]) : undefined,
    messaging_profile_id:
      typeof p.messaging_profile_id === "string" ? p.messaging_profile_id : "",
    organization_id: typeof p.organization_id === "string" ? p.organization_id : "",
    parts: typeof p.parts === "number" ? p.parts : 1,
    received_at:
      typeof p.received_at === "string"
        ? p.received_at
        : occurredAt || new Date().toISOString(),
    record_type: "message",
    sent_at: typeof p.sent_at === "string" ? p.sent_at : null,
    text: extractInboundText(p),
    body: asRecord(p.body) ?? undefined,
    to: [normalizeAddress(toRaw, toValue)],
    type: normalizeMessageType(p.type),
    valid_until: typeof p.valid_until === "string" ? p.valid_until : null,
    webhook_failover_url:
      typeof p.webhook_failover_url === "string" ? p.webhook_failover_url : null,
    webhook_url: typeof p.webhook_url === "string" ? p.webhook_url : null,
  };
}
