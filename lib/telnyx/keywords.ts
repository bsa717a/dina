/**
 * Carrier / RCS keyword auto-replies (HELP, STOP, START, and aliases).
 *
 * These must send an immediate Telnyx outbound. Grok Bot handoff is async
 * and often returns `{ ok: true }` with no `reply.text`, which previously
 * acknowledged the inbound and never messaged the handset.
 */

export type TelnyxKeywordKind = "help" | "stop" | "start";

export interface TelnyxKeywordReply {
  kind: TelnyxKeywordKind;
  text: string;
}

export const TELNYX_KEYWORD_REPLIES: Record<TelnyxKeywordKind, string> = {
  help: "Dina (4StudentLives). Send your question and I'll help. Text STOP to opt out.",
  stop: "You are unsubscribed from Dina messages. Text START to resume.",
  start: "You are subscribed to Dina. Send a message anytime. Text HELP for help.",
};

const HELP_ALIASES = new Set(["help", "info"]);
const STOP_ALIASES = new Set(["stop", "unsubscribe", "cancel", "end", "quit"]);
const START_ALIASES = new Set(["start", "unstop"]);

/** Strip trailing punctuation so "HELP!" still matches. */
export function normalizeKeywordText(text: string): string {
  return text.trim().replace(/[.!?]+$/g, "").trim().toLowerCase();
}

export function matchTelnyxKeyword(text: string): TelnyxKeywordReply | null {
  const normalized = normalizeKeywordText(text);
  if (!normalized) return null;

  if (HELP_ALIASES.has(normalized)) {
    return { kind: "help", text: TELNYX_KEYWORD_REPLIES.help };
  }
  if (STOP_ALIASES.has(normalized)) {
    return { kind: "stop", text: TELNYX_KEYWORD_REPLIES.stop };
  }
  if (START_ALIASES.has(normalized)) {
    return { kind: "start", text: TELNYX_KEYWORD_REPLIES.start };
  }

  return null;
}
