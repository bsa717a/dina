import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AuthUser } from "@/lib/auth/types";
import type { SlackInboundEvent } from "@/lib/slack/types";
import { UNKNOWN_USER_REPLY, NOT_ON_REGI_REPLY } from "@/lib/slack/types";

const mockLookup = vi.fn();
const mockRememberThread = vi.fn();
const mockFindThread = vi.fn();
const mockHandoff = vi.fn();
const mockSlackChat = vi.fn();
const mockIsChannelAllowed = vi.fn();
const mockIsOwnBotMessage = vi.fn();
const mockShouldIgnore = vi.fn();

vi.mock("@/lib/slack/roster", () => ({
  lookupBySlackUserId: (...args: unknown[]) => mockLookup(...args),
}));

vi.mock("@/lib/slack/ledger", () => ({
  rememberSlackThread: (...args: unknown[]) => mockRememberThread(...args),
  findSlackThreadAttention: (...args: unknown[]) => mockFindThread(...args),
  stripSlackMentions: (text: string) =>
    text.replace(/<@[A-Z0-9]+>/gi, "").replace(/\s+/g, " ").trim(),
}));

vi.mock("@/lib/slack/handoff", () => ({
  handoffSlackToGrokBot: (...args: unknown[]) => mockHandoff(...args),
}));

vi.mock("@/lib/slack/chat", () => ({
  runSlackPiperChat: (...args: unknown[]) => mockSlackChat(...args),
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

const authUser: AuthUser = {
  id: "u1",
  name: "Alex",
  username: "alex",
  role: "member",
  assistantName: "Nora",
  assistantPersona: "",
  assistantKey: "nora",
  mustChangePassword: false,
  phoneNumber: null,
};

const mention: SlackInboundEvent = {
  type: "app_mention",
  slackUserId: "U012ALEX",
  text: "<@UBOT> ship the dashboard polish",
  channelId: "CREGI",
  ts: "1710000000.000100",
  threadTs: "1710000000.000100",
  channelType: "channel",
};

const remainingAsk: SlackInboundEvent = {
  ...mention,
  text: "<@UBOT> show remaining tasks",
};

const foundRoster = {
  found: true as const,
  user: { id: "u1", name: "Alex", username: "alex", slackUserId: "U012ALEX" },
  authUser,
  projectKeys: ["regi"],
  onRegiProject: true,
};

describe("processSlackInbound", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLookup.mockReset();
    mockRememberThread.mockReset();
    mockFindThread.mockReset();
    mockHandoff.mockReset();
    mockSlackChat.mockReset();
    mockIsChannelAllowed.mockReset();
    mockIsOwnBotMessage.mockReset();
    mockShouldIgnore.mockReset();
    mockIsChannelAllowed.mockReturnValue(true);
    mockIsOwnBotMessage.mockReturnValue(false);
    mockShouldIgnore.mockReturnValue(false);
    mockRememberThread.mockResolvedValue({ attention: { id: "a1" } });
    mockHandoff.mockRejectedValue(new Error("Grok Bot must not be called for Slack"));
  });

  it("ignores the bot's own messages", async () => {
    mockIsOwnBotMessage.mockReturnValue(true);
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);
    expect(result.ignored).toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockSlackChat).not.toHaveBeenCalled();
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
    expect(mockSlackChat).not.toHaveBeenCalled();
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it("asks Derek when the user is not on Regi", async () => {
    mockLookup.mockResolvedValue({
      found: true,
      user: { id: "u2", name: "Pat", username: "pat", slackUserId: "U012ALEX" },
      authUser: { ...authUser, id: "u2", name: "Pat", username: "pat" },
      projectKeys: ["4studentlives"],
      onRegiProject: false,
    });
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);
    expect(result.handled).toBe(false);
    expect(result.reply?.text).toBe(NOT_ON_REGI_REPLY);
    expect(mockSlackChat).not.toHaveBeenCalled();
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it("sends free-text through the Piper chat brain without Grok Bot", async () => {
    mockLookup.mockResolvedValue(foundRoster);
    mockSlackChat.mockResolvedValue({
      ok: true,
      text: "Logged “ship the dashboard polish” on Regi as task #3.",
    });

    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);

    expect(result.handled).toBe(true);
    expect(result.handoff).toBe("skipped");
    expect(result.replyKind).toBe("chat");
    expect(result.reply?.text).toContain("task #3");
    expect(result.reply?.threadTs).toBe(mention.threadTs);
    expect(mockSlackChat).toHaveBeenCalledWith({
      user: authUser,
      text: "ship the dashboard polish",
    });
    expect(mockRememberThread).toHaveBeenCalled();
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it("lists tasks through the chat brain instead of keyword stubs", async () => {
    mockLookup.mockResolvedValue(foundRoster);
    mockSlackChat.mockResolvedValue({
      ok: true,
      text: "Remaining tasks for Regi:\n\n1. Polish the dashboard",
    });

    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(remainingAsk);

    expect(result.handled).toBe(true);
    expect(result.handoff).toBe("skipped");
    expect(result.replyKind).toBe("chat");
    expect(result.reply?.text).toContain("Remaining tasks for Regi:");
    expect(mockSlackChat).toHaveBeenCalledWith({
      user: authUser,
      text: "show remaining tasks",
    });
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it("does not auto-create a ledger task for free-text", async () => {
    mockLookup.mockResolvedValue(foundRoster);
    mockSlackChat.mockResolvedValue({
      ok: true,
      text: "Remaining tasks for Regi:\n\n1. Polish the dashboard",
    });

    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound({
      ...mention,
      text: "<@UBOT> show me all tasks",
    });

    expect(result.task).toBeUndefined();
    expect(result.replyKind).toBe("chat");
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it("still replies when the chat brain returns an error (never Grok)", async () => {
    mockLookup.mockResolvedValue(foundRoster);
    mockSlackChat.mockResolvedValue({
      ok: false,
      text: "Something went wrong while talking to Nora.",
    });

    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound(mention);

    expect(result.handled).toBe(true);
    expect(result.handoff).toBe("skipped");
    expect(result.reply?.text).toContain("talking to Nora");
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it("dedupes Slack retries so one event only hits the chat brain once", async () => {
    mockLookup.mockResolvedValue(foundRoster);
    let resolveChat: (value: { ok: boolean; text: string }) => void = () => undefined;
    const chatPromise = new Promise<{ ok: boolean; text: string }>((resolve) => {
      resolveChat = resolve;
    });
    mockSlackChat.mockReturnValue(chatPromise);

    const { processSlackInbound } = await import("@/lib/slack/process");
    const retried = { ...mention, eventId: "Ev-dup-1" };
    const first = processSlackInbound(retried);
    const second = processSlackInbound(retried);
    resolveChat({ ok: true, text: "Done." });
    const [a, b] = await Promise.all([first, second]);

    expect(a.reply?.text).toBe("Done.");
    expect(b.reply?.text).toBe("Done.");
    expect(mockSlackChat).toHaveBeenCalledTimes(1);
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it("ignores top-level channel messages that are not mentions", async () => {
    const { processSlackInbound } = await import("@/lib/slack/process");
    const result = await processSlackInbound({
      ...mention,
      type: "message",
    });
    expect(result.reason).toBe("channel_message_without_mention");
    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockHandoff).not.toHaveBeenCalled();
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
    expect(mockHandoff).not.toHaveBeenCalled();
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
