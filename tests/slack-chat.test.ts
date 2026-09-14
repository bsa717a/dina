import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth/types";

const mockResolveActive = vi.fn();
const mockRunChatTurn = vi.fn();
const mockResolveRegi = vi.fn();

vi.mock("@/lib/chat/active-project", () => ({
  resolveActiveProjectForUser: (...args: unknown[]) => mockResolveActive(...args),
}));

vi.mock("@/lib/chat/run-turn", () => ({
  runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
}));

vi.mock("@/lib/slack/scope", () => ({
  resolveRegiProjectKey: () => mockResolveRegi(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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

describe("runSlackPiperChat", () => {
  beforeEach(() => {
    vi.resetModules();
    mockResolveActive.mockReset();
    mockRunChatTurn.mockReset();
    mockResolveRegi.mockReset();
    mockResolveRegi.mockReturnValue("regi");
    mockResolveActive.mockResolvedValue({ key: "regi", name: "Regi" });
  });

  it("calls the same runChatTurn as web chat with Active project Regi", async () => {
    mockRunChatTurn.mockResolvedValue({
      ok: true,
      text: "Remaining tasks for Regi:\n\n1. Polish the dashboard",
      conversationId: "c1",
    });

    const { runSlackPiperChat } = await import("@/lib/slack/chat");
    const result = await runSlackPiperChat({
      user: member,
      text: "show me all tasks",
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("Polish the dashboard");
    expect(mockResolveActive).toHaveBeenCalledWith(member, "regi");
    expect(mockRunChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        user: member,
        content: "show me all tasks",
        attachmentIds: [],
        providerAttachments: [],
        activeProject: { key: "regi", name: "Regi" },
      }),
    );
  });

  it("only talks to runChatTurn — no Grok Bot collaborator", async () => {
    mockRunChatTurn.mockResolvedValue({
      ok: true,
      text: "Got it.",
      conversationId: "c1",
    });

    const chatModule = await import("@/lib/slack/chat");
    expect(chatModule).not.toHaveProperty("handoffSlackToGrokBot");
    await chatModule.runSlackPiperChat({ user: member, text: "hello" });
    expect(mockRunChatTurn).toHaveBeenCalledTimes(1);
  });

  it("surfaces a scoped error when Regi cannot be selected", async () => {
    mockResolveActive.mockResolvedValue(null);
    const { runSlackPiperChat } = await import("@/lib/slack/chat");
    const result = await runSlackPiperChat({
      user: member,
      text: "list tasks",
    });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/Regi/);
    expect(mockRunChatTurn).not.toHaveBeenCalled();
  });

  it("returns the model error text when the chat turn fails", async () => {
    mockRunChatTurn.mockResolvedValue({
      ok: false,
      text: "",
      error: "Gemini is down",
      conversationId: "c1",
    });
    const { runSlackPiperChat } = await import("@/lib/slack/chat");
    const result = await runSlackPiperChat({
      user: member,
      text: "add a task to book the venue",
    });
    expect(result.ok).toBe(false);
    expect(result.text).toBe("Gemini is down");
  });
});
