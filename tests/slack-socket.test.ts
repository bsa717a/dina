import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackEventCallback } from "@/lib/slack/types";

const mockHandle = vi.fn();

vi.mock("@/lib/slack/ingest", () => ({
  handleSlackInboundCallback: (...args: unknown[]) => mockHandle(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mentionCallback: SlackEventCallback = {
  type: "event_callback",
  team_id: "TREGI",
  event_id: "EvSOCKET1",
  event: {
    type: "app_mention",
    user: "U012ALEX",
    text: "<@UBOT> ship the dashboard polish",
    ts: "1710000000.000100",
    channel: "CREGI",
    channel_type: "channel",
  },
};

describe("extractSlackEventCallback", () => {
  it("unwraps a Socket Mode events_api envelope", async () => {
    const { extractSlackEventCallback } = await import("@/lib/slack/socket");
    const parsed = extractSlackEventCallback({
      type: "events_api",
      envelope_id: "env-1",
      payload: mentionCallback,
    });
    expect(parsed?.type).toBe("event_callback");
    expect(parsed?.event.type).toBe("app_mention");
    expect(parsed?.event.user).toBe("U012ALEX");
    expect(parsed?.event_id).toBe("EvSOCKET1");
  });

  it("accepts an already-unwrapped event_callback body", async () => {
    const { extractSlackEventCallback } = await import("@/lib/slack/socket");
    expect(extractSlackEventCallback(mentionCallback)?.event_id).toBe("EvSOCKET1");
  });

  it("ignores slash commands and interactive envelopes", async () => {
    const { extractSlackEventCallback } = await import("@/lib/slack/socket");
    expect(
      extractSlackEventCallback({
        type: "slash_commands",
        payload: { command: "/piper", user_id: "U1" },
      }),
    ).toBeNull();
    expect(
      extractSlackEventCallback({
        type: "interactive",
        payload: { type: "block_actions" },
      }),
    ).toBeNull();
  });

  it("ignores non-objects", async () => {
    const { extractSlackEventCallback } = await import("@/lib/slack/socket");
    expect(extractSlackEventCallback(null)).toBeNull();
    expect(extractSlackEventCallback("event_callback")).toBeNull();
  });
});

describe("handleSlackSocketEvent", () => {
  beforeEach(() => {
    mockHandle.mockReset();
    mockHandle.mockResolvedValue({
      handled: true,
      reason: "ok",
      reply: { text: "Got it", channelId: "CREGI", threadTs: "1.1" },
    });
  });

  it("acks immediately and routes app_mention into the shared ingest", async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const { handleSlackSocketEvent } = await import("@/lib/slack/socket");
    const result = await handleSlackSocketEvent({
      ack,
      type: "events_api",
      body: mentionCallback,
    });

    expect(ack).toHaveBeenCalledOnce();
    expect(mockHandle).toHaveBeenCalledWith(mentionCallback);
    expect(result.handled).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("acks Socket Mode envelopes before processing", async () => {
    const order: string[] = [];
    const ack = vi.fn().mockImplementation(async () => {
      order.push("ack");
    });
    mockHandle.mockImplementation(async () => {
      order.push("ingest");
      return { handled: true, reason: "ok" };
    });

    const { handleSlackSocketEvent } = await import("@/lib/slack/socket");
    await handleSlackSocketEvent({
      ack,
      type: "events_api",
      body: {
        type: "events_api",
        payload: mentionCallback,
      },
    });

    expect(order).toEqual(["ack", "ingest"]);
    expect(mockHandle).toHaveBeenCalledWith(mentionCallback);
  });

  it("ignores non-events_api envelopes after ack", async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const { handleSlackSocketEvent } = await import("@/lib/slack/socket");
    const result = await handleSlackSocketEvent({
      ack,
      type: "slash_commands",
      body: { command: "/piper" },
    });
    expect(ack).toHaveBeenCalledOnce();
    expect(result.reason).toBe("unhandled_envelope");
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it("forwards message follow-ups to the same ingest as HTTP", async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const followUp: SlackEventCallback = {
      type: "event_callback",
      event_id: "EvTHREAD",
      event: {
        type: "message",
        user: "U012ALEX",
        text: "more detail",
        ts: "1710000000.000200",
        thread_ts: "1710000000.000100",
        channel: "CREGI",
        channel_type: "channel",
      },
    };
    const { handleSlackSocketEvent } = await import("@/lib/slack/socket");
    await handleSlackSocketEvent({
      ack,
      type: "events_api",
      body: { type: "events_api", payload: followUp },
    });
    expect(ack).toHaveBeenCalledOnce();
    expect(mockHandle).toHaveBeenCalledWith(followUp);
  });
});

describe("Socket Mode envelope → parseSlackInboundEvent", () => {
  it("feeds the same inbound shape as HTTP Events", async () => {
    const { extractSlackEventCallback } = await import("@/lib/slack/socket");
    const { parseSlackInboundEvent } = await import("@/lib/slack/process");
    const parsed = parseSlackInboundEvent(
      extractSlackEventCallback({
        type: "events_api",
        envelope_id: "env-2",
        payload: mentionCallback,
      })!,
    );
    expect(parsed?.type).toBe("app_mention");
    expect(parsed?.slackUserId).toBe("U012ALEX");
    expect(parsed?.channelId).toBe("CREGI");
    expect(parsed?.threadTs).toBe("1710000000.000100");
    expect(parsed?.eventId).toBe("EvSOCKET1");
  });
});

describe("shouldStartSocketModeInProcess", () => {
  const keys = [
    "SLACK_BOT_TOKEN",
    "SLACK_SIGNING_SECRET",
    "SLACK_APP_TOKEN",
    "SLACK_SOCKET_MODE",
  ] as const;
  const prior: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      prior[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  });

  it("starts in-process when an xapp token is set", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_APP_TOKEN = "xapp-1-test";
    const { shouldStartSocketModeInProcess } = await import("@/lib/slack/socket");
    expect(shouldStartSocketModeInProcess()).toBe(true);
  });

  it("does not start in-process when mode is standalone", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_APP_TOKEN = "xapp-1-test";
    process.env.SLACK_SOCKET_MODE = "standalone";
    const { shouldStartSocketModeInProcess } = await import("@/lib/slack/socket");
    expect(shouldStartSocketModeInProcess()).toBe(false);
  });

  it("does not start in-process when mode is off", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_APP_TOKEN = "xapp-1-test";
    process.env.SLACK_SOCKET_MODE = "off";
    const { shouldStartSocketModeInProcess } = await import("@/lib/slack/socket");
    expect(shouldStartSocketModeInProcess()).toBe(false);
  });

  it("rejects a non-xapp app token", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_APP_TOKEN = "xoxb-not-an-app-token";
    const { shouldStartSocketModeInProcess } = await import("@/lib/slack/socket");
    expect(shouldStartSocketModeInProcess()).toBe(false);
  });
});

