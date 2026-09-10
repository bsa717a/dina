import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SlackInboundEvent } from "@/lib/slack/types";
import { UNKNOWN_USER_REPLY, NOT_ON_REGI_REPLY } from "@/lib/slack/types";

const mockLookup = vi.fn();
const mockUpsertLedger = vi.fn();
const mockFindThread = vi.fn();
const mockHandoff = vi.fn();
const mockIsChannelAllowed = vi.fn();
const mockIsOwnBotMessage = vi.fn();
const mockShouldIgnore = vi.fn();

vi.mock("@/lib/slack/roster", () => ({
  lookupBySlackUserId: (...args: unknown[]) => mockLookup(...args),
}));

vi.mock("@/lib/slack/ledger", () => ({
  upsertSlackThreadLedger: (...args: unknown[]) => mockUpsertLedger(...args),
  findSlackThreadAttention: (...args: unknown[]) => mockFindThread(...args),
  stripSlackMentions: (text: string) =>
    text.replace(/<@[A-Z0-9]+>/gi, "").replace(/\s+/g, " ").trim(),
}));

vi.mock("@/lib/slack/handoff", () => ({
  handoffSlackToGrokBot: (...args: unknown[]) => mockHandoff(...args),
}));

vi.mock("@/lib/slack/scope", () => ({
  isChannelAllowed: (...args: unknown[]) => mockIsChannelAllowed(...args),
  isOwnBotMessage: (...args: unknown[]) => mockIsOwnBotMessage(...args),
  shouldIgnoreMessageSubtype: (...args: unknown[]) => mockShouldIgnore(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mention: SlackInboundEvent = {
  type: "app_mention",
  slackUserId: "U012ALEX",
  text: "<@UBOT> ship the dashboard polish",
  channelId: "CREGI",
  ts: "1710000000.000100",
  threadTs: "1710000000.000100",
  channelType: "channel",
};

describe("processSlackInbound", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLookup.mockReset();
    mockUpsertLedger.mockReset();
    mockFindThread.mockReset();
    mockHandoff.mockReset();
    mockIsChannelAllowed.mockReset();
    mockIsOwnBotMessage.mockReset();
    mockShouldIgnore.mockReset();
    mockIsChannelAllowed.mockReturnValue(true);
    mockIsOwnBotMessage.mockReturnValue(false);
    mockShouldIgnore.mockReturnValue(false);
  });

  it("ignores the bot's own messages", async () => {
    mockIsOwnBotMessage.mockReturnValue(true);
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);
    expect(result.ignored).toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("ignores channels outside the allowlist", async () => {
    mockIsChannelAllowed.mockReturnValue(false);
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);
    expect(result.reason).toBe("channel_not_allowed");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("asks Derek to add unknown Slack users", async () => {
    mockLookup.mockResolvedValue({
      found: false,
      slackUserId: "U012ALEX",
      reason: "unknown_user",
    });
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);
    expect(result.handled).toBe(false);
    expect(result.reply?.text).toBe(UNKNOWN_USER_REPLY);
    expect(mockUpsertLedger).not.toHaveBeenCalled();
  });

  it("asks Derek when the user is not on Regi", async () => {
    mockLookup.mockResolvedValue({
      found: true,
      user: { id: "u2", name: "Pat", username: "pat", slackUserId: "U012ALEX" },
      projectKeys: ["4studentlives"],
      onRegiProject: false,
    });
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);
    expect(result.handled).toBe(false);
    expect(result.reply?.text).toBe(NOT_ON_REGI_REPLY);
    expect(mockUpsertLedger).not.toHaveBeenCalled();
  });

  it("creates a Regi task and uses the Grok Bot reply", async () => {
    mockLookup.mockResolvedValue({
      found: true,
      user: { id: "u1", name: "Alex", username: "alex", slackUserId: "U012ALEX" },
      projectKeys: ["regi"],
      onRegiProject: true,
    });
    mockUpsertLedger.mockResolvedValue({
      task: { id: "t1", number: 3, title: "ship the dashboard polish", created: true },
      attention: { id: "a1" },
    });
    mockHandoff.mockResolvedValue({
      status: "sent",
      response: { ok: true, reply: { text: "Logged. I'll watch that thread." } },
    });

    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);

    expect(result.handled).toBe(true);
    expect(result.task?.number).toBe(3);
    expect(result.handoff).toBe("sent");
    expect(result.reply?.text).toBe("Logged. I'll watch that thread.");
    expect(result.reply?.threadTs).toBe(mention.threadTs);
    expect(mockUpsertLedger).toHaveBeenCalled();
  });

  it("acks locally when Grok Bot is only logged", async () => {
    mockLookup.mockResolvedValue({
      found: true,
      user: { id: "u1", name: "Alex", username: "alex", slackUserId: "U012ALEX" },
      projectKeys: ["regi"],
      onRegiProject: true,
    });
    mockUpsertLedger.mockResolvedValue({
      task: { id: "t1", number: 4, title: "ship the dashboard polish", created: true },
      attention: { id: "a1" },
    });
    mockHandoff.mockResolvedValue({ status: "logged" });

    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);
    expect(result.handoff).toBe("logged");
    expect(result.reply?.text).toContain("task #4");
  });

  it("ignores top-level channel messages that are not mentions", async () => {
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound({
      ...mention,
      type: "message",
    });
    expect(result.reason).toBe("channel_message_without_mention");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("ignores thread follow-ups that are not Piper threads", async () => {
    mockFindThread.mockResolvedValue(null);
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound({
      ...mention,
      type: "message",
      ts: "1710000000.000200",
      threadTs: "1710000000.000100",
    });
    expect(result.reason).toBe("unknown_thread");
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe("parseSlackInboundEvent", () => {
  it("parses app_mention events", async () => {
    const { parseSlackInboundEvent } = await import("@/lib/slack/process");
    const parsed = parseSlackInboundEvent({
      type: "event_callback",
      team_id: "TREGI",
      event_id: "Ev1",
      event: {
        type: "app_mention",
        user: "U012ALEX",
        text: "<@UBOT> hello",
        ts: "1.1",
        channel: "CREGI",
      },
    });
    expect(parsed?.slackUserId).toBe("U012ALEX");
    expect(parsed?.threadTs).toBe("1.1");
    expect(parsed?.channelId).toBe("CREGI");
  });

  it("ignores reaction events", async () => {
    const { parseSlackInboundEvent } = await import("@/lib/slack/process");
    expect(
      parseSlackInboundEvent({
        type: "event_callback",
        event: { type: "reaction_added", user: "U1", channel: "C1", ts: "1" },
      }),
    ).toBeNull();
  });
});
