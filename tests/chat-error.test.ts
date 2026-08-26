import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => ({
    id: "user-derek",
    name: "Derek",
    username: "derek",
    role: "owner",
    assistantName: "Dina",
    assistantPersona: "",
    assistantKey: "dina",
    mustChangePassword: false,
  })),
}));

vi.mock("@/lib/memory/scope", () => ({
  memoryScopeForUser: vi.fn(async () => ({
    role: "owner",
    userId: "user-derek",
    projectKeys: ["dina"],
  })),
}));

vi.mock("@/lib/project-tasks/membership", () => ({
  listMemberProjectKeys: vi.fn(async () => ["dina"]),
  userCanAccessProject: vi.fn(async (_user: unknown, project: string) =>
    project === "dina" || project === "Dina" ? "dina" : null,
  ),
}));

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks: vi.fn(async () => []),
}));

vi.mock("@/lib/stars/store", () => ({
  STAR_SOFT_CAP: 20,
  listStarredMessageRecords: vi.fn(async () => []),
  listStarredMessages: vi.fn(async () => []),
}));

const setStandingInstruction = vi.fn(async (input: { title: string; content: string }) => ({
  title: input.title,
  content: input.content,
  status: "active",
}));

vi.mock("@/lib/standing-instructions/store", () => ({
  listActiveStandingInstructions: vi.fn(async () => []),
  setStandingInstruction,
  archiveStandingInstruction: vi.fn(async (title: string) => ({
    title,
    content: "",
    status: "archived",
  })),
}));

vi.mock("@/lib/standing-instructions/seed", () => ({
  seedStandingInstructions: vi.fn(async () => 0),
}));

vi.mock("@/lib/db/client", () => ({
  checkDatabase: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/db/conversations", () => ({
  getOrCreateDefaultConversation: vi.fn(async () => ({ id: "c1" })),
  createMessage: vi.fn(async () => ({
    id: "m1",
    role: "user",
    content: "hi",
    createdAt: new Date(),
    openaiResponseId: null,
  })),
  listMessagesForProvider: vi.fn(async () => [
    { id: "m1", role: "user", content: "hi", attachments: [] },
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
  yield { type: "error", message: "OpenAI is down" };
});

vi.mock("@/lib/ai/provider", () => ({
  getModelProvider: vi.fn(async () => ({
    name: "mock",
    streamChat,
  })),
}));

describe("POST /api/chat error path", () => {
  beforeEach(async () => {
    streamChat.mockClear();
    setStandingInstruction.mockClear();
    const conversations = await import("@/lib/db/conversations");
    vi.mocked(conversations.createMessage).mockClear();
    vi.resetModules();
  });

  it("streams a friendly error when the provider fails", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost:8080/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello", attachmentIds: [] }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("OpenAI is down");
    expect(text).toContain('"type":"error"');
  });

  it("passes the selected project to the model actor", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost:8080/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "add a task to ship the selector",
        attachmentIds: [],
        project: "dina",
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    await res.text();

    expect(streamChat).toHaveBeenCalled();
    const [input] = (streamChat.mock.calls as unknown as Array<
      [
        {
          tasksBlock?: string;
          actor?: { activeProject?: { key: string; name: string } | null };
        },
      ]
    >)[0] ?? [];
    expect(input?.actor?.activeProject).toEqual({ key: "dina", name: "Dina" });
    expect(input?.tasksBlock).toMatch(/already loaded|none remaining/);
  });

  it("rejects an unknown selected project", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost:8080/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "add a task",
        attachmentIds: [],
        project: "not-a-real-project",
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error)).toMatch(/project/i);
    expect(streamChat).not.toHaveBeenCalled();
    const conversations = await import("@/lib/db/conversations");
    expect(conversations.createMessage).not.toHaveBeenCalled();
  });

  it("keeps the current remaining-task ask but drops leftover list messages", async () => {
    const conversations = await import("@/lib/db/conversations");
    vi.mocked(conversations.listMessagesForProvider).mockResolvedValueOnce([
      {
        id: "old-user",
        role: "user",
        content: "Show remaining tasks for Dina",
        attachments: [],
      },
      {
        id: "old-assistant",
        role: "assistant",
        content: "Remaining tasks for Dina:\n\n1. Old item",
        attachments: [],
      },
      {
        id: "current",
        role: "user",
        content: "Show remaining tasks for Dina",
        attachments: [],
      },
    ] as never);

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost:8080/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Show remaining tasks for Dina",
        attachmentIds: [],
        project: "dina",
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    await res.text();

    const [input] = (streamChat.mock.calls as unknown as Array<
      [{ messages?: Array<{ id?: string; content: string }> }]
    >)[0] ?? [];
    expect(input?.messages?.map((message) => message.content)).toEqual([
      "Show remaining tasks for Dina",
    ]);
  });

  it("returns starred messages without a model turn", async () => {
    const stars = await import("@/lib/stars/store");
    vi.mocked(stars.listStarredMessageRecords).mockResolvedValueOnce([
      {
        id: "star-1",
        role: "assistant",
        conversationId: "c1",
        createdAt: new Date("2026-08-18T12:00:00.000Z"),
        starredAt: new Date("2026-08-18T12:00:00.000Z"),
        content: "Keep this lesson list.",
      },
    ]);

    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost:8080/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Show starred messages",
        attachmentIds: [],
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Keep this lesson list.");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("saves a standing instruction without a model turn", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost:8080/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Standing instruction: never show calendar IDs",
        attachmentIds: [],
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Standing instruction saved");
    expect(text).toContain("never show calendar IDs");
    expect(streamChat).not.toHaveBeenCalled();
    expect(setStandingInstruction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Never show calendar IDs",
        content: "never show calendar IDs",
        source: "chat",
      }),
    );
  });

  it("shows standing-instruction phrases without a model turn", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost:8080/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "How can I get you to remember this",
        attachmentIds: [],
      }),
    });

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Standing instruction: never show calendar IDs");
    expect(text).toContain("From now on: lead with the recommendation");
    expect(text).toContain("Show standing instructions");
    expect(text).toContain("Forget standing instruction: Never show calendar IDs");
    expect(streamChat).not.toHaveBeenCalled();
  });
});
