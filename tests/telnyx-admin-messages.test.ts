import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireSession = vi.fn();
const sendToPiperUser = vi.fn();
const listMessagingUsers = vi.fn();
const updateUserPhoneConsent = vi.fn();
const sendToPhoneOrUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireSession: () => requireSession(),
}));

vi.mock("@/lib/telnyx/messaging", () => ({
  sendToPiperUser: (...args: unknown[]) => sendToPiperUser(...args),
  listMessagingUsers: (...args: unknown[]) => listMessagingUsers(...args),
  updateUserPhoneConsent: (...args: unknown[]) => updateUserPhoneConsent(...args),
  sendToPhoneOrUser: (...args: unknown[]) => sendToPhoneOrUser(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const owner = {
  id: "owner-1",
  name: "Derek",
  username: "derek",
  role: "owner",
  assistantName: "Dina",
  assistantPersona: "",
  assistantKey: "dina",
  mustChangePassword: false,
  phoneNumber: null,
};

function jsonRequest(url: string, method: string, body: unknown, token?: string) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

describe("admin and service send APIs", () => {
  beforeEach(() => {
    requireSession.mockReset();
    sendToPiperUser.mockReset();
    listMessagingUsers.mockReset();
    updateUserPhoneConsent.mockReset();
    sendToPhoneOrUser.mockReset();
    requireSession.mockResolvedValue(owner);
    process.env.GROK_BOT_DINA_API_TOKEN = "service-token";
  });

  it("rejects members and logged-out callers on the admin API", async () => {
    const { POST } = await import("@/app/api/admin/messages/route");

    requireSession.mockResolvedValue(null);
    const loggedOut = await POST(
      jsonRequest("http://localhost/api/admin/messages", "POST", {
        userId: "user-1",
        text: "Hi",
      }),
    );
    expect(loggedOut.status).toBe(401);

    requireSession.mockResolvedValue({ ...owner, role: "member" });
    const member = await POST(
      jsonRequest("http://localhost/api/admin/messages", "POST", {
        userId: "user-1",
        text: "Hi",
      }),
    );
    expect(member.status).toBe(403);
    expect(sendToPiperUser).not.toHaveBeenCalled();
  });

  it("sends as the signed-in owner and returns a blocked opt-out", async () => {
    sendToPiperUser.mockResolvedValue({
      ok: false,
      status: 409,
      error: "This user opted out of messages. They can reply START to resume.",
      code: "opted_out",
    });
    const { POST } = await import("@/app/api/admin/messages/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/messages", "POST", {
        userId: "user-1",
        text: "Hi",
        channel: "sms_only",
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "opted_out" });
    expect(sendToPiperUser).toHaveBeenCalledWith({
      actor: { kind: "admin", userId: "owner-1" },
      userId: "user-1",
      text: "Hi",
      channel: "sms_only",
    });
  });

  it("saves phone and consent for the owner", async () => {
    updateUserPhoneConsent.mockResolvedValue({
      id: "user-1",
      phoneNumber: "+19044030781",
      canSend: true,
    });
    const { PATCH } = await import("@/app/api/admin/messages/route");
    const res = await PATCH(
      jsonRequest("http://localhost/api/admin/messages", "PATCH", {
        userId: "user-1",
        phoneNumber: "+19044030781",
        consent: true,
        consentMethod: "written",
      }),
    );
    expect(res.status).toBe(200);
    expect(updateUserPhoneConsent).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      userId: "user-1",
      phoneNumber: "+19044030781",
      consent: true,
      consentMethod: "written",
    });
  });

  it("requires a service token and sends by user id", async () => {
    const { POST } = await import("@/app/api/grok/messages/route");

    const denied = await POST(
      jsonRequest("http://localhost/api/grok/messages", "POST", {
        userId: "user-1",
        text: "Hi",
      }),
    );
    expect(denied.status).toBe(401);

    sendToPiperUser.mockResolvedValue({
      ok: true,
      messageId: "msg-1",
      channel: "rcs",
      type: "RCS",
    });
    const res = await POST(
      jsonRequest(
        "http://localhost/api/grok/messages",
        "POST",
        { userId: "user-1", text: "Hi" },
        "service-token",
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      messageId: "msg-1",
      channel: "rcs",
    });
    expect(sendToPiperUser).toHaveBeenCalledWith({
      actor: { kind: "service" },
      userId: "user-1",
      text: "Hi",
      channel: "rcs_first",
    });
  });

  it("returns the carrier registration message from the service API", async () => {
    sendToPiperUser.mockResolvedValue({
      ok: false,
      status: 502,
      error: "SMS carrier registration pending",
      code: "carrier_registration_pending",
    });
    const { POST } = await import("@/app/api/grok/messages/route");
    const res = await POST(
      jsonRequest(
        "http://localhost/api/grok/messages",
        "POST",
        { userId: "user-1", text: "Hi", channel: "sms_only" },
        "service-token",
      ),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      ok: false,
      error: "SMS carrier registration pending",
      code: "carrier_registration_pending",
    });
  });
});
