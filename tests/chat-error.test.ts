import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => ({ authenticated: true })),
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

vi.mock("@/lib/ai/provider", () => ({
  getModelProvider: vi.fn(async () => ({
    name: "mock",
    async *streamChat() {
      yield { type: "error", message: "OpenAI is down" };
    },
  })),
}));

describe("POST /api/chat error path", () => {
  beforeEach(() => {
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
});
