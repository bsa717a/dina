import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TELNYX_KEYWORD_REPLIES } from "@/lib/telnyx/keywords";

const mockConfigured = vi.fn();
const mockVerify = vi.fn();
const mockLookup = vi.fn();
const mockHandoff = vi.fn();
const mockReply = vi.fn();

vi.mock("@/lib/telnyx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telnyx")>();
  return {
    ...actual,
    isTelnyxConfigured: () => mockConfigured(),
    verifyTelnyxSignature: (...args: unknown[]) => mockVerify(...args),
    extractSignatureHeaders: (headers: Headers) => ({
      signature: headers.get("telnyx-signature-ed25519"),
      timestamp: headers.get("telnyx-timestamp"),
    }),
    lookupByPhoneNumber: (...args: unknown[]) => mockLookup(...args),
    handoffToGrokBot: (...args: unknown[]) => mockHandoff(...args),
    sendReply: (...args: unknown[]) => mockReply(...args),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function post(body: unknown) {
  return new NextRequest("http://localhost/api/telnyx/webhook", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const knownRoster = {
  found: true,
  user: {
    id: "user-1",
    name: "Derek",
    username: "derek",
    phoneNumber: "+19044030781",
  },
  projectKeys: ["4studentlives"],
};

function rcsHelpPayload(overrides?: Record<string, unknown>) {
  return {
    data: {
      event_type: "message.received",
      id: "19d4cfc2-7faa-4d56-ae79-91cc83933ff0",
      occurred_at: "2026-09-12T02:35:50Z",
      payload: {
        body: { text: "Help" },
        direction: "inbound",
        from: {
          carrier: "T-Mobile USA",
          line_type: "long_code",
          phone_number: "+19044030781",
        },
        id: "d5b48ae4-91a9-4a5f-8a6d-756060c1cf32",
        messaging_profile_id: "profile-1",
        to: [
          {
            agent_id: "42257dc9-586a-4f72-bba3-6b816d1ec6ed",
            agent_name: "dina_4n1bd8jt_agent",
          },
        ],
        type: "RCS",
        ...overrides,
      },
      record_type: "event",
    },
  };
}

function smsHelpPayload() {
  return {
    data: {
      event_type: "message.received",
      id: "evt-sms",
      occurred_at: "2026-09-12T02:35:50Z",
      payload: {
        direction: "inbound",
        from: { phone_number: "+19044030781", carrier: "", line_type: "" },
        id: "sms-d5b48ae4",
        text: "Help",
        to: [{ phone_number: "+18005551234", carrier: "", line_type: "" }],
        type: "SMS",
      },
      record_type: "event",
    },
  };
}

describe("POST /api/telnyx/webhook", () => {
  beforeEach(() => {
    vi.resetModules();
    mockConfigured.mockReset();
    mockVerify.mockReset();
    mockLookup.mockReset();
    mockHandoff.mockReset();
    mockReply.mockReset();
    mockConfigured.mockReturnValue(true);
    mockVerify.mockReturnValue({ valid: true });
    mockLookup.mockResolvedValue(knownRoster);
    mockHandoff.mockResolvedValue({ status: "logged" });
    mockReply.mockResolvedValue({
      sent: true,
      type: "rcs",
      messageId: "out-rcs-1",
    });
  });

  it("returns 503 when Telnyx is not configured", async () => {
    mockConfigured.mockReturnValue(false);
    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(post(rcsHelpPayload()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Telnyx is not configured" });
  });

  it("sends an RCS agent auto-reply for official RCS HELP and skips Grok", async () => {
    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(post(rcsHelpPayload()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe("d5b48ae4-91a9-4a5f-8a6d-756060c1cf32");
    expect(body.handled).toBe(true);
    expect(body.handoff).toBe("skipped");
    expect(body.reply).toEqual({ sent: true, type: "rcs" });
    expect(mockLookup).toHaveBeenCalledWith("+19044030781");
    expect(mockHandoff).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      "+19044030781",
      TELNYX_KEYWORD_REPLIES.help,
      true,
    );
  });

  it("ingests RCS when text is a JSON string {\"text\":\"Help\"}", async () => {
    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(
      post(
        rcsHelpPayload({
          body: undefined,
          text: '{"text":"Help"}',
        }),
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.handoff).toBe("skipped");
    expect(mockHandoff).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      "+19044030781",
      TELNYX_KEYWORD_REPLIES.help,
      true,
    );
  });

  it("ingests RCS when text is an object { text: \"Help\" }", async () => {
    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(
      post(
        rcsHelpPayload({
          body: undefined,
          text: { text: "Help" },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(mockHandoff).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      "+19044030781",
      TELNYX_KEYWORD_REPLIES.help,
      true,
    );
  });

  it("still handles normal SMS inbound string text", async () => {
    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(post(smsHelpPayload()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe("sms-d5b48ae4");
    expect(body.handoff).toBe("skipped");
    expect(mockHandoff).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      "+19044030781",
      TELNYX_KEYWORD_REPLIES.help,
      false,
    );
  });

  it("hands conversational RCS to Grok and stays silent when there is no sync reply", async () => {
    mockHandoff.mockResolvedValue({
      status: "sent",
      response: { ok: true },
    });

    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(
      post(
        rcsHelpPayload({
          body: { text: "What is on the 4SL backlog?" },
        }),
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.handled).toBe(true);
    expect(body.handoff).toBe("sent");
    expect(body.reply).toBeUndefined();
    expect(mockHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "What is on the 4SL backlog?",
        type: "RCS",
      }),
      knownRoster,
    );
    expect(mockReply).not.toHaveBeenCalled();
  });

  it("sends a Grok sync reply over RCS when inbound type is RCS", async () => {
    mockHandoff.mockResolvedValue({
      status: "sent",
      response: { ok: true, reply: { text: "Here is the backlog." } },
    });

    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(
      post(
        rcsHelpPayload({
          body: { text: "What is on the 4SL backlog?" },
        }),
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.handoff).toBe("sent");
    expect(body.reply).toEqual({ sent: true, type: "rcs" });
    expect(mockReply).toHaveBeenCalledWith(
      "+19044030781",
      "Here is the backlog.",
      true,
    );
  });

  it("returns 2xx for unknown RCS senders instead of throwing on text", async () => {
    mockLookup.mockResolvedValue({
      found: false,
      phoneNumber: "+19044030781",
      reason: "unknown_number",
    });

    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(post(rcsHelpPayload()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.handled).toBe(false);
    expect(mockHandoff).not.toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it("sends a local STOP auto-reply over RCS without Grok handoff", async () => {
    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const res = await POST(
      post(
        rcsHelpPayload({
          body: { text: "STOP" },
        }),
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.handoff).toBe("skipped");
    expect(body.reply).toEqual({ sent: true, type: "rcs" });
    expect(mockHandoff).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith(
      "+19044030781",
      TELNYX_KEYWORD_REPLIES.stop,
      true,
    );
  });

  it("ignores outbound / non-received events with 2xx", async () => {
    const { POST } = await import("@/app/api/telnyx/webhook/route");
    const finalized = await POST(
      post({
        data: {
          event_type: "message.finalized",
          payload: { id: "out-1", direction: "outbound", type: "RCS" },
        },
      }),
    );
    expect(finalized.status).toBe(200);
    expect(await finalized.json()).toMatchObject({ ok: true, ignored: true });
  });
});
