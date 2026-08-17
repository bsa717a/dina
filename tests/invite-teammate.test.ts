import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithAuthUser } from "@/lib/auth/context";
import type { AuthUser } from "@/lib/auth/types";
import {
  buildInviteEmail,
  isValidInviteEmail,
  resolveInviteProjects,
  usernameFromName,
} from "@/lib/team/invite";
import { getTeamToolDefinitions } from "@/lib/team/tool-definitions";
import { executeTeamTool } from "@/lib/team/tools";

const createMember = vi.fn();
const findUserByUsername = vi.fn();
const listTeammates = vi.fn();
const addTeammateToProjects = vi.fn();
const graphRequest = vi.fn();
const isMicrosoftConfigured = vi.fn();
const getMicrosoftConfig = vi.fn();

vi.mock("@/lib/auth/users", () => ({
  createMember: (...args: unknown[]) => createMember(...args),
  findUserByUsername: (...args: unknown[]) => findUserByUsername(...args),
}));

vi.mock("@/lib/team/members", () => ({
  listTeammates: (...args: unknown[]) => listTeammates(...args),
  addTeammateToProjects: (...args: unknown[]) => addTeammateToProjects(...args),
}));

vi.mock("@/lib/microsoft/graph", () => ({
  graphRequest: (...args: unknown[]) => graphRequest(...args),
  userPath: (path: string) => `/users/derek${path}`,
}));

vi.mock("@/lib/microsoft/config", () => ({
  isMicrosoftConfigured: () => isMicrosoftConfigured(),
  getMicrosoftConfig: () => getMicrosoftConfig(),
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "https://dina.example",
}));

const owner: AuthUser = {
  id: "owner-1",
  name: "Derek",
  username: "derek",
  role: "owner",
  assistantName: "Dina",
  assistantPersona: "",
  assistantKey: "dina",
  mustChangePassword: false,
};

const member: AuthUser = {
  id: "member-1",
  name: "Alex",
  username: "alex",
  role: "member",
  assistantName: "Nora",
  assistantPersona: "",
  assistantKey: "nora",
  mustChangePassword: false,
};

describe("invite helpers", () => {
  it("builds a username from a display name", () => {
    expect(usernameFromName("Alex Rivera")).toBe("alex_rivera");
  });

  it("validates invite emails", () => {
    expect(isValidInviteEmail("alex@4studentlives.com")).toBe(true);
    expect(isValidInviteEmail("not-an-email")).toBe(false);
  });

  it("resolves project names to keys", async () => {
    await expect(
      resolveInviteProjects(["4StudentLives", "Dina", "Reggie"]),
    ).resolves.toEqual(["4studentlives", "dina", "regi"]);
  });

  it("writes a login email with the temp password", () => {
    const message = buildInviteEmail({
      name: "Alex Rivera",
      username: "alex",
      password: "temp-pass-word",
      projectKeys: ["4studentlives"],
      appUrl: "https://dina.example",
    });
    expect(message.subject).toBe("Derek said I should introduce myself");
    expect(message.body).toContain("I'm Dina, Derek's assistant.");
    expect(message.body).toContain("Username: alex");
    expect(message.body).toContain("Temporary password: temp-pass-word");
    expect(message.body).toContain("https://dina.example/login");
    expect(message.body).toContain("4StudentLives");
    expect(message.body).toContain("What you can do once you're in:");
    expect(message.body).toContain("— Dina");
  });
});

