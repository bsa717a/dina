import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockConfigured = vi.fn();
const mockVerify = vi.fn();
const mockParse = vi.fn();
const mockProcess = vi.fn();
const mockDeliver = vi.fn();
const mockResolveProject = vi.fn();
const mockHasSlackEvent = vi.fn();
const afterCallbacks: Array<() => Promise<void>> = [];

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      afterCallbacks.push(async () => {
        await fn();
      });
    },
  };
});

vi.mock("@/lib/slack", () => ({
  isSlackConfigured: () => mockConfigured(),
  verifySlackSignature: (...args: unknown[]) => mockVerify(...args),
  extractSlackSignatureHeaders: (headers: Headers) => ({
    signature: headers.get("x-slack-signature"),
    timestamp: headers.get("x-slack-request-timestamp"),
  }),
  parseSlackInboundEvent: (...args: unknown[]) => mockParse(...args),
  processSlackInbound: (...args: unknown[]) => mockProcess(...args),
  deliverSlackReply: (...args: unknown[]) => mockDeliver(...args),
  resolveRegiProjectKey: () => mockResolveProject(),
  hasSlackEvent: (...args: unknown[]) => mockHasSlackEvent(...args),
  slackEventDedupeKey: (event: { channelId: string; ts: string }) =>
    `${event.channelId}:${event.ts}`,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function post(body: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/slack/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

describe("POST /api/slack/events", () => {
  beforeEach(() => {
    vi.resetModules();
    mockConfigured.mockReset();
    mockVerify.mockReset();
    mockParse.mockReset();
    mockProcess.mockReset();
    mockDeliver.mockReset();
    mockResolveProject.mockReset();
    mockHasSlackEvent.mockReset();
    afterCallbacks.length = 0;
    mockConfigured.mockReturnValue(true);
    mockVerify.mockReturnValue({ valid: true });
    mockResolveProject.mockReturnValue("regi");
    mockDeliver.mockResolvedValue(undefined);
    mockHasSlackEvent.mockReturnValue(false);
  });

  it("returns 503 when Slack is not configured", async () => {
    mockConfigured.mockReturnValue(false);
    const { POST } = await import("@/app/api/slack/events/route");
    const res = await POST(post({ type: "url_verification", challenge: "abc" }));
    expect(res.status).toBe(503);
  });

  it("rejects invalid signatures", async () => {
    mockVerify.mockReturnValue({ valid: false, reason: "signature_mismatch" });
    const { POST } = await import("@/app/api/slack/events/route");
    const res = await POST(post({ type: "event_callback" }));
    expect(res.status).toBe(401);
  });

  it("echoes the url_verification challenge", async () => {
    const { POST } = await import("@/app/api/slack/events/route");
    const res = await POST(post({ type: "url_verification", challenge: "challenge-token" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "challenge-token" });
  });

  it("acks immediately and processes the mention after the response", async () => {
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
      handoff: "logged",
      reply: { text: "Got it", channelId: "CREGI", threadTs: "1.1" },
      task: { id: "t1", number: 1, title: "hello", created: true },
    });

    const { POST } = await import("@/app/api/slack/events/route");
    const res = await POST(
      post({
        type: "event_callback",
        event: { type: "app_mention", user: "U012", text: "hello", ts: "1.1", channel: "CREGI" },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
    expect(mockProcess).not.toHaveBeenCalled();

    await afterCallbacks[0]();
    expect(mockProcess).toHaveBeenCalled();
    expect(mockDeliver).toHaveBeenCalled();
  });

  it("ignores Slack retries of an event already claimed", async () => {
    mockParse.mockReturnValue({
      type: "app_mention",
      slackUserId: "U012",
      text: "hello",
      channelId: "CREGI",
      ts: "1.1",
      threadTs: "1.1",
    });
    mockHasSlackEvent.mockReturnValue(true);

    const { POST } = await import("@/app/api/slack/events/route");
    const res = await POST(
      post(
        {
          type: "event_callback",
          event: { type: "app_mention", user: "U012", text: "hello", ts: "1.1", channel: "CREGI" },
        },
        { "x-slack-retry-num": "1" },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      ignored: true,
      reason: "retry",
    });
    expect(afterCallbacks).toHaveLength(0);
    expect(mockProcess).not.toHaveBeenCalled();
  });
});

describe("GET /api/slack/events", () => {
  it("reports regi scope", async () => {
    mockConfigured.mockReturnValue(true);
    mockResolveProject.mockReturnValue("regi");
    const { GET } = await import("@/app/api/slack/events/route");
    const res = await GET();
    const body = await res.json();
    expect(body.service).toBe("slack-events");
    expect(body.projectKey).toBe("regi");
    expect(body.scope).toBe("regi");
  });
});
