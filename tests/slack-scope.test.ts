import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetSlackConfig = vi.fn();
const mockResolveProjectKey = vi.fn();

vi.mock("@/lib/slack/config", () => ({
  getSlackConfig: () => mockGetSlackConfig(),
}));

vi.mock("@/lib/projects/catalog", () => ({
  resolveProjectKey: (slug: string) => mockResolveProjectKey(slug),
}));

describe("Slack Regi scope", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetSlackConfig.mockReset();
    mockResolveProjectKey.mockReset();
  });

  it("resolves the default regi slug", async () => {
    mockGetSlackConfig.mockReturnValue({ projectSlug: "regi" });
    mockResolveProjectKey.mockReturnValue("regi");
    const { resolveRegiProjectKey } = await import("@/lib/slack/scope");
    expect(resolveRegiProjectKey()).toBe("regi");
  });

  it("rejects 4studentlives even if the env slug points there", async () => {
    mockGetSlackConfig.mockReturnValue({ projectSlug: "4sl" });
    mockResolveProjectKey.mockReturnValue("4studentlives");
    const { resolveRegiProjectKey } = await import("@/lib/slack/scope");
    expect(() => resolveRegiProjectKey()).toThrow(/Regi-only/);
  });

  it("rejects metabolicos", async () => {
    mockGetSlackConfig.mockReturnValue({ projectSlug: "metabolic" });
    mockResolveProjectKey.mockReturnValue("metabolicos");
    const { resolveRegiProjectKey } = await import("@/lib/slack/scope");
    expect(() => resolveRegiProjectKey()).toThrow(/Regi-only/);
  });

  it("allows any channel when the allowlist is empty", async () => {
    mockGetSlackConfig.mockReturnValue({ channelIds: [], allowIms: false });
    const { isChannelAllowed } = await import("@/lib/slack/scope");
    expect(isChannelAllowed("C123", "channel")).toBe(true);
  });

  it("does not let a per-user token post when the allowlist is empty", async () => {
    mockGetSlackConfig.mockReturnValue({ channelIds: [], allowIms: false });
    const { isProjectSlackChannel } = await import("@/lib/slack/scope");
    expect(isProjectSlackChannel("C123")).toBe(false);
    expect(isProjectSlackChannel("")).toBe(false);
  });

  it("lets a per-user token post only to listed channels", async () => {
    mockGetSlackConfig.mockReturnValue({
      channelIds: ["CALLOWED", "D123"],
      allowIms: false,
    });
    const { isProjectSlackChannel } = await import("@/lib/slack/scope");
    expect(isProjectSlackChannel("CALLOWED")).toBe(true);
    expect(isProjectSlackChannel("  CALLOWED  ")).toBe(true);
    expect(isProjectSlackChannel("CBLOCKED")).toBe(false);
    expect(isProjectSlackChannel("D123")).toBe(false);
  });

  it("lets a per-user token post to a listed DM only when IMs are allowed", async () => {
    mockGetSlackConfig.mockReturnValue({
      channelIds: ["D123"],
      allowIms: true,
    });
    const { isProjectSlackChannel } = await import("@/lib/slack/scope");
    expect(isProjectSlackChannel("D123")).toBe(true);
  });

  it("enforces the channel allowlist", async () => {
    mockGetSlackConfig.mockReturnValue({
      channelIds: ["CALLOWED"],
      allowIms: false,
    });
    const { isChannelAllowed } = await import("@/lib/slack/scope");
    expect(isChannelAllowed("CALLOWED", "channel")).toBe(true);
    expect(isChannelAllowed("CBLOCKED", "channel")).toBe(false);
  });

  it("blocks DMs unless SLACK_REGI_ALLOW_IMS is set", async () => {
    mockGetSlackConfig.mockReturnValue({ channelIds: [], allowIms: false });
    const { isChannelAllowed } = await import("@/lib/slack/scope");
    expect(isChannelAllowed("D123", "im")).toBe(false);
  });

  it("allows DMs when configured", async () => {
    mockGetSlackConfig.mockReturnValue({ channelIds: [], allowIms: true });
    const { isChannelAllowed } = await import("@/lib/slack/scope");
    expect(isChannelAllowed("D123", "im")).toBe(true);
  });

  it("treats bot_id as the bot's own message", async () => {
    mockGetSlackConfig.mockReturnValue({ botUserId: "UBOT" });
    const { isOwnBotMessage } = await import("@/lib/slack/scope");
    expect(isOwnBotMessage({ botId: "B123" })).toBe(true);
    expect(isOwnBotMessage({ slackUserId: "UBOT" })).toBe(true);
    expect(isOwnBotMessage({ slackUserId: "UHUMAN" })).toBe(false);
  });
});
