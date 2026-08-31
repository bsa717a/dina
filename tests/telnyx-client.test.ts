import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const getTelnyxConfig = vi.fn();

vi.mock("@/lib/telnyx/config", () => ({
  getTelnyxConfig: () => getTelnyxConfig(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("sendMessage", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    getTelnyxConfig.mockReset();
  });

  it("returns error when Telnyx is not configured", async () => {
    getTelnyxConfig.mockReturnValue(null);

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+14352382071",
      text: "Hello!",
    });

    expect(result.sent).toBe(false);
    expect(result.error).toBe("Telnyx is not configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("attempts RCS first when agent is configured", async () => {
    getTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "rcs-agent-123",
      smsFrom: "+18005551234",
      messagingProfileId: "profile-123",
      webhookSigningSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: "msg-123",
            type: "rcs",
            from: { phone_number: "+18005551234" },
            to: [{ phone_number: "+14352382071" }],
          },
        }),
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+14352382071",
      text: "Hello!",
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("rcs");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.telnyx.com/v2/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("falls back to SMS when RCS fails", async () => {
    getTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "rcs-agent-123",
      smsFrom: "+18005551234",
      messagingProfileId: "profile-123",
      webhookSigningSecret: null,
    });

    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: () => Promise.resolve("RCS not supported"),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              id: "msg-456",
              type: "SMS",
              from: { phone_number: "+18005551234" },
              to: [{ phone_number: "+14352382071" }],
            },
          }),
      });
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+14352382071",
      text: "Hello!",
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("SMS");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("sends SMS directly when preferRcs is false", async () => {
    getTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "rcs-agent-123",
      smsFrom: "+18005551234",
      messagingProfileId: "profile-123",
      webhookSigningSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: "msg-789",
            type: "SMS",
            from: { phone_number: "+18005551234" },
            to: [{ phone_number: "+14352382071" }],
          },
        }),
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+14352382071",
      text: "Hello!",
      preferRcs: false,
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("SMS");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sends SMS when no RCS agent is configured", async () => {
    getTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: null,
      smsFrom: "+18005551234",
      messagingProfileId: "profile-123",
      webhookSigningSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: "msg-abc",
            type: "SMS",
            from: { phone_number: "+18005551234" },
            to: [{ phone_number: "+14352382071" }],
          },
        }),
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+14352382071",
      text: "Hello!",
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("SMS");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("handles complete send failure", async () => {
    getTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: null,
      smsFrom: "+18005551234",
      messagingProfileId: "profile-123",
      webhookSigningSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Invalid phone number"),
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "invalid",
      text: "Hello!",
    });

    expect(result.sent).toBe(false);
    expect(result.error).toContain("400");
  });
});

describe("sendReply", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    getTelnyxConfig.mockReset();
  });

  it("calls sendMessage with the correct parameters", async () => {
    getTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "rcs-agent-123",
      smsFrom: "+18005551234",
      messagingProfileId: "profile-123",
      webhookSigningSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: "msg-reply",
            type: "rcs",
            from: { phone_number: "+18005551234" },
            to: [{ phone_number: "+14352382071" }],
          },
        }),
    });

    const { sendReply } = await import("@/lib/telnyx/client");
    const result = await sendReply("+14352382071", "Thanks for your message!");

    expect(result.sent).toBe(true);
    expect(result.messageId).toBe("msg-reply");
  });
});
