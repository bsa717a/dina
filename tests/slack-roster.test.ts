import { describe, expect, it, vi, beforeEach } from "vitest";
import { isValidSlackUserId, normalizeSlackUserId } from "@/lib/slack/roster";

describe("slack user id helpers", () => {
  it("accepts Slack user ids", () => {
    expect(isValidSlackUserId("U012ABCDEF")).toBe(true);
    expect(isValidSlackUserId("U0ABC")).toBe(true);
  });

  it("rejects junk", () => {
    expect(isValidSlackUserId("")).toBe(false);
    expect(isValidSlackUserId("adam")).toBe(false);
    expect(isValidSlackUserId("+14352382071")).toBe(false);
  });

  it("trims ids", () => {
    expect(normalizeSlackUserId("  U012ABCDEF  ")).toBe("U012ABCDEF");
  });
});

const mockUserFindUnique = vi.fn();
const mockListMemberProjectKeys = vi.fn();
const mockFindUserByUsername = vi.fn();
const mockGetSlackUserMap = vi.fn();
const mockResolveRegiProjectKey = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/project-tasks/membership", () => ({
  listMemberProjectKeys: (...args: unknown[]) => mockListMemberProjectKeys(...args),
}));

vi.mock("@/lib/auth/users", () => ({
  findUserByUsername: (...args: unknown[]) => mockFindUserByUsername(...args),
}));

vi.mock("@/lib/env", () => ({
  getSlackUserMap: () => mockGetSlackUserMap(),
}));

vi.mock("@/lib/slack/scope", () => ({
  resolveRegiProjectKey: () => mockResolveRegiProjectKey(),
}));

describe("lookupBySlackUserId", () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockListMemberProjectKeys.mockReset();
    mockFindUserByUsername.mockReset();
    mockGetSlackUserMap.mockReset();
    mockResolveRegiProjectKey.mockReset();
    mockGetSlackUserMap.mockReturnValue({});
    mockResolveRegiProjectKey.mockReturnValue("regi");
  });

  it("returns unknown_user for unmapped Slack ids", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const { lookupBySlackUserId } = await import("@/lib/slack/roster");
    const result = await lookupBySlackUserId("U999UNKNOWN");

    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toBe("unknown_user");
    }
  });

  it("returns the user and forces projectKeys to regi when they are on Regi", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Alex",
      username: "alex",
      role: "member",
      assistantName: "Nora",
      assistantPersona: "",
      assistantKey: "nora",
      mustChangePassword: false,
      phoneNumber: null,
      slackUserId: "U012ALEX",
    });
    mockListMemberProjectKeys.mockResolvedValue(["regi", "4studentlives"]);

    const { lookupBySlackUserId } = await import("@/lib/slack/roster");
    const result = await lookupBySlackUserId("U012ALEX");

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.user.username).toBe("alex");
      expect(result.authUser.username).toBe("alex");
      expect(result.authUser.role).toBe("member");
      expect(result.onRegiProject).toBe(true);
      expect(result.projectKeys).toEqual(["regi"]);
    }
  });

  it("marks members who are only on 4SL as not on Regi", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-2",
      name: "4SL Only",
      username: "foursl",
      role: "member",
      assistantName: "Penny",
      assistantPersona: "",
      assistantKey: "penny",
      mustChangePassword: false,
      phoneNumber: null,
      slackUserId: "U012FOUR",
    });
    mockListMemberProjectKeys.mockResolvedValue(["4studentlives"]);

    const { lookupBySlackUserId } = await import("@/lib/slack/roster");
    const result = await lookupBySlackUserId("U012FOUR");

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.onRegiProject).toBe(false);
      expect(result.projectKeys).toEqual(["4studentlives"]);
    }
  });

  it("falls back to SLACK_USER_MAP", async () => {
    mockGetSlackUserMap.mockReturnValue({ U012MAP: "derek" });
    mockUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "owner-1",
        name: "Derek",
        username: "derek",
        role: "owner",
        assistantName: "Dina",
        assistantPersona: "",
        assistantKey: "dina",
        mustChangePassword: false,
        phoneNumber: null,
        slackUserId: null,
      });
    mockFindUserByUsername.mockResolvedValue({
      id: "owner-1",
      name: "Derek",
      username: "derek",
      role: "owner",
    });
    mockListMemberProjectKeys.mockResolvedValue([
      "dina",
      "regi",
      "4studentlives",
    ]);

    const { lookupBySlackUserId } = await import("@/lib/slack/roster");
    const result = await lookupBySlackUserId("U012MAP");

    expect(mockFindUserByUsername).toHaveBeenCalledWith("derek");
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.onRegiProject).toBe(true);
      expect(result.projectKeys).toEqual(["regi"]);
    }
  });
});
