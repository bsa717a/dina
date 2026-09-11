/**
 * In-process Slack event_id cache.
 *
 * HTTP Events and Socket Mode can both fire in the same Node process
 * (local dual-path, or Slack retries). Cross-instance dedupe is not
 * required: when Socket Mode is on, Slack does not POST event_callback.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX = 500;

const seen = new Map<string, number>();

export function claimSlackEventId(
  eventId: string | undefined,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  max = DEFAULT_MAX,
): boolean {
  if (!eventId) return true;
  pruneSeenSlackEvents(now, ttlMs, max);
  if (seen.has(eventId)) return false;
  seen.set(eventId, now);
  return true;
}

export function pruneSeenSlackEvents(
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  max = DEFAULT_MAX,
): void {
  for (const [id, ts] of seen) {
    if (now - ts > ttlMs) seen.delete(id);
  }
  if (seen.size <= max) return;
  const overflow = seen.size - max;
  let removed = 0;
  for (const id of seen.keys()) {
    seen.delete(id);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function resetSlackEventDedupe(): void {
  seen.clear();
}

export function slackEventDedupeSize(): number {
  return seen.size;
}
