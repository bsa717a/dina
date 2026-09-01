import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  TelnyxMessagePayload,
  RosterLookupResult,
} from "@/lib/telnyx/types";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const getGrokBotConfig = vi.fn();
const isGrokBotConfigured = vi.fn();

vi.mock("@/lib/telnyx/config", () => ({
  getGrokBotConfig: () => getGrokBotConfig(),
  isGrokBotConfigured: () => isGrokBotConfigured(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const createTestMessage = (overrides?: Partial<TelnyxMessagePayload>): TelnyxMessagePayload => ({
  id: "msg-123",
  record_type: "message",
  direction: "inbound",
  type: "rcs",
  from: {
    carrier: "T-Mobile",
    line_type: "mobile",
    phone_number: "+14352382071",
  },
  to: [
    {
      carrier: "",
      line_type: "",
      phone_number: "+18005551234",
    },
  ],
  text: "Hello Dina!",
  messaging_profile_id: "profile-123",
  organization_id: "org-123",
  cost: null,
  parts: 1,
  encoding: "UTF-8",
  errors: [],
  webhook_url: null,
  webhook_failover_url: null,
  valid_until: null,
  received_at: "2026-08-31T12:00:00Z",
  sent_at: null,
  completed_at: null,
  ...overrides,
});

const createFoundRoster = (): RosterLookupResult => ({
  found: true,
  user: {
    id: "user-1",
    name: "Adam Bangerter",
    username: "adam",
    phoneNumber: "+14352382071",
  },
  projectKeys: ["4studentlives", "regi"],
});

const createNotFoundRoster = (): RosterLookupResult => ({
  found: false,
  phoneNumber: "+14352382071",
  reason: "unknown_number",
});

describe("handoffToGrokBot", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    getGrokBotConfig.mockReset();
    isGrokBotConfigured.mockReset();
  });

  it("logs when Grok Bot is not configured", async () => {
    isGrokBotConfigured.mockReturnValue(false);
    getGrokBotConfig.mockReturnValue(null);

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    const result = await handoffToGrokBot(createTestMessage(), createFoundRoster());

    expect(result.status).toBe("logged");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends to Grok Bot when configured", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    const result = await handoffToGrokBot(createTestMessage(), createFoundRoster());

    expect(result.status).toBe("sent");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://grok-bot.example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("includes signature when webhook secret is set", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: "test-secret",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    await handoffToGrokBot(createTestMessage(), createFoundRoster());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Grok-Bot-Signature": expect.any(String),
          "X-Grok-Bot-Timestamp": expect.any(String),
        }),
      }),
    );
  });

  it("handles Grok Bot errors gracefully", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    const result = await handoffToGrokBot(createTestMessage(), createFoundRoster());

    expect(result.status).toBe("error");
    expect(result.error).toContain("500");
  });

  it("handles network errors gracefully", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockRejectedValue(new Error("Network error"));

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    const result = await handoffToGrokBot(createTestMessage(), createFoundRoster());

    expect(result.status).toBe("error");
    expect(result.error).toBe("Network error");
  });

  it("includes user info for known senders", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    await handoffToGrokBot(createTestMessage(), createFoundRoster());

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.user).toEqual({
      id: "user-1",
      name: "Adam Bangerter",
      username: "adam",
    });
    expect(body.projectKeys).toEqual(["4studentlives", "regi"]);
  });

  it("includes null user for unknown senders", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    await handoffToGrokBot(createTestMessage(), createNotFoundRoster());

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.user).toBeNull();
    expect(body.projectKeys).toEqual([]);
  });

  it("returns reply from Grok Bot response", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          reply: { text: "Hello from Grok Bot!" },
        }),
    });

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    const result = await handoffToGrokBot(createTestMessage(), createFoundRoster());

    expect(result.status).toBe("sent");
    expect(result.response?.ok).toBe(true);
    expect(result.response?.reply?.text).toBe("Hello from Grok Bot!");
  });

  it("handoff payload includes all required fields (from, text, teammate id, project ids)", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { handoffToGrokBot } = await import("@/lib/telnyx/handoff");
    const message = createTestMessage({
      from: { carrier: "Verizon", line_type: "mobile", phone_number: "+15551234567" },
      text: "Test message content",
    });
    const roster = createFoundRoster();

    await handoffToGrokBot(message, roster);

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);

    expect(body.from).toBe("+15551234567");
    expect(body.text).toBe("Test message content");
    expect(body.user.id).toBe("user-1");
    expect(body.projectKeys).toEqual(["4studentlives", "regi"]);
    expect(body.messageId).toBeDefined();
    expect(body.to).toBeDefined();
    expect(body.messageType).toBeDefined();
    expect(body.receivedAt).toBeDefined();
  });
});
