import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetGrokBotDinaApiToken = vi.fn();
const mockIsSlackConfigured = vi.fn();
const mockPostSlackMessage = vi.fn();

vi.mock("@/lib/env", () => ({
  getGrokBotDinaApiToken: () => mockGetGrokBotDinaApiToken(),
}));

vi.mock("@/lib/slack/config", () => ({
  isSlackConfigured: () => mockIsSlackConfigured(),
}));

vi.mock("@/lib/slack/client", () => ({
  postSlackMessage: (...args: unknown[]) => mockPostSlackMessage(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("POST /api/grok/outbound-slack", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetGrokBotDinaApiToken.mockReset();
    mockIsSlackConfigured.mockReset();
    mockPostSlackMessage.mockReset();
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");
    mockIsSlackConfigured.mockReturnValue(true);
  });

  it("rejects unauthenticated requests", async () => {
    const { POST } = await import("@/app/api/grok/outbound-slack/route");
    const res = await POST(
      new NextRequest("http://localhost/api/grok/outbound-slack", {
        method: "POST",
        body: JSON.stringify({ channelId: "C1", text: "hi" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("posts into the Slack thread", async () => {
    mockPostSlackMessage.mockResolvedValue({ sent: true, messageTs: "9.9" });
    const { POST } = await import("@/app/api/grok/outbound-slack/route");
    const res = await POST(
      new NextRequest("http://localhost/api/grok/outbound-slack", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        body: JSON.stringify({
          channelId: "CREGI",
          threadTs: "1.1",
          text: "Piper reply",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, messageTs: "9.9" });
    expect(mockPostSlackMessage).toHaveBeenCalledWith({
      channelId: "CREGI",
      threadTs: "1.1",
      text: "Piper reply",
    });
  });
});
