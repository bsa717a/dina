import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SlackInboundEvent, SlackRosterLookupResult } from "@/lib/slack/types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const getGrokBotConfig = vi.fn();
const isGrokBotConfigured = vi.fn();

vi.mock("@/lib/telnyx/config", () => ({
  getGrokBotConfig: () => getGrokBotConfig(),
  isGrokBotConfigured: () => isGrokBotConfigured(),
}));

vi.mock("@/lib/slack/scope", () => ({
  resolveRegiProjectKey: () => "regi",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const event: SlackInboundEvent = {
  type: "app_mention",
  slackUserId: "U012ALEX",
  text: "add a mockup review",
  channelId: "CREGI",
  ts: "1710000000.000100",
  threadTs: "1710000000.000100",
  teamId: "TREGI",
  eventId: "Ev123",
};

const foundRoster: SlackRosterLookupResult = {
  found: true,
  user: {
    id: "user-1",
    name: "Alex",
    username: "alex",
    slackUserId: "U012ALEX",
  },
  projectKeys: ["regi"],
  onRegiProject: true,
};

describe("handoffSlackToGrokBot", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    getGrokBotConfig.mockReset();
    isGrokBotConfigured.mockReset();
  });

  it("logs when Grok Bot is not configured", async () => {
    isGrokBotConfigured.mockReturnValue(false);
    getGrokBotConfig.mockReturnValue(null);
    const { handoffSlackToGrokBot } = await import("@/lib/slack/handoff");
    const result = await handoffSlackToGrokBot(event, foundRoster);
    expect(result.status).toBe("logged");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends a slack-tagged payload with regi-only projectKeys", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: "secret",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, reply: { text: "On it." } }),
    });

    const { handoffSlackToGrokBot } = await import("@/lib/slack/handoff");
    const result = await handoffSlackToGrokBot(event, foundRoster);

    expect(result.status).toBe("sent");
    expect(result.response?.reply?.text).toBe("On it.");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.channel).toBe("slack");
    expect(body.messageType).toBe("slack");
    expect(body.projectKeys).toEqual(["regi"]);
    expect(body.projectKeys).not.toContain("4studentlives");
    expect(body.user.username).toBe("alex");
    expect(body.slack.channelId).toBe("CREGI");
    expect(body.slack.threadTs).toBe("1710000000.000100");
    expect(mockFetch.mock.calls[0][1].headers["X-Grok-Bot-Signature"]).toEqual(
      expect.any(String),
    );
  });

  it("does not leak other project keys for unknown senders", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { handoffSlackToGrokBot } = await import("@/lib/slack/handoff");
    await handoffSlackToGrokBot(event, {
      found: false,
      slackUserId: "U999",
      reason: "unknown_user",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.user).toBeNull();
    expect(body.projectKeys).toEqual([]);
  });
});
