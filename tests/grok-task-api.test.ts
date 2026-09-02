import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetGrokBotDinaApiToken = vi.fn();

vi.mock("@/lib/env", () => ({
  getGrokBotDinaApiToken: () => mockGetGrokBotDinaApiToken(),
  getGrokBotDinaWebhookUrl: () => undefined,
  getGrokBotDinaWebhookSecret: () => undefined,
}));

vi.mock("@/lib/telnyx/config", () => ({
  isGrokBotConfigured: () => false,
  getGrokBotConfig: () => null,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockResolveProjectKey = vi.fn();
vi.mock("@/lib/projects/catalog", () => ({
  ensureProjectCatalog: vi.fn(async () => {}),
  resolveProjectKey: (k: string) => mockResolveProjectKey(k),
}));

const mockListProjectTasks = vi.fn();
const mockAddProjectTask = vi.fn();
const mockUpdateProjectTask = vi.fn();
const mockResolveProjectTask = vi.fn();

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks: (opts: unknown) => mockListProjectTasks(opts),
  addProjectTask: (input: unknown) => mockAddProjectTask(input),
  updateProjectTask: (id: string, patch: unknown) =>
    mockUpdateProjectTask(id, patch),
  resolveProjectTask: (input: unknown) => mockResolveProjectTask(input),
}));

const createTestTask = (overrides?: Record<string, unknown>) => ({
  id: "task-1",
  projectKey: "4sl",
  title: "Test task",
  description: "A test task",
  status: "open" as const,
  sortOrder: 1,
  source: "test",
  createdByUserId: null,
  assigneeUserId: null,
  completedAt: null,
  createdAt: new Date("2026-09-01T12:00:00Z"),
  updatedAt: new Date("2026-09-01T12:00:00Z"),
  number: 1,
  ...overrides,
});

function createAuthenticatedRequest(
  url: string,
  options?: { method?: string; body?: string; token?: string },
) {
  const { token = "test-api-token", method, body } = options ?? {};
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body) {
    headers["Content-Type"] = "application/json";
  }
  return new NextRequest(url, {
    method,
    body,
    headers,
  });
}

