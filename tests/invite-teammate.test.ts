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
const graphRequest = vi.fn();
const isMicrosoftConfigured = vi.fn();
const getMicrosoftConfig = vi.fn();

vi.mock("@/lib/auth/users", () => ({
  createMember: (...args: unknown[]) => createMember(...args),
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

  it("resolves project names to keys", () => {
    expect(resolveInviteProjects(["4StudentLives", "Dina"])).toEqual([
      "4studentlives",
      "dina",
    ]);
  });

  it("writes a login email with the temp password", () => {
    const message = buildInviteEmail({
      name: "Alex Rivera",
      username: "alex",
      password: "temp-pass-word",
      projectKeys: ["4studentlives"],
      appUrl: "https://dina.example",
    });
    expect(message.subject).toBe("Your Dina login");
    expect(message.body).toContain("Username: alex");
    expect(message.body).toContain("Temporary password: temp-pass-word");
    expect(message.body).toContain("https://dina.example/login");
    expect(message.body).toContain("4StudentLives");
  });
});

describe("invite_teammate tool", () => {
  beforeEach(() => {
    createMember.mockReset();
    graphRequest.mockReset();
    isMicrosoftConfigured.mockReset();
    getMicrosoftConfig.mockReset();
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
});
