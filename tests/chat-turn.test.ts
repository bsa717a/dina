import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/memory/scope", () => ({
  memoryScopeForUser: vi.fn(async () => ({
    role: "member",
    userId: "u-mo",
    projectKeys: ["regi"],
  })),
}));

vi.mock("@/lib/project-tasks/membership", () => ({
  listMemberProjectKeys: vi.fn(async () => ["regi"]),
  userCanAccessProject: vi.fn(async () => "regi"),
}));

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks: vi.fn(async () => []),
}));

vi.mock("@/lib/stars/store", () => ({
  listStarredMessageRecords: vi.fn(async () => []),
}));

vi.mock("@/lib/standing-instructions/store", () => ({
  listActiveStandingInstructions: vi.fn(async () => []),
  setStandingInstruction: vi.fn(),
  archiveStandingInstruction: vi.fn(),
}));

vi.mock("@/lib/db/conversations", () => ({
  getOrCreateDefaultConversation: vi.fn(async () => ({ id: "c-slack" })),
  createMessage: vi.fn(async (input: { role: string; content: string }) => ({
    id: input.role === "user" ? "m-user" : "m-assistant",
    role: input.role,
    content: input.content,
    createdAt: new Date(),
    openaiResponseId: null,
  })),
  listMessagesForProvider: vi.fn(async () => [
    { id: "m-user", role: "user", content: "list my tasks", attachments: [] },
  ]),
}));

vi.mock("@/lib/uploads/storage", () => ({
  loadProviderAttachments: vi.fn(async () => []),
}));

vi.mock("@/lib/memory/retrieve", () => ({
  retrieveRelevantMemories: vi.fn(async () => []),
  formatMemoriesForPrompt: vi.fn(() => ""),
}));

const streamChat = vi.fn(async function* () {
  yield { type: "delta", text: "Remaining Regi tasks:\n1. Book the venue" };
  yield { type: "done", text: "Remaining Regi tasks:\n1. Book the venue" };
});

vi.mock("@/lib/ai/provider", () => ({
  getModelProvider: vi.fn(async () => ({
    name: "mock-gemini",
    streamChat,
  })),
}));

vi.mock("@/lib/ai/usage", () => ({
  formatUsageCompact: vi.fn(() => ""),
  getTodayUsageTotals: vi.fn(() => null),
}));

const member: AuthUser = {
  id: "u-mo",
  name: "Mo",
  username: "mo",
  role: "member",
  assistantName: "Piper",
  assistantPersona: "",
  assistantKey: "piper",
  mustChangePassword: false,
  phoneNumber: null,
};

describe("runChatTurn", () => {
  beforeEach(() => {
    streamChat.mockClear();
  });

  it("collects the provider reply for Slack the same way web chat streams it", async () => {
    const { runChatTurn } = await import("@/lib/chat/run-turn");
    const result = await runChatTurn({
      user: member,
      content: "list my tasks",
      attachmentIds: [],
      providerAttachments: [],
      activeProject: { key: "regi", name: "Regi" },
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("Book the venue");
    expect(streamChat).toHaveBeenCalled();
    const [input] = (streamChat.mock.calls as unknown as Array<
      [{ actor?: { activeProject?: { key: string } | null } }]
    >)[0] ?? [];
    expect(input?.actor?.activeProject).toEqual({ key: "regi", name: "Regi" });
  });
});
