import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetGrokBotDinaApiToken = vi.fn();
const mockLookupBySlackUserId = vi.fn();

vi.mock("@/lib/env", () => ({
  getGrokBotDinaApiToken: () => mockGetGrokBotDinaApiToken(),
}));

vi.mock("@/lib/slack/roster", () => ({
  lookupBySlackUserId: (...args: unknown[]) => mockLookupBySlackUserId(...args),
}));

describe("GET /api/grok/lookup-by-slack", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetGrokBotDinaApiToken.mockReset();
    mockLookupBySlackUserId.mockReset();
  });

  it("rejects unauthenticated requests", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");
    const { GET } = await import("@/app/api/grok/lookup-by-slack/route");
    const response = await GET(
      new NextRequest("http://localhost/api/grok/lookup-by-slack?slackUserId=U012"),
    );
    expect(response.status).toBe(401);
  });

  it("returns a mapped Regi teammate", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");
    mockLookupBySlackUserId.mockResolvedValue({
      found: true,
      user: {
        id: "user-1",
        name: "Alex",
        username: "alex",
        slackUserId: "U012ALEX",
      },
      projectKeys: ["regi"],
      onRegiProject: true,
    });

    const { GET } = await import("@/app/api/grok/lookup-by-slack/route");
    const response = await GET(
      new NextRequest("http://localhost/api/grok/lookup-by-slack?slackUserId=U012ALEX", {
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.found).toBe(true);
    expect(body.user.slackUserId).toBe("U012ALEX");
    expect(body.projectKeys).toEqual(["regi"]);
    expect(body.onRegiProject).toBe(true);
  });

  it("returns found:false for unknown Slack users", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");
    mockLookupBySlackUserId.mockResolvedValue({
      found: false,
      slackUserId: "U999",
      reason: "unknown_user",
    });

    const { GET } = await import("@/app/api/grok/lookup-by-slack/route");
    const response = await GET(
      new NextRequest("http://localhost/api/grok/lookup-by-slack?slackUserId=U999", {
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    const body = await response.json();
    expect(body.found).toBe(false);
    expect(body.reason).toBe("unknown_user");
  });
});
