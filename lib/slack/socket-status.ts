/**
 * Live Socket Mode connection status (no Slack SDK).
 * Shared by the client, health, and /api/slack/events GET.
 */

export type SlackSocketSource = "instrumentation" | "worker";

export type SlackSocketHealth =
  | "missing"
  | "off"
  | "configured"
  | "started"
  | "connected"
  | "error";

export interface SlackSocketStatus {
  configured: boolean;
  started: boolean;
  connected: boolean;
  source: SlackSocketSource | null;
  lastError?: string;
  lastEventAt?: string;
  lastEventType?: string;
}

/**
 * Next.js compiles instrumentation.ts and App Router handlers as separate
 * entries, so a module-level object is not shared. Same process, same
 * globalThis — same pattern as the Prisma client.
 */
const globalForSlackSocket = globalThis as unknown as {
  slackSocketStatus?: SlackSocketStatus;
};

function getStatusStore(): SlackSocketStatus {
  if (!globalForSlackSocket.slackSocketStatus) {
    globalForSlackSocket.slackSocketStatus = {
      configured: false,
      started: false,
      connected: false,
      source: null,
    };
  }
  return globalForSlackSocket.slackSocketStatus;
}

export function getSlackSocketStatus(): SlackSocketStatus {
  return { ...getStatusStore() };
}

export function setSlackSocketStatus(patch: Partial<SlackSocketStatus>): SlackSocketStatus {
  Object.assign(getStatusStore(), patch);
  return getSlackSocketStatus();
}

export function resetSlackSocketStatus(): void {
  const status = getStatusStore();
  status.configured = false;
  status.started = false;
  status.connected = false;
  status.source = null;
  delete status.lastError;
  delete status.lastEventAt;
  delete status.lastEventType;
}

export function slackSocketHealthFromStatus(
  configured: boolean,
  current: SlackSocketStatus = getSlackSocketStatus(),
): SlackSocketHealth {
  if (!configured) return "missing";
  if (current.lastError && !current.connected) return "error";
  if (current.connected) return "connected";
  if (current.started) return "started";
  return "configured";
}