describe("Grok Task API", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetGrokBotDinaApiToken.mockReset();
    mockResolveProjectKey.mockReset();
    mockListProjectTasks.mockReset();
    mockAddProjectTask.mockReset();
    mockUpdateProjectTask.mockReset();
    mockResolveProjectTask.mockReset();
  });

  describe("Authentication", () => {
    it("returns 401 without Authorization header", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("correct-token");

      const { GET, POST, PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const request = new NextRequest(
        "http://localhost/api/grok/projects/4sl/tasks",
      );
      const context = { params: Promise.resolve({ key: "4sl" }) };

      const getRes = await GET(request, context);
      expect(getRes.status).toBe(401);

      const postRes = await POST(
        new NextRequest("http://localhost/api/grok/projects/4sl/tasks", {
          method: "POST",
          body: JSON.stringify({ title: "Test" }),
        }),
        context,
      );
      expect(postRes.status).toBe(401);

      const patchRes = await PATCH(
        new NextRequest("http://localhost/api/grok/projects/4sl/tasks", {
          method: "PATCH",
          body: JSON.stringify({ id: "task-1", status: "done" }),
        }),
        context,
      );
      expect(patchRes.status).toBe(401);
    });

    it("returns 401 with wrong token", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("correct-token");

      const { GET, POST, PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const context = { params: Promise.resolve({ key: "4sl" }) };

      const getRes = await GET(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          { token: "wrong-token" },
        ),
        context,
      );
      expect(getRes.status).toBe(401);
      const getBody = await getRes.json();
      expect(getBody.error).toBe("Invalid or missing service token");

      const postRes = await POST(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          { method: "POST", body: JSON.stringify({ title: "Test" }), token: "wrong-token" },
        ),
        context,
      );
      expect(postRes.status).toBe(401);

      const patchRes = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "task-1", status: "done" }),
            token: "wrong-token",
          },
        ),
        context,
      );
      expect(patchRes.status).toBe(401);
    });
  });

  describe("PATCH /api/grok/projects/[key]/tasks", () => {
    it("updates task status successfully by id", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const existingTask = createTestTask({ status: "open" });
      mockResolveProjectTask.mockResolvedValue(existingTask);
      mockUpdateProjectTask.mockResolvedValue({
        ...existingTask,
        status: "done",
        updatedAt: new Date("2026-09-01T13:00:00Z"),
      });

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "task-1", status: "done" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.task.status).toBe("done");
      expect(body.task.id).toBe("task-1");
      expect(mockUpdateProjectTask).toHaveBeenCalledWith("task-1", {
        status: "done",
      });
    });

    it("updates task status successfully by number", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const existingTask = createTestTask({ number: 2, id: "task-2" });
      mockResolveProjectTask.mockResolvedValue(existingTask);
      mockUpdateProjectTask.mockResolvedValue({
        ...existingTask,
        status: "in_progress",
        updatedAt: new Date("2026-09-01T13:00:00Z"),
      });

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ number: 2, status: "in_progress" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.task.status).toBe("in_progress");
      expect(body.task.number).toBe(2);
      expect(mockResolveProjectTask).toHaveBeenCalledWith({
        taskId: undefined,
        project: "4sl",
        number: 2,
      });
    });

    it("returns 404 for missing task", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");
      mockResolveProjectTask.mockRejectedValue(
        new Error("Project task not found."),
      );

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "nonexistent", status: "done" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("returns 404 for unknown project", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue(null);

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/unknown/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "task-1", status: "done" }),
          },
        ),
        { params: Promise.resolve({ key: "unknown" }) },
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("Unknown project");
    });

    it("accepts 'closed' as an alias for 'done'", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const existingTask = createTestTask();
      mockResolveProjectTask.mockResolvedValue(existingTask);
      mockUpdateProjectTask.mockResolvedValue({
        ...existingTask,
        status: "done",
      });

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "task-1", status: "closed" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      expect(mockUpdateProjectTask).toHaveBeenCalledWith("task-1", {
        status: "done",
      });
    });

    it("rejects invalid status", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const existingTask = createTestTask();
      mockResolveProjectTask.mockResolvedValue(existingTask);

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "task-1", status: "invalid_status" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid status");
    });

    it("requires id or number", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ status: "done" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("id or number is required");
    });

    it("requires at least one field to update", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const existingTask = createTestTask();
      mockResolveProjectTask.mockResolvedValue(existingTask);

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "task-1" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("At least one field");
    });
  });

  describe("POST /api/grok/projects/[key]/tasks", () => {
    it("creates a new task successfully", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const newTask = createTestTask({
        id: "new-task-1",
        title: "New task from Grok",
        status: "open",
      });
      mockAddProjectTask.mockResolvedValue(newTask);
      mockListProjectTasks.mockResolvedValue([{ ...newTask, number: 3 }]);

      const { POST } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await POST(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "POST",
            body: JSON.stringify({
              title: "New task from Grok",
              description: "Created via API",
            }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.task.title).toBe("New task from Grok");
      expect(body.task.status).toBe("open");
      expect(mockAddProjectTask).toHaveBeenCalledWith({
        project: "4sl",
        title: "New task from Grok",
        description: "Created via API",
        status: "open",
        source: "grok-api",
      });
    });

    it("creates task with specified status", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const newTask = createTestTask({
        id: "new-task-2",
        title: "In progress task",
        status: "in_progress",
      });
      mockAddProjectTask.mockResolvedValue(newTask);
      mockListProjectTasks.mockResolvedValue([{ ...newTask, number: 1 }]);

      const { POST } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await POST(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "POST",
            body: JSON.stringify({
              title: "In progress task",
              status: "in_progress",
            }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.task.status).toBe("in_progress");
    });

    it("returns 400 when title is missing", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const { POST } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await POST(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "POST",
            body: JSON.stringify({ description: "No title" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("title is required");
    });

    it("returns 404 for unknown project", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue(null);

      const { POST } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await POST(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/unknown/tasks",
          {
            method: "POST",
            body: JSON.stringify({ title: "Test" }),
          },
        ),
        { params: Promise.resolve({ key: "unknown" }) },
      );

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/grok/projects/[key]/tasks", () => {
    it("lists tasks with valid token", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const tasks = [
        createTestTask({ number: 1, title: "Task 1" }),
        createTestTask({ number: 2, id: "task-2", title: "Task 2" }),
      ];
      mockListProjectTasks.mockResolvedValue(tasks);

      const { GET } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await GET(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.tasks).toHaveLength(2);
      expect(body.tasks[0].title).toBe("Task 1");
    });
  });
});