describe("startSlackSocketMode", () => {
  const keys = [
    "SLACK_BOT_TOKEN",
    "SLACK_SIGNING_SECRET",
    "SLACK_APP_TOKEN",
    "SLACK_SOCKET_MODE",
  ] as const;
  const prior: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      prior[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
    const { resetSlackSocketStatus } = await import("@/lib/slack/socket-status");
    resetSlackSocketStatus();
  });

  it("skips when Socket Mode is not configured", async () => {
    const { startSlackSocketMode } = await import("@/lib/slack/socket");
    const result = await startSlackSocketMode({ source: "instrumentation" });
    expect(result).toEqual({ started: false, reason: "not_configured" });
  });

  it("skips instrumentation when SLACK_SOCKET_MODE=standalone", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_APP_TOKEN = "xapp-1-test";
    process.env.SLACK_SOCKET_MODE = "standalone";
    const { startSlackSocketMode } = await import("@/lib/slack/socket");
    const result = await startSlackSocketMode({ source: "instrumentation" });
    expect(result).toEqual({ started: false, reason: "standalone" });
  });
});

describe("getSlackSocketStatus", () => {
  it("stores live status on globalThis so route chunks see instrumentation updates", async () => {
    const {
      getSlackSocketStatus,
      resetSlackSocketStatus,
      setSlackSocketStatus,
    } = await import("@/lib/slack/socket-status");
    resetSlackSocketStatus();
    setSlackSocketStatus({
      configured: true,
      started: true,
      connected: true,
      source: "instrumentation",
    });
    const shared = (
      globalThis as unknown as { slackSocketStatus?: { connected: boolean } }
    ).slackSocketStatus;
    expect(shared?.connected).toBe(true);
    expect(getSlackSocketStatus().connected).toBe(true);
    resetSlackSocketStatus();
  });
});

describe("slackSocketHealthFromStatus", () => {
  it("maps connection state for health checks", async () => {
    const { slackSocketHealthFromStatus } = await import(
      "@/lib/slack/socket-status"
    );
    expect(slackSocketHealthFromStatus(false)).toBe("missing");
    expect(
      slackSocketHealthFromStatus(true, {
        configured: true,
        started: false,
        connected: false,
        source: null,
      }),
    ).toBe("configured");
    expect(
      slackSocketHealthFromStatus(true, {
        configured: true,
        started: true,
        connected: false,
        source: "instrumentation",
      }),
    ).toBe("started");
    expect(
      slackSocketHealthFromStatus(true, {
        configured: true,
        started: true,
        connected: true,
        source: "instrumentation",
      }),
    ).toBe("connected");
    expect(
      slackSocketHealthFromStatus(true, {
        configured: true,
        started: true,
        connected: false,
        source: "worker",
        lastError: "boom",
      }),
    ).toBe("error");
  });
});
