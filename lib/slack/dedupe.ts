/**
 * In-process Slack event dedupe.
 *
 * Slack delivers both `app_mention` and `message` for the same @mention
 * (same channel + ts). It also retries if the handler is slow. Claiming
 * `${channelId}:${ts}` once prevents a second task update / Grok handoff /
 * thread reply.
 */

const TTL_MS = 15 * 60 * 1000;

const claimed = new Map<string, number>();

export function slackEventDedupeKey(event: {
  channelId: string;
  ts: string;
}): string {
  return `${event.channelId}:${event.ts}`;
}

function prune(now = Date.now()) {
  for (const [key, expiresAt] of claimed) {
    if (expiresAt <= now) claimed.delete(key);
  }
}

/** Returns true if this is the first time we have seen the event. */
export function claimSlackEvent(key: string, now = Date.now()): boolean {
  prune(now);
  if (claimed.has(key)) return false;
  claimed.set(key, now + TTL_MS);
  return true;
}

export function hasSlackEvent(key: string, now = Date.now()): boolean {
  prune(now);
  return claimed.has(key);
}

export function resetSlackEventDedupe() {
  claimed.clear();
}
