import { describe, expect, it, vi, beforeEach } from "vitest";
import { logger } from "@/lib/logger";

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

const configured = {
  apiKey: "test-key",
  rcsAgentId: "dina_4n1bd8jt_agent",
  smsFrom: "+14352382071",
  messagingProfileId: "4001a055-5081-43e2-8b5e-d41eb0cf866e",
  webhookSigningSecret: null,
};

function rcsOk(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        data: {
          id: "msg-rcs-1",
          type: "RCS",
          from: {
            agent_id: "42257dc9-586a-4f72-bba3-6b816d1ec6ed",
            agent_name: "dina_4n1bd8jt_agent",
          },
          to: [{ phone_number: "+19044030781" }],
          ...overrides,
        },
      }),
  };
}

function smsOk(id = "msg-sms-1") {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        data: {
          id,
          type: "SMS",
          from: { phone_number: "+14352382071" },
          to: [{ phone_number: "+19044030781" }],
        },
      }),
  };
}

describe("sendMessage", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    getTelnyxConfig.mockReset();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it("returns error when Telnyx is not configured", async () => {
    getTelnyxConfig.mockReturnValue(null);

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
    });

    expect(result.sent).toBe(false);
    expect(result.error).toBe("Telnyx is not configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("posts RCS to /messages/rcs with agent_id and no sms_fallback", async () => {
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue(rcsOk());

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("RCS");
    expect(result.messageId).toBe("msg-rcs-1");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.telnyx.com/v2/messages/rcs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      agent_id: "dina_4n1bd8jt_agent",
      to: "+19044030781",
      messaging_profile_id: "4001a055-5081-43e2-8b5e-d41eb0cf866e",
      type: "RCS",
      agent_message: { content_message: { text: "Hello!" } },
    });
    expect(body.from).toBeUndefined();
    expect(body.sms_fallback).toBeUndefined();
  });

  it("uses config.rcsAgentId string, not a rare agentId override, by default", async () => {
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue(rcsOk());

    const { sendMessage } = await import("@/lib/telnyx/client");
    await sendMessage({
      to: "+19044030781",
      text: "Hello!",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("dina_4n1bd8jt_agent");
    expect(body.agent_id).not.toBe("42257dc9-586a-4f72-bba3-6b816d1ec6ed");
  });

  it("honors a rare agentId override without changing the default send path", async () => {
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue(rcsOk());

    const { sendMessage } = await import("@/lib/telnyx/client");
    await sendMessage({
      to: "+19044030781",
      text: "Hello!",
      agentId: "other_rcs_agent",
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("other_rcs_agent");
    expect(body.sms_fallback).toBeUndefined();
  });

  it("fails preferRcs when messaging profile is missing instead of sending SMS", async () => {
    getTelnyxConfig.mockReturnValue({
      ...configured,
      messagingProfileId: null,
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
    });

    expect(result.sent).toBe(false);
    expect(result.type).toBeUndefined();
    expect(result.error).toContain("Messaging profile not configured for RCS");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "telnyx_rcs_failed",
      expect.objectContaining({
        to: "+19044030781",
        error: expect.stringContaining("Messaging profile"),
      }),
    );
  });

  it("fails preferRcs when Telnyx RCS HTTP errors instead of silent SMS", async () => {
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve('{"errors":[{"code":"40010","title":"Blocked"}]}'),
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
    });

    expect(result.sent).toBe(false);
    expect(result.type).toBeUndefined();
    expect(result.error).toBe("SMS carrier registration pending");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.telnyx.com/v2/messages/rcs",
    );
    expect(logger.error).toHaveBeenCalledWith(
      "telnyx_rcs_failed",
      expect.objectContaining({
        error: "SMS carrier registration pending",
        detail: expect.stringContaining("40010"),
      }),
    );
  });

  it("maps SMS error 40010 to the carrier registration message", async () => {
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      text: () =>
        Promise.resolve(
          '{"errors":[{"code":"40010","title":"Number not on a 10DLC campaign"}]}',
        ),
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
      preferRcs: false,
    });

    expect(result.sent).toBe(false);
    expect(result.error).toBe("SMS carrier registration pending");
    expect(logger.error).toHaveBeenCalledWith(
      "telnyx_send_failed",
      expect.objectContaining({
        error: "SMS carrier registration pending",
        detail: expect.stringContaining("40010"),
      }),
    );
  });

  it("does not report type rcs when /messages/rcs returns SMS", async () => {
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: "4031a093-9c5e-4543-a8f0-670538284050",
            type: "SMS",
            from: { phone_number: "+14352382071" },
            to: [{ phone_number: "+19044030781" }],
          },
        }),
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
    });

    expect(result.sent).toBe(false);
    expect(result.type).toBe("SMS");
    expect(result.messageId).toBe("4031a093-9c5e-4543-a8f0-670538284050");
    expect(result.error).toContain("instead of RCS");
    expect(result.error).toContain("+14352382071");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalledWith(
      "telnyx_rcs_sent",
      expect.anything(),
    );
  });

  it("reports type SMS only when allowSmsFallback is explicit", async () => {
    getTelnyxConfig.mockReturnValue(configured);
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
      return Promise.resolve(smsOk("msg-456"));
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
      allowSmsFallback: true,
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("SMS");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.telnyx.com/v2/messages/rcs",
    );
    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://api.telnyx.com/v2/messages",
    );
  });

  it("reports SMS (not rcs) when /messages/rcs returns SMS and fallback is allowed", async () => {
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: "msg-fallback-sms",
            type: "SMS",
            from: { phone_number: "+14352382071" },
            to: [{ phone_number: "+19044030781" }],
          },
        }),
    });

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
      allowSmsFallback: true,
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("SMS");
    expect(result.messageId).toBe("msg-fallback-sms");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("sends SMS directly when preferRcs is false", async () => {
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue(smsOk("msg-789"));

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
      preferRcs: false,
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("SMS");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.telnyx.com/v2/messages",
    );
  });

  it("sends SMS when no RCS agent is configured", async () => {
    getTelnyxConfig.mockReturnValue({
      ...configured,
      rcsAgentId: null,
    });
    mockFetch.mockResolvedValue(smsOk("msg-abc"));

    const { sendMessage } = await import("@/lib/telnyx/client");
    const result = await sendMessage({
      to: "+19044030781",
      text: "Hello!",
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("SMS");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.telnyx.com/v2/messages",
    );
  });

  it("handles complete send failure", async () => {
    getTelnyxConfig.mockReturnValue({
      ...configured,
      rcsAgentId: null,
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
    getTelnyxConfig.mockReturnValue(configured);
    mockFetch.mockResolvedValue(rcsOk({ id: "msg-reply" }));

    const { sendReply } = await import("@/lib/telnyx/client");
    const result = await sendReply("+19044030781", "Thanks for your message!");

    expect(result.sent).toBe(true);
    expect(result.messageId).toBe("msg-reply");
    expect(result.type).toBe("RCS");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.agent_id).toBe("dina_4n1bd8jt_agent");
    expect(body.sms_fallback).toBeUndefined();
  });
});

