import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getToken = vi.fn();
const findUnique = vi.fn();
const canAccess = vi.fn();
const listKeys = vi.fn();
const lookupByPhoneNumber = vi.fn();
const lookupBySlackUserId = vi.fn();
const isSlackConfigured = vi.fn();
const getSlackConfig = vi.fn();
const postSlackMessage = vi.fn();

vi.mock("@/lib/env", () => ({
  getGrokBotDinaApiToken: () => getToken(),
  getSessionSecret: () => "test-session-secret-test-session-secret",
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUnique(...args) },
  },
}));

vi.mock("@/lib/project-tasks/membership", () => ({
  userCanAccessProject: (...args: unknown[]) => canAccess(...args),
  listMemberProjectKeys: (...args: unknown[]) => listKeys(...args),
}));

vi.mock("@/lib/projects/catalog", () => ({
  ensureProjectCatalog: async () => {},
  resolveProjectKey: (key: string) => {
    const normalized = key.trim().toLowerCase();
    if (normalized === "regi" || normalized === "4studentlives") return normalized;
    return null;
  },
  listKnownProjects: () => [
    { key: "regi", name: "Regi", aliases: [], archived: false },
    { key: "4studentlives", name: "4StudentLives", aliases: ["4sl"], archived: false },
  ],
}));

vi.mock("@/lib/telnyx/roster", () => ({
  lookupByPhoneNumber: (...args: unknown[]) => lookupByPhoneNumber(...args),
  normalizePhoneNumber: (phone: string) => phone,
  isValidE164: (phone: string) => phone.startsWith("+"),
}));

vi.mock("@/lib/slack/roster", () => ({
  lookupBySlackUserId: (...args: unknown[]) => lookupBySlackUserId(...args),
}));

vi.mock("@/lib/slack/config", () => ({
  isSlackConfigured: () => isSlackConfigured(),
  getSlackConfig: () => getSlackConfig(),
}));

