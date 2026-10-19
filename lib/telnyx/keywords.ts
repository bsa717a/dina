/**
 * Carrier / RCS keyword auto-replies (HELP, STOP, STOPALL, START, and aliases).
 *
 * These must send an immediate Telnyx outbound. Grok Bot handoff is async
 * and often returns `{ ok: true }` with no `reply.text`, which previously
 * acknowledged the inbound and never messaged the handset.
 *
 * Brand key is the inbound RCS `to[].agent_id` UUID. That field is what
 * message.received actually carries (the status UUID, not the send-string
 * agent name). `messaging_profile_id` is also on the payload, but the
 * Cliffs Mama discriminator we have is this agent UUID, and SMS inbound
 * often has no agent id. A missing or unknown agent uses 4StudentLives.
 *
 * 4StudentLives HELP and START are registered campaign text. Do not paraphrase.
 * Cliffs Mama HELP keeps that sentence shape. The phone-number contact is
 * replaced with labeled privacy and terms URLs so the two links are not an
 * unlabeled pair. STOP names the program; STOPALL and the other opt-out
 * aliases share that reply.
 */

export type TelnyxKeywordKind = "help" | "stop" | "start";

export interface TelnyxKeywordReply {
  kind: TelnyxKeywordKind;
  text: string;
}

/** Cliffs Mama Dina RCS agent. Inbound `to[].agent_id`, not the send string. */
export const CLIFFS_MAMA_RCS_AGENT_ID = "1f2bf18b-a131-4429-8171-58e5202d4a39";

/** HELP and START use registered 4StudentLives campaign wording. Do not paraphrase. */
export const TELNYX_KEYWORD_REPLIES: Record<TelnyxKeywordKind, string> = {
  help: "4StudentLives: For help, reply HELP or contact us at +14352382071. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out.",
  stop: "You have successfully been unsubscribed from texts from 4StudentLives, you will not receive any more messages from this number. Reply START to re-subscribe.",
  start:
    "You have agreed to receive SMS updates from 4StudentLives. Msg freq may vary. Std msg & data rates apply. Reply STOP to opt out, HELP for help.",
};

/**
 * Same shape as the 4StudentLives HELP, with the phone number replaced by
 * labeled policy URLs. "contact us at" was written for one phone number;
 * naming each link keeps privacy and terms distinct.
 */
export const CLIFFS_MAMA_KEYWORD_REPLIES: Record<TelnyxKeywordKind, string> = {
  help: "Clif's Mama: For help, reply HELP or see our privacy policy at https://www.clifsmama.com/privacy.html and terms at https://www.clifsmama.com/terms.html. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out.",
  stop: "You have successfully been unsubscribed from texts from Clif's Mama, you will not receive any more messages from this number. Reply START to re-subscribe.",
  start:
    "You have agreed to receive SMS updates from Clif's Mama. Msg freq may vary. Std msg & data rates apply. Reply STOP to opt out, HELP for help.",
};

const KEYWORD_REPLIES_BY_AGENT_ID: Readonly<
  Record<string, Record<TelnyxKeywordKind, string>>
> = {
  [CLIFFS_MAMA_RCS_AGENT_ID]: CLIFFS_MAMA_KEYWORD_REPLIES,
};

/** 4StudentLives when the inbound agent id is missing or not a known brand. */
export function keywordRepliesForAgent(
  agentId?: string | null,
): Record<TelnyxKeywordKind, string> {
  const key = agentId?.trim().toLowerCase();
  if (!key) return TELNYX_KEYWORD_REPLIES;
  return KEYWORD_REPLIES_BY_AGENT_ID[key] ?? TELNYX_KEYWORD_REPLIES;
}

const HELP_ALIASES = new Set(["help", "info"]);
const STOP_ALIASES = new Set([
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
]);
const START_ALIASES = new Set(["start", "unstop"]);

/** Strip trailing punctuation so "HELP!" still matches. */
export function normalizeKeywordText(text: string): string {
  return text.trim().replace(/[.!?]+$/g, "").trim().toLowerCase();
}

export function matchTelnyxKeyword(
  text: string,
  agentId?: string | null,
): TelnyxKeywordReply | null {
  const normalized = normalizeKeywordText(text);
  if (!normalized) return null;

  const replies = keywordRepliesForAgent(agentId);

  if (HELP_ALIASES.has(normalized)) {
    return { kind: "help", text: replies.help };
  }
  if (STOP_ALIASES.has(normalized)) {
    return { kind: "stop", text: replies.stop };
  }
  if (START_ALIASES.has(normalized)) {
    return { kind: "start", text: replies.start };
  }

  return null;
}