describe("sendRcsContent", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    getTelnyxConfig.mockReset();
    getTelnyxConfig.mockReturnValue(configured);
  });

  it("posts a rich card carousel without sms_fallback", async () => {
    mockFetch.mockResolvedValue(rcsOk({ id: "msg-cards" }));
    const { sendRcsContent } = await import("@/lib/telnyx/client");
    const result = await sendRcsContent({
      to: "+19044030781",
      smsText: "Open tasks:\n1. Survey — Derek — due 10/9/2026",
      content: {
        rich_card: {
          carousel_card: {
            card_width: "MEDIUM",
            card_contents: [
              {
                title: "Survey",
                description: "Owner: Derek\nDue: 10/9/2026",
                suggestions: [
                  {
                    reply: {
                      text: "Done",
                      postback_data: "piper-task-done:task-1",
                    },
                  },
                ],
              },
              {
                title: "Call",
                description: "Owner: Derek\nDue: No due date",
                suggestions: [
                  {
                    reply: {
                      text: "Done",
                      postback_data: "piper-task-done:task-2",
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    });

    expect(result).toEqual({
      sent: true,
      messageId: "msg-cards",
      type: "RCS",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sms_fallback).toBeUndefined();
    expect(body.agent_message.content_message.rich_card.carousel_card.card_contents).toHaveLength(2);
    expect(
      body.agent_message.content_message.rich_card.carousel_card.card_contents[0].suggestions[0]
        .reply,
    ).toEqual({
      text: "Done",
      postback_data: "piper-task-done:task-1",
    });
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.telnyx.com/v2/messages/rcs");
  });

  it("sends the numbered SMS only after the rich card request fails", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve("rcs rejected"),
      })
      .mockResolvedValueOnce(smsOk("msg-list"));

    const { sendRcsContent } = await import("@/lib/telnyx/client");
    const result = await sendRcsContent({
      to: "+19044030781",
      smsText: "Open tasks:\n1. Survey — Derek — due 10/9/2026\nReply done N to complete task N.",
      content: {
        rich_card: {
          standalone_card: {
            card_orientation: "VERTICAL",
            card_content: { title: "Survey", description: "Owner: Derek\nDue: 10/9/2026" },
          },
        },
      },
    });

    expect(result.sent).toBe(true);
    expect(result.type).toBe("SMS");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.telnyx.com/v2/messages");
    const smsBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(smsBody.text).toContain("1. Survey");
    expect(smsBody.text).toContain("done N");
    expect(smsBody.sms_fallback).toBeUndefined();
  });
});
