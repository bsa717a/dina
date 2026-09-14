import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockConfigured = vi.fn();
const mockVerify = vi.fn();
const mockLookup = vi.fn();
const mockProcess = vi.fn();
const mockIsChannelAllowed = vi.fn();
const mockResolveProject = vi.fn();

vi.mock("@/lib/slack", () => ({
  isSlackConfigured: () => mockConfigured(),
  verifySlackSignature: (...args: unknown[]) => mockVerify(...args),
  extractSlackSignatureHeaders: (headers: Headers) => ({
    signature: headers.get("x-slack-signature"),
    timestamp: headers.get("x-slack-request-timestamp"),
  }),
  inferSlackChannelType: (channelId: string, channelName?: string) => {
    if (channelName === "directmessage" || channelId.startsWith("D")) return "im";
    return "channel";
  },
  isChannelAllowed: (...args: unknown[]) => mockIsChannelAllowed(...args),
  lookupBySlackUserId: (...args: unknown[]) => mockLookup(...args),
  parseSlackSlashPayload: (command: string, text: string) => {
    const body = text.trim();
    if (body === "tasks" || body === "list") return { verb: "list", raw: body };
    if (body.startsWith("add ")) {
      return { verb: "add", title: body.slice(4), raw: body };
    }
    if (body.startsWith("done ")) {
      return { verb: "done", number: Number(body.slice(5)), raw: body };
    }
    return { verb: "help", raw: body };
  },
  processPiperCommand: (...args: unknown[]) => mockProcess(...args),
  resolveRegiProjectKey: () => mockResolveProject(),
  NOT_ON_REGI_REPLY: "not on regi",
  UNKNOWN_USER_REPLY: "unknown user",
  PIPER_COMMAND_USAGE: "usage",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function post(body: string, headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/slack/commands", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });
}

const foundRoster = {
  found: true,
  user: { id: "u-mo", name: "Mo", username: "mo", slackUserId: "U0C119F6538" },
  projectKeys: ["regi"],
  onRegiProject: true,
};

describe("POST /api/slack/commands", () => {
  beforeEach(() => {
    vi.resetModules();
    mockConfigured.mockReset();
    mockVerify.mockReset();
    mockLookup.mockReset();
    mockProcess.mockReset();
    mockIsChannelAllowed.mockReset();
    mockResolveProject.mockReset();
    mockConfigured.mockReturnValue(true);
    mockVerify.mockReturnValue({ valid: true });
    mockIsChannelAllowed.mockReturnValue(true);
    mockResolveProject.mockReturnValue("regi");
    mockLookup.mockResolvedValue(foundRoster);
  });

  it("returns 503 when Slack is not configured", async () => {
    mockConfigured.mockReturnValue(false);
    const { POST } = await import("@/app/api/slack/commands/route");
    const res = await POST(post("command=%2Fpiper&text=tasks"));
    expect(res.status).toBe(503);
  });

  it("rejects invalid signatures", async () => {
    mockVerify.mockReturnValue({ valid: false, reason: "signature_mismatch" });
    const { POST } = await import("@/app/api/slack/commands/route");
    const res = await POST(post("command=%2Fpiper&text=tasks"));
    expect(res.status).toBe(401);
  });

  it("acks Slack ssl_check without roster work", async () => {
    const { POST } = await import("@/app/api/slack/commands/route");
    const res = await POST(post("ssl_check=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("routes /piper tasks for a mapped Regi user", async () => {
    mockProcess.mockResolvedValue({
      kind: "command_list",
      text: "Open Regi tasks assigned to Mo:\n\n2. Mo polish",
    });

    const { POST } = await import("@/app/api/slack/commands/route");
    const res = await POST(
      post(
        "command=%2Fpiper&text=tasks&user_id=U0C119F6538&channel_id=CREGI&channel_name=regi",
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response_type).toBe("ephemeral");
    expect(body.text).toContain("Mo polish");
    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        parsed: expect.objectContaining({ verb: "list" }),
        roster: foundRoster,
        channelId: "CREGI",
      }),
    );
  });

  it("asks Derek when the Slack user is unmapped", async () => {
    mockLookup.mockResolvedValue({
      found: false,
      slackUserId: "U999",
      reason: "unknown_user",
    });
    const { POST } = await import("@/app/api/slack/commands/route");
    const res = await POST(
      post("command=%2Fpiper&text=tasks&user_id=U999&channel_id=CREGI"),
    );
    const body = await res.json();
    expect(body.text).toBe("unknown user");
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("blocks slash commands outside the channel allowlist", async () => {
    mockIsChannelAllowed.mockReturnValue(false);
    const { POST } = await import("@/app/api/slack/commands/route");
    const res = await POST(
      post(
        "command=%2Fpiper&text=tasks&user_id=U0C119F6538&channel_id=CBLOCKED&channel_name=random",
      ),
    );
    const body = await res.json();
    expect(body.text).toMatch(/allowed Regi Slack channels/);
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe("GET /api/slack/commands", () => {
  it("reports regi slash-command scope", async () => {
    mockConfigured.mockReturnValue(true);
    mockResolveProject.mockReturnValue("regi");
    const { GET } = await import("@/app/api/slack/commands/route");
    const res = await GET();
    const body = await res.json();
    expect(body.service).toBe("slack-commands");
    expect(body.projectKey).toBe("regi");
    expect(body.scope).toBe("regi");
  });
});
