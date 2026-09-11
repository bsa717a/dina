import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackEventCallback } from "@/lib/slack/types";

const mockProcess = vi.fn();
const mockDeliver = vi.fn();
const mockParse = vi.fn();

vi.mock("@/lib/slack/process", () => ({
  parseSlackInboundEvent: (...args: unknown[]) => mockParse(...args),
  processSlackInbound: (...args: unknown[]) => mockProcess(...args),
  deliverSlackReply: (...args: unknown[]) => mockDeliver(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const callback: SlackEventCallback = {
  type: "event_callback",
  event_id: "EvINGEST1",
  event: {
    type: "app_mention",
    user: "U012",
    text: "hello",
    ts: "1.1",
    channel: "CREGI",
  },
};

describe("handleSlackInboundCallback", () => {
  beforeEach(async () => {
    mockProcess.mockReset();
    mockDeliver.mockReset();
    mockParse.mockReset();
    const { resetSlackEventDedupe } = await import("@/lib/slack/dedupe");
    resetSlackEventDedupe();
    mockParse.mockReturnValue({
      type: "app_mention",
      slackUserId: "U012",
      text: "hello",
      channelId: "CREGI",
      ts: "1.1",
      threadTs: "1.1",
    });
    mockProcess.mockResolvedValue({
      handled: true,
      reason: "ok",
      reply: { text: "Got it", channelId: "CREGI", threadTs: "1.1" },
    });
    mockDeliver.mockResolvedValue(undefined);
  });

  it("processes and replies through the shared pipeline", async () => {
    const { handleSlackInboundCallback } = await import("@/lib/slack/ingest");
    const result = await handleSlackInboundCallback(callback);
    expect(result.handled).toBe(true);
    expect(mockProcess).toHaveBeenCalledOnce();
    expect(mockDeliver).toHaveBeenCalledOnce();
  });

  it("dedupes the same event_id", async () => {
    const { handleSlackInboundCallback } = await import("@/lib/slack/ingest");
    const first = await handleSlackInboundCallback(callback);
    const second = await handleSlackInboundCallback(callback);
    expect(first.handled).toBe(true);
    expect(second.ignored).toBe(true);
    expect(second.reason).toBe("duplicate_event");
    expect(mockProcess).toHaveBeenCalledOnce();
  });

  it("returns unhandled_event without processing", async () => {
    mockParse.mockReturnValue(null);
    const { handleSlackInboundCallback } = await import("@/lib/slack/ingest");
    const result = await handleSlackInboundCallback(callback);
    expect(result.reason).toBe("unhandled_event");
    expect(mockProcess).not.toHaveBeenCalled();
  });
});

describe("claimSlackEventId", () => {
  beforeEach(async () => {
    const { resetSlackEventDedupe } = await import("@/lib/slack/dedupe");
    resetSlackEventDedupe();
  });

  it("allows the first claim and rejects the second", async () => {
    const { claimSlackEventId } = await import("@/lib/slack/dedupe");
    expect(claimSlackEventId("Ev1")).toBe(true);
    expect(claimSlackEventId("Ev1")).toBe(false);
    expect(claimSlackEventId("Ev2")).toBe(true);
  });

  it("allows events with no id", async () => {
    const { claimSlackEventId } = await import("@/lib/slack/dedupe");
    expect(claimSlackEventId(undefined)).toBe(true);
    expect(claimSlackEventId("")).toBe(true);
  });

  it("expires old ids", async () => {
    const { claimSlackEventId } = await import("@/lib/slack/dedupe");
    const now = 1_000_000;
    expect(claimSlackEventId("EvOld", now, 1000)).toBe(true);
    expect(claimSlackEventId("EvOld", now + 5_000, 1000)).toBe(true);
  });
});
