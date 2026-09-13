import { describe, expect, it, beforeEach } from "vitest";
import {
  claimSlackEvent,
  hasSlackEvent,
  resetSlackEventDedupe,
  slackEventDedupeKey,
} from "@/lib/slack/dedupe";

describe("slack event dedupe", () => {
  beforeEach(() => {
    resetSlackEventDedupe();
  });

  it("keys by channel and message ts (shared by app_mention + message)", () => {
    expect(
      slackEventDedupeKey({ channelId: "CREGI", ts: "171.1" }),
    ).toBe("CREGI:171.1");
  });

  it("claims an event only once", () => {
    expect(claimSlackEvent("CREGI:1.1")).toBe(true);
    expect(claimSlackEvent("CREGI:1.1")).toBe(false);
    expect(hasSlackEvent("CREGI:1.1")).toBe(true);
    expect(claimSlackEvent("CREGI:2.2")).toBe(true);
  });

  it("expires claims after the TTL", () => {
    const now = 1_000_000;
    expect(claimSlackEvent("CREGI:1.1", now)).toBe(true);
    expect(claimSlackEvent("CREGI:1.1", now + 60_000)).toBe(false);
    expect(claimSlackEvent("CREGI:1.1", now + 16 * 60 * 1000)).toBe(true);
  });
});
