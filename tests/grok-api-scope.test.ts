import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getToken = vi.fn();
const findUnique = vi.fn();
const canAccess = vi.fn();
const listKeys = vi.fn();
const listTasks = vi.fn();
const sendToPiperUser = vi.fn();

vi.mock("@/lib/env", () => ({
  getGrokBotDinaApiToken: () => getToken(),
  getSessionSecret: () => "test-session-secret-test-session-secret",
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUnique(...args) },
    projectMember: { findMany: vi.fn().mockResolvedValue([]) },
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

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks: (...args: unknown[]) => listTasks(...args),
  addProjectTask: vi.fn(),
  updateProjectTask: vi.fn(),
  resolveProjectTask: vi.fn(),
  remainingTaskNumber: vi.fn(),
}));

vi.mock("@/lib/project-tasks/sections", () => ({
  ensureProjectSection: vi.fn(),
}));

vi.mock("@/lib/telnyx/config", () => ({
  getGrokBotConfig: () => null,
  isGrokBotConfigured: () => false,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/telnyx/messaging", () => ({
  sendToPiperUser: (...args: unknown[]) => sendToPiperUser(...args),
}));

vi.mock("@/lib/telnyx/roster", () => ({
  normalizePhoneNumber: (phone: string) => phone,
  isValidE164: (phone: string) => phone.startsWith("+"),
}));

const adamToken = "adam-user-token";
const adamHash = createHash("sha256").update(adamToken).digest("hex");

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
    phoneNumber: null,
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

describe("per-user Grok API scope", () => {
  beforeEach(() => {
    vi.resetModules();
    getToken.mockReset();
    findUnique.mockReset();
    canAccess.mockReset();
    listKeys.mockReset();
    listTasks.mockReset();
    sendToPiperUser.mockReset();
    getToken.mockReturnValue("dina-token");
    listTasks.mockResolvedValue([]);
    sendToPiperUser.mockResolvedValue({
      ok: true,
      messageId: "msg-1",
      channel: "rcs",
      type: "RCS",
    });
    findUnique.mockImplementation(async (args: { where?: { grokApiTokenHash?: string; id?: string } }) => {
      if (args?.where?.grokApiTokenHash === adamHash) return userRow("user-adam", "adam");
      if (args?.where?.id === "user-other") return userRow("user-other", "other");
      return null;
    });
    listKeys.mockImplementation(async (user: { id: string }) => {
      if (user.id === "user-adam") return ["regi"];
      if (user.id === "user-other") return ["4studentlives"];
      return [];
    });
    canAccess.mockImplementation(async (user: { id: string }, project: string) => {
      const keys = user.id === "user-adam" ? ["regi"] : [];
      return keys.includes(project) ? project : null;
    });
  });

  it("lets the Dina token read every project and a user token only their own", async () => {
    const { GET } = await import("@/app/api/grok/projects/route");

    const dina = await GET(bearer("http://localhost/api/grok/projects", "dina-token"));
    expect(dina.status).toBe(200);
    const dinaBody = await dina.json();
    expect(dinaBody.projects.map((project: { key: string }) => project.key)).toEqual([
      "regi",
      "4studentlives",
    ]);
    expect(listKeys).not.toHaveBeenCalled();

    listKeys.mockClear();
    const adam = await GET(bearer("http://localhost/api/grok/projects", adamToken));
    expect(adam.status).toBe(200);
    const adamBody = await adam.json();
    expect(adamBody.projects.map((project: { key: string }) => project.key)).toEqual(["regi"]);
  });

  it("blocks a user token from another project's tasks and allows their own", async () => {
    const { GET } = await import("@/app/api/grok/projects/[key]/tasks/route");
    const context = (key: string) => ({ params: Promise.resolve({ key }) });

    const allowed = await GET(
      bearer("http://localhost/api/grok/projects/regi/tasks", adamToken),
      context("regi"),
    );
    expect(allowed.status).toBe(200);

    const denied = await GET(
      bearer("http://localhost/api/grok/projects/4studentlives/tasks", adamToken),
      context("4studentlives"),
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe("Not a member of this project");

    canAccess.mockClear();
    const dina = await GET(
      bearer("http://localhost/api/grok/projects/4studentlives/tasks", "dina-token"),
      context("4studentlives"),
    );
    expect(dina.status).toBe(200);
    expect(canAccess).not.toHaveBeenCalled();
  });

  it("lets a user token message themselves and blocks messages outside their projects", async () => {
    const { POST } = await import("@/app/api/grok/messages/route");

    const self = await POST(
      bearer("http://localhost/api/grok/messages", adamToken, {
        method: "POST",
        body: JSON.stringify({ userId: "user-adam", text: "Hi" }),
      }),
    );
    expect(self.status).toBe(200);
    expect(sendToPiperUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-adam", actor: { kind: "service" } }),
    );

    sendToPiperUser.mockClear();
    const other = await POST(
      bearer("http://localhost/api/grok/messages", adamToken, {
        method: "POST",
        body: JSON.stringify({ userId: "user-other", text: "Hi" }),
      }),
    );
    expect(other.status).toBe(403);
    expect(sendToPiperUser).not.toHaveBeenCalled();

    findUnique.mockImplementation(async (args: { where?: { grokApiTokenHash?: string; id?: string } }) => {
      if (args?.where?.grokApiTokenHash === adamHash) return userRow("user-adam", "adam");
      if (args?.where?.id === "user-regi") return userRow("user-regi", "regi-mate");
      if (args?.where?.id === "user-other") return userRow("user-other", "other");
      return null;
    });
    listKeys.mockImplementation(async (user: { id: string }) => {
      if (user.id === "user-adam" || user.id === "user-regi") return ["regi"];
      if (user.id === "user-other") return ["4studentlives"];
      return [];
    });
    const teammate = await POST(
      bearer("http://localhost/api/grok/messages", adamToken, {
        method: "POST",
        body: JSON.stringify({ userId: "user-regi", text: "Hi" }),
      }),
    );
    expect(teammate.status).toBe(200);

    const dina = await POST(
      bearer("http://localhost/api/grok/messages", "dina-token", {
        method: "POST",
        body: JSON.stringify({ userId: "user-other", text: "Hi" }),
      }),
    );
    expect(dina.status).toBe(200);
    expect(sendToPiperUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-other" }),
    );
  });
});