vi.mock("@/lib/slack/client", () => ({
  postSlackMessage: (...args: unknown[]) => postSlackMessage(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const adamToken = "adam-user-token";
const adamHash = createHash("sha256").update(adamToken).digest("hex");
const phone = "+15550001111";
const slackUserId = "USHARED";

const membership: Record<string, string[]> = {
  "user-adam": ["regi"],
  "user-hidden": ["4studentlives"],
  "user-shared": ["4studentlives"],
};

function userRow(id: string, username: string) {
  return {
    id,
    name: username,
    username,
    role: "member",
    assistantName: "",
    assistantPersona: "",
    assistantKey: null,
    mustChangePassword: false,
    phoneNumber: phone,
    sessionVersion: 0,
  };
}

function bearer(url: string, token: string, init?: { method?: string; body?: string }) {
  return new NextRequest(url, {
    method: init?.method,
    body: init?.body,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

describe("per-user lookup does not enumerate Piper membership", () => {
  beforeEach(() => {
    vi.resetModules();
    getToken.mockReset();
    findUnique.mockReset();
    canAccess.mockReset();
    listKeys.mockReset();
    lookupByPhoneNumber.mockReset();
    lookupBySlackUserId.mockReset();
    getToken.mockReturnValue("dina-token");
    membership["user-adam"] = ["regi"];
    membership["user-hidden"] = ["4studentlives"];
    membership["user-shared"] = ["4studentlives"];
    findUnique.mockImplementation(async (args: { where?: { grokApiTokenHash?: string; id?: string } }) => {
      const where = args?.where ?? {};
      if (where.grokApiTokenHash === adamHash) return userRow("user-adam", "adam");
      if (where.id && membership[where.id]) return userRow(where.id, where.id);
      return null;
    });
    listKeys.mockImplementation(async (user: { id: string }) => membership[user.id] ?? []);
    canAccess.mockImplementation(async (user: { id: string }, project: string) => {
      return (membership[user.id] ?? []).includes(project) ? project : null;
    });
  });

  it("returns the same phone miss for an unknown number and an out-of-scope user", async () => {
    const { GET } = await import("@/app/api/grok/lookup-by-phone/route");

    lookupByPhoneNumber.mockResolvedValueOnce({
      found: false,
      phoneNumber: phone,
      reason: "unknown_number",
    });
    const unknown = await GET(
      bearer(`http://localhost/api/grok/lookup-by-phone?phone=${encodeURIComponent(phone)}`, adamToken),
    );

    lookupByPhoneNumber.mockResolvedValueOnce({
      found: true,
      user: {
        id: "user-hidden",
        name: "Hidden",
        username: "hidden",
        phoneNumber: phone,
      },
      projectKeys: ["4studentlives"],
    });
    const hidden = await GET(
      bearer(`http://localhost/api/grok/lookup-by-phone?phone=${encodeURIComponent(phone)}`, adamToken),
    );

    expect(unknown.status).toBe(200);
    expect(hidden.status).toBe(200);
    const unknownBody = await unknown.json();
    const hiddenBody = await hidden.json();
    expect(hiddenBody).toEqual(unknownBody);
    expect(hiddenBody).toEqual({
      ok: true,
      found: false,
      phoneNumber: phone,
      reason: "unknown_number",
    });
    expect(hiddenBody).not.toHaveProperty("user");
    expect(hiddenBody).not.toHaveProperty("error");
  });

  it("returns a reachable phone user and keeps the service token unrestricted", async () => {
    const { GET } = await import("@/app/api/grok/lookup-by-phone/route");
    const hit = {
      found: true,
      user: {
        id: "user-shared",
        name: "Shared",
        username: "shared",
        phoneNumber: phone,
      },
      projectKeys: ["4studentlives", "regi"],
    };
    membership["user-adam"] = ["4studentlives"];
    membership["user-shared"] = ["4studentlives"];

    lookupByPhoneNumber.mockResolvedValueOnce(hit);
    const adam = await GET(
      bearer(`http://localhost/api/grok/lookup-by-phone?phone=${encodeURIComponent(phone)}`, adamToken),
    );
    expect(adam.status).toBe(200);
    const adamBody = await adam.json();
    expect(adamBody.found).toBe(true);
    expect(adamBody.user.id).toBe("user-shared");
    expect(adamBody.projectKeys).toEqual(["4studentlives"]);

    lookupByPhoneNumber.mockResolvedValueOnce(hit);
    const dina = await GET(
      bearer(`http://localhost/api/grok/lookup-by-phone?phone=${encodeURIComponent(phone)}`, "dina-token"),
    );
    expect(dina.status).toBe(200);
    const dinaBody = await dina.json();
    expect(dinaBody.found).toBe(true);
    expect(dinaBody.projectKeys).toEqual(["4studentlives", "regi"]);
  });

  it("returns the same Slack miss for an unknown id and an out-of-scope user", async () => {
    const { GET } = await import("@/app/api/grok/lookup-by-slack/route");

    lookupBySlackUserId.mockResolvedValueOnce({
      found: false,
      slackUserId,
      reason: "unknown_user",
    });
    const unknown = await GET(
      bearer(
        `http://localhost/api/grok/lookup-by-slack?slackUserId=${slackUserId}`,
        adamToken,
      ),
    );

    lookupBySlackUserId.mockResolvedValueOnce({
      found: true,
      user: {
        id: "user-hidden",
        name: "Hidden",
        username: "hidden",
        slackUserId,
      },
      projectKeys: ["regi"],
      onRegiProject: true,
    });
    const hidden = await GET(
      bearer(
        `http://localhost/api/grok/lookup-by-slack?slackUserId=${slackUserId}`,
        adamToken,
      ),
    );

    expect(unknown.status).toBe(200);
    expect(hidden.status).toBe(200);
    const unknownBody = await unknown.json();
    const hiddenBody = await hidden.json();
    expect(hiddenBody).toEqual(unknownBody);
    expect(hiddenBody).toEqual({
      ok: true,
      found: false,
      slackUserId,
      reason: "unknown_user",
    });
    expect(hiddenBody).not.toHaveProperty("user");
    expect(hiddenBody).not.toHaveProperty("onRegiProject");
  });

  it("hides Regi membership from a token that only shares another project", async () => {
    membership["user-adam"] = ["4studentlives"];
    membership["user-shared"] = ["4studentlives", "regi"];
    lookupBySlackUserId.mockResolvedValue({
      found: true,
      user: {
        id: "user-shared",
        name: "Shared",
        username: "shared",
        slackUserId,
      },
      projectKeys: ["regi"],
      onRegiProject: true,
    });

    const { GET } = await import("@/app/api/grok/lookup-by-slack/route");
    const response = await GET(
      bearer(
        `http://localhost/api/grok/lookup-by-slack?slackUserId=${slackUserId}`,
        adamToken,
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.found).toBe(true);
    expect(body.user.slackUserId).toBe(slackUserId);
    expect(body.projectKeys).toEqual([]);
    expect(body.onRegiProject).toBe(false);
  });

  it("reports Regi membership when the caller can see that project", async () => {
    membership["user-adam"] = ["regi"];
    membership["user-shared"] = ["regi"];
    lookupBySlackUserId.mockResolvedValue({
      found: true,
      user: {
        id: "user-shared",
        name: "Shared",
        username: "shared",
        slackUserId,
      },
      projectKeys: ["regi"],
      onRegiProject: true,
    });

    const { GET } = await import("@/app/api/grok/lookup-by-slack/route");
    const adam = await GET(
      bearer(
        `http://localhost/api/grok/lookup-by-slack?slackUserId=${slackUserId}`,
        adamToken,
      ),
    );
    expect((await adam.json()).onRegiProject).toBe(true);

    const dina = await GET(
      bearer(
        `http://localhost/api/grok/lookup-by-slack?slackUserId=${slackUserId}`,
        "dina-token",
      ),
    );
    const dinaBody = await dina.json();
    expect(dinaBody.onRegiProject).toBe(true);
    expect(dinaBody.projectKeys).toEqual(["regi"]);
  });
});

describe("per-user Slack posts stay on authorized channels", () => {
  beforeEach(() => {
    vi.resetModules();
    getToken.mockReset();
    findUnique.mockReset();
    canAccess.mockReset();
    listKeys.mockReset();
    isSlackConfigured.mockReset();
    getSlackConfig.mockReset();
    postSlackMessage.mockReset();
    getToken.mockReturnValue("dina-token");
    isSlackConfigured.mockReturnValue(true);
    membership["user-adam"] = ["regi"];
    findUnique.mockImplementation(async (args: { where?: { grokApiTokenHash?: string; id?: string } }) => {
      if (args?.where?.grokApiTokenHash === adamHash) return userRow("user-adam", "adam");
      return null;
    });
    listKeys.mockImplementation(async (user: { id: string }) => membership[user.id] ?? []);
    canAccess.mockImplementation(async (user: { id: string }, project: string) => {
      return (membership[user.id] ?? []).includes(project) ? project : null;
    });
    postSlackMessage.mockResolvedValue({ sent: true, messageTs: "9.9" });
    getSlackConfig.mockReturnValue({
      projectSlug: "regi",
      channelIds: ["CREGI"],
      allowIms: false,
    });
  });

  function post(token: string, channelId: string) {
    return bearer("http://localhost/api/grok/outbound-slack", token, {
      method: "POST",
      body: JSON.stringify({ channelId, text: "Hello" }),
    });
  }

  it("posts when the user is on Regi and the channel is allowlisted", async () => {
    const { POST } = await import("@/app/api/grok/outbound-slack/route");
    const response = await POST(post(adamToken, "CREGI"));
    expect(response.status).toBe(200);
    expect(postSlackMessage).toHaveBeenCalledWith({
      channelId: "CREGI",
      text: "Hello",
      threadTs: undefined,
    });
  });

  it("refuses a channel outside the allowlist", async () => {
    const { POST } = await import("@/app/api/grok/outbound-slack/route");
    const response = await POST(post(adamToken, "COTHER"));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("Not allowed to post to this channel");
    expect(postSlackMessage).not.toHaveBeenCalled();
  });

  it("refuses every channel when the allowlist is empty", async () => {
    getSlackConfig.mockReturnValue({
      projectSlug: "regi",
      channelIds: [],
      allowIms: false,
    });
    const { POST } = await import("@/app/api/grok/outbound-slack/route");
    const response = await POST(post(adamToken, "CREGI"));
    expect(response.status).toBe(403);
    expect(postSlackMessage).not.toHaveBeenCalled();
  });

  it("refuses a listed DM unless IMs are allowed", async () => {
    getSlackConfig.mockReturnValue({
      projectSlug: "regi",
      channelIds: ["D123"],
      allowIms: false,
    });
    const { POST } = await import("@/app/api/grok/outbound-slack/route");
    const denied = await POST(post(adamToken, "D123"));
    expect(denied.status).toBe(403);
    expect(postSlackMessage).not.toHaveBeenCalled();

    getSlackConfig.mockReturnValue({
      projectSlug: "regi",
      channelIds: ["D123"],
      allowIms: true,
    });
    const allowed = await POST(post(adamToken, "D123"));
    expect(allowed.status).toBe(200);
    expect(postSlackMessage).toHaveBeenCalledTimes(1);
  });

  it("refuses a user who is not on the Regi project", async () => {
    membership["user-adam"] = ["4studentlives"];
    const { POST } = await import("@/app/api/grok/outbound-slack/route");
    const response = await POST(post(adamToken, "CREGI"));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("Not a member of this project");
    expect(postSlackMessage).not.toHaveBeenCalled();
  });

  it("still lets the env Dina token post to any channel", async () => {
    getSlackConfig.mockReturnValue({
      projectSlug: "regi",
      channelIds: ["CREGI"],
      allowIms: false,
    });
    const { POST } = await import("@/app/api/grok/outbound-slack/route");
    const response = await POST(post("dina-token", "COTHER"));
    expect(response.status).toBe(200);
    expect(postSlackMessage).toHaveBeenCalledWith({
      channelId: "COTHER",
      text: "Hello",
      threadTs: undefined,
    });
  });
});