describe("invite_teammate tool", () => {
  beforeEach(() => {
    createMember.mockReset();
    findUserByUsername.mockReset();
    listTeammates.mockReset();
    addTeammateToProjects.mockReset();
    graphRequest.mockReset();
    isMicrosoftConfigured.mockReset();
    getMicrosoftConfig.mockReset();
    findUserByUsername.mockResolvedValue(null);
    isMicrosoftConfigured.mockReturnValue(true);
    getMicrosoftConfig.mockReturnValue({ userEmail: "derek@4studentlives.com" });
    createMember.mockResolvedValue({
      id: "u1",
      name: "Alex Rivera",
      username: "alex",
      role: "member",
      assistantName: "",
      assistantPersona: "",
      assistantKey: null,
      mustChangePassword: true,
    });
    graphRequest.mockResolvedValue({});
  });

  it("is registered", () => {
    expect(getTeamToolDefinitions().map((tool) => tool.name)).toEqual([
      "list_projects",
      "create_project",
      "archive_project",
      "list_teammates",
      "add_teammate_to_project",
      "invite_teammate",
    ]);
  });

  it("rejects members", async () => {
    const result = JSON.parse(
      await runWithAuthUser(member, () =>
        executeTeamTool(
          "invite_teammate",
          JSON.stringify({
            name: "Sam",
            email: "sam@example.com",
            projects: ["4studentlives"],
          }),
        ),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only derek/i);
    expect(createMember).not.toHaveBeenCalled();
  });

  it("creates a teammate and sends Outlook mail as Derek", async () => {
    const result = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeTeamTool(
          "invite_teammate",
          JSON.stringify({
            name: "Alex Rivera",
            email: "alex@4studentlives.com",
            username: "alex",
            projects: ["4StudentLives"],
          }),
        ),
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.data.emailed).toBe(true);
    expect(result.data.from).toBe("derek@4studentlives.com");
    expect(result.data.user.username).toBe("alex");
    expect(result.data.temporaryPassword).toHaveLength(16);
    expect(createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Alex Rivera",
        username: "alex",
        projectKeys: ["4studentlives"],
      }),
    );
    expect(graphRequest).toHaveBeenCalledWith(
      "/users/derek/sendMail",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          saveToSentItems: true,
        }),
      }),
    );
  });

  it("still creates the account if mail fails", async () => {
    graphRequest.mockRejectedValue(new Error("Graph 403"));
    const result = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeTeamTool(
          "invite_teammate",
          JSON.stringify({
            name: "Alex Rivera",
            email: "alex@4studentlives.com",
            projects: ["4studentlives"],
          }),
        ),
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.data.emailed).toBe(false);
    expect(result.data.emailError).toMatch(/403/);
    expect(result.data.temporaryPassword).toBeTruthy();
  });

  it("refuses a second invite and points at add_teammate_to_project", async () => {
    findUserByUsername.mockResolvedValue({
      id: "u1",
      name: "Adam Bangerter",
      username: "adam_bangerter",
      role: "member",
    });
    const result = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeTeamTool(
          "invite_teammate",
          JSON.stringify({
            name: "Adam Bangerter",
            email: "adam@4studentlives.com",
            username: "adam_bangerter",
            projects: ["regi"],
          }),
        ),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/add_teammate_to_project/);
    expect(createMember).not.toHaveBeenCalled();
  });

  it("adds an existing teammate to a project without email", async () => {
    addTeammateToProjects.mockResolvedValue({
      user: { id: "u1", name: "Adam Bangerter", username: "adam_bangerter" },
      added: ["Regi"],
      alreadyHad: [],
      projects: ["4StudentLives", "Regi"],
    });
    const result = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeTeamTool(
          "add_teammate_to_project",
          JSON.stringify({ person: "Adam", projects: ["Regi"] }),
        ),
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.data.added).toEqual(["Regi"]);
    expect(result.data.note).toMatch(/No invite was sent/);
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("lists teammates for the owner", async () => {
    listTeammates.mockResolvedValue([
      {
        id: "u1",
        name: "Adam Bangerter",
        username: "adam_bangerter",
        assistantName: "Penny",
        projectKeys: ["4studentlives"],
        projects: ["4StudentLives"],
      },
    ]);
    const result = JSON.parse(
      await runWithAuthUser(owner, () => executeTeamTool("list_teammates", "{}")),
    );
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.teammates[0].username).toBe("adam_bangerter");
  });
});
