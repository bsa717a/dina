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

vi.mock("@/lib/db/client", () => ({
  checkDatabase: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/project-tasks/membership", () => ({
  userCanAccessProject: vi.fn(async (_user: unknown, project: string) =>
    project === "dina" || project === "Dina" ? "dina" : null,
  ),
}));

const listProjectTasks = vi.fn(async () => [
  {
    id: "t1",
    projectKey: "dina",
    title: "Ship the selector",
    description: "",
    status: "open",
    sortOrder: 0,
    source: "test",
    createdByUserId: null,
    assigneeUserId: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    number: 1,
  },
]);

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks,
}));

const seedDinaProjectTasks = vi.fn(async () => ({ created: 0, updated: 0 }));

vi.mock("@/lib/project-tasks/seed-dina-tasks", () => ({
  seedDinaProjectTasks,
}));

const createMessage = vi.fn(async () => ({
  id: "m-tasks",
  role: "assistant",
  content: "Remaining tasks for Dina:\n\n1. Ship the selector",
  createdAt: new Date("2026-08-18T12:00:00.000Z"),
  openaiResponseId: null,
  attachments: [],
}));

vi.mock("@/lib/db/conversations", () => ({
  getOrCreateDefaultConversation: vi.fn(async () => ({ id: "c1" })),
  createMessage,
}));

describe("GET/POST /api/project-tasks", () => {
  beforeEach(() => {
    listProjectTasks.mockClear();
    createMessage.mockClear();
    seedDinaProjectTasks.mockClear();
  });

  it("returns remaining tasks without a model", async () => {
    const { GET } = await import("@/app/api/project-tasks/route");
    const req = new Request("http://localhost:8080/api/project-tasks?project=dina");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project).toEqual({ key: "dina", name: "Dina" });
    expect(data.tasks).toHaveLength(1);
    expect(data.markdown).toContain("1. Ship the selector");
    expect(createMessage).not.toHaveBeenCalled();
    expect(seedDinaProjectTasks).toHaveBeenCalled();
  });

  it("persists the remaining list as an assistant message", async () => {
    const { POST } = await import("@/app/api/project-tasks/route");
    const req = new Request("http://localhost:8080/api/project-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: "dina" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message.id).toBe("m-tasks");
    expect(data.message.content).toContain("Ship the selector");
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "c1",
        role: "assistant",
      }),
    );
  });

  it("rejects an unknown project", async () => {
    const { GET } = await import("@/app/api/project-tasks/route");
    const req = new Request(
      "http://localhost:8080/api/project-tasks?project=not-a-real-project",
    );
    const res = await GET(req as never);
    expect(res.status).toBe(400);
    expect(createMessage).not.toHaveBeenCalled();
  });
});
