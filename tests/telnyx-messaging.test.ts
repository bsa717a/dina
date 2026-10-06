import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mockUserFindUnique = vi.fn();
const mockUserFindMany = vi.fn();
const mockUserUpdate = vi.fn();
const mockLogCreate = vi.fn();
const mockSendMessage = vi.fn();
const mockTelnyxConfigured = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    smsMessageLog: {
      create: (...args: unknown[]) => mockLogCreate(...args),
    },
  },
}));

vi.mock("@/lib/telnyx/client", () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

vi.mock("@/lib/telnyx/config", () => ({
  isTelnyxConfigured: () => mockTelnyxConfigured(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const readyUser = {
  id: "user-1",
  name: "Derek",
  username: "derek",
  role: "owner",
  phoneNumber: "+19044030781",
  smsConsentAt: new Date("2026-10-01T15:00:00.000Z"),
  smsConsentMethod: "verbal",
  smsOptedOutAt: null,
  smsConsentBy: { id: "owner-1", name: "Derek Fowler" },
};

describe("send gates and keyword opt-out", () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserFindMany.mockReset();
    mockUserUpdate.mockReset();
    mockLogCreate.mockReset();
    mockSendMessage.mockReset();
    mockTelnyxConfigured.mockReset();
    mockLogCreate.mockResolvedValue({ id: "log-1" });
    mockTelnyxConfigured.mockReturnValue(true);
  });

  it("blocks sends with no number, no consent, or an opt-out", async () => {
    const { sendBlockReason, SEND_BLOCK_MESSAGES } = await import(
      "@/lib/telnyx/messaging-policy"
    );

    expect(
      sendBlockReason({
        phoneNumber: null,
        smsConsentAt: null,
        smsOptedOutAt: null,
      }),
    ).toBe("no_phone");
    expect(
      sendBlockReason({
        phoneNumber: "+19044030781",
        smsConsentAt: null,
        smsOptedOutAt: null,
      }),
    ).toBe("no_consent");
    expect(
      sendBlockReason({
        phoneNumber: "+19044030781",
        smsConsentAt: new Date(),
        smsOptedOutAt: new Date(),
      }),
    ).toBe("opted_out");
    expect(
      sendBlockReason({
        phoneNumber: "+19044030781",
        smsConsentAt: new Date(),
        smsOptedOutAt: null,
      }),
    ).toBeNull();
    expect(SEND_BLOCK_MESSAGES.opted_out).toMatch(/opted out/i);
    expect(SEND_BLOCK_MESSAGES.no_consent).toMatch(/consent/i);
    expect(SEND_BLOCK_MESSAGES.no_phone).toMatch(/mobile number/i);
  });

  it("persists STOP and clears it on START", async () => {
    mockUserUpdate.mockResolvedValue({});
    const { applyInboundKeyword } = await import("@/lib/telnyx/messaging");

    await applyInboundKeyword("user-1", "stop");
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { smsOptedOutAt: expect.any(Date) },
    });

    await applyInboundKeyword("user-1", "start");
    expect(mockUserUpdate).toHaveBeenLastCalledWith({
      where: { id: "user-1" },
      data: { smsOptedOutAt: null },
    });

    await applyInboundKeyword("user-1", "help");
    expect(mockUserUpdate).toHaveBeenCalledTimes(2);
  });

  it("records who saved consent, when, and how", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      phoneNumber: null,
    });
    mockUserUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...readyUser,
      phoneNumber: data.phoneNumber,
      smsConsentAt: data.smsConsentAt,
      smsConsentMethod: data.smsConsentMethod,
      smsConsentBy: { id: "owner-1", name: "Derek Fowler" },
      smsOptedOutAt: data.smsOptedOutAt ?? null,
    }));

    const { updateUserPhoneConsent } = await import("@/lib/telnyx/messaging");
    const saved = await updateUserPhoneConsent({
      actorUserId: "owner-1",
      userId: "user-1",
      phoneNumber: "(904) 403-0781",
      consent: true,
      consentMethod: "verbal",
    });

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          phoneNumber: "+19044030781",
          smsConsentByUserId: "owner-1",
          smsConsentMethod: "verbal",
          smsConsentAt: expect.any(Date),
          smsOptedOutAt: null,
        }),
      }),
    );
    expect(saved.phoneNumber).toBe("+19044030781");
    expect(saved.smsConsentBy).toEqual({ id: "owner-1", name: "Derek Fowler" });
    expect(saved.canSend).toBe(true);
  });

  it("rejects consent without a valid number or method", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", phoneNumber: null });
    const { updateUserPhoneConsent } = await import("@/lib/telnyx/messaging");

    await expect(
      updateUserPhoneConsent({
        actorUserId: "owner-1",
        userId: "user-1",
        phoneNumber: "nope",
        consent: false,
      }),
    ).rejects.toMatchObject({ code: "invalid_phone" });

    await expect(
      updateUserPhoneConsent({
        actorUserId: "owner-1",
        userId: "user-1",
        phoneNumber: null,
        consent: true,
        consentMethod: "verbal",
      }),
    ).rejects.toMatchObject({ code: "consent_without_phone" });

    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      phoneNumber: "+19044030781",
    });
    await expect(
      updateUserPhoneConsent({
        actorUserId: "owner-1",
        userId: "user-1",
        phoneNumber: "+19044030781",
        consent: true,
        consentMethod: "shrug",
      }),
    ).rejects.toMatchObject({ code: "invalid_consent_method" });
  });

  it("reports a number already saved on another user", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      phoneNumber: null,
    });
    mockUserUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "6.19.2",
      }),
    );
    const { updateUserPhoneConsent } = await import("@/lib/telnyx/messaging");

    await expect(
      updateUserPhoneConsent({
        actorUserId: "owner-1",
        userId: "user-1",
        phoneNumber: "+19044030781",
        consent: false,
      }),
    ).rejects.toMatchObject({ code: "phone_taken", status: 409 });
  });

  it("does not call Telnyx when consent or opt-out blocks the send", async () => {
    const { sendToPiperUser } = await import("@/lib/telnyx/messaging");

    mockUserFindUnique.mockResolvedValue({
      ...readyUser,
      smsConsentAt: null,
    });
    const noConsent = await sendToPiperUser({
      actor: { kind: "admin", userId: "owner-1" },
      userId: "user-1",
      text: "Hello",
      channel: "rcs_first",
    });
    expect(noConsent.ok).toBe(false);
    if (!noConsent.ok) {
      expect(noConsent.code).toBe("no_consent");
      expect(noConsent.status).toBe(409);
    }

    mockUserFindUnique.mockResolvedValue({
      ...readyUser,
      smsOptedOutAt: new Date("2026-10-05T12:00:00.000Z"),
    });
    const optedOut = await sendToPiperUser({
      actor: { kind: "service" },
      userId: "user-1",
      text: "Hello",
      channel: "sms_only",
    });
    expect(optedOut.ok).toBe(false);
    if (!optedOut.ok) expect(optedOut.code).toBe("opted_out");

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockLogCreate).toHaveBeenCalledTimes(2);
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "blocked",
          actorKind: "admin",
          actorUserId: "owner-1",
          channel: "rcs",
        }),
      }),
    );
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "blocked",
          actorKind: "service",
          actorUserId: null,
          channel: "sms",
        }),
      }),
    );
  });

  it("logs a successful send with the Telnyx id and channel", async () => {
    mockUserFindUnique.mockResolvedValue(readyUser);
    mockSendMessage.mockResolvedValue({
      sent: true,
      messageId: "msg-rcs-1",
      type: "RCS",
    });
    const { sendToPiperUser } = await import("@/lib/telnyx/messaging");

    const result = await sendToPiperUser({
      actor: { kind: "admin", userId: "owner-1" },
      userId: "user-1",
      text: "Hello from Dina",
      channel: "rcs_first",
    });

    expect(result).toMatchObject({
      ok: true,
      messageId: "msg-rcs-1",
      channel: "rcs",
    });
    expect(mockSendMessage).toHaveBeenCalledWith({
      to: "+19044030781",
      text: "Hello from Dina",
      preferRcs: true,
      allowSmsFallback: false,
    });
    expect(mockLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "owner-1",
        actorKind: "admin",
        recipientUserId: "user-1",
        toPhone: "+19044030781",
        channel: "rcs",
        telnyxMessageId: "msg-rcs-1",
        status: "sent",
        error: null,
      }),
    });
  });

  it("surfaces SMS carrier registration pending and logs the failure", async () => {
    mockUserFindUnique.mockResolvedValue(readyUser);
    mockSendMessage.mockResolvedValue({
      sent: false,
      error: "SMS carrier registration pending",
    });
    const { sendToPiperUser } = await import("@/lib/telnyx/messaging");

    const result = await sendToPiperUser({
      actor: { kind: "admin", userId: "owner-1" },
      userId: "user-1",
      text: "Hello",
      channel: "sms_only",
    });

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      error: "SMS carrier registration pending",
      code: "carrier_registration_pending",
      channel: "sms",
    });
    expect(mockLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "failed",
        channel: "sms",
        error: "SMS carrier registration pending",
      }),
    });
  });
});
