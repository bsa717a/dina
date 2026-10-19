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

const mockUserFindUnique = vi.fn();
const mockUserFindMany = vi.fn();
const mockProjectMemberFindMany = vi.fn();
const mockProjectMemberFindUnique = vi.fn();
const mockNotifyTaskChange = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
    projectMember: {
      findMany: (...args: unknown[]) => mockProjectMemberFindMany(...args),
      findUnique: (...args: unknown[]) => mockProjectMemberFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/grok-api/task-webhook", () => ({
  notifyTaskChange: (payload: unknown) => mockNotifyTaskChange(payload),
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
const mockEnsureProjectSection = vi.fn();

vi.mock("@/lib/project-tasks/sections", () => ({
  ensureProjectSection: (input: unknown) => mockEnsureProjectSection(input),
}));

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks: (opts: unknown) => mockListProjectTasks(opts),
  addProjectTask: (input: unknown) => mockAddProjectTask(input),
  updateProjectTask: (id: string, patch: unknown) =>
    mockUpdateProjectTask(id, patch),
  resolveProjectTask: (input: unknown) => mockResolveProjectTask(input),
  remainingTaskNumber: async (project: unknown, taskId: unknown) => {
    const listed = (await mockListProjectTasks({ project })) as {
      id: string;
      number: number;
    }[];
    return listed.find((task) => task.id === taskId)?.number;
  },
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
    mockListProjectTasks.mockResolvedValue([]);
    mockAddProjectTask.mockReset();
    mockUpdateProjectTask.mockReset();
    mockResolveProjectTask.mockReset();
    mockEnsureProjectSection.mockReset();
    mockUserFindUnique.mockReset();
    mockUserFindUnique.mockResolvedValue(null);
    mockUserFindMany.mockReset();
    mockUserFindMany.mockResolvedValue([]);
    mockProjectMemberFindMany.mockReset();
    mockProjectMemberFindMany.mockResolvedValue([]);
    mockProjectMemberFindUnique.mockReset();
    mockProjectMemberFindUnique.mockResolvedValue(null);
    mockNotifyTaskChange.mockReset();
    mockNotifyTaskChange.mockResolvedValue({ status: "logged" });
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
      expect(body.task.assignee).toBeNull();
      expect(mockUpdateProjectTask).toHaveBeenCalledWith("task-1", {
        status: "done",
      });
      expect(mockNotifyTaskChange).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "task.updated",
          task: expect.objectContaining({
            id: "task-1",
            status: "done",
            assignee: null,
          }),
        }),
      );
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

    it("returns the task number after a section move", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const existingTask = createTestTask({
        number: 2,
        id: "task-2",
        sectionId: null,
        sectionName: null,
      });
      mockResolveProjectTask.mockResolvedValue(existingTask);
      mockEnsureProjectSection.mockResolvedValue({
        id: "sec-sales",
        projectKey: "4sl",
        name: "sales",
      });
      mockUpdateProjectTask.mockResolvedValue({
        ...existingTask,
        sectionId: "sec-sales",
        sectionName: "sales",
      });
      mockListProjectTasks.mockResolvedValue([
        { ...existingTask, number: 1, sectionId: "sec-sales", sectionName: "sales" },
      ]);

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ number: 2, section: "sales" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.task.number).toBe(1);
      expect(body.task.section).toBe("sales");
      expect(mockListProjectTasks).toHaveBeenCalledWith({ project: "4sl" });
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
      expect(body.task.assignee).toBeNull();
      expect(mockAddProjectTask).toHaveBeenCalledWith({
        project: "4sl",
        title: "New task from Grok",
        description: "Created via API",
        status: "open",
        source: "grok-api",
      });
      expect(mockNotifyTaskChange).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "task.created",
          task: expect.objectContaining({ assignee: null }),
        }),
      );
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
      expect(body.tasks[0].assignee).toBeNull();
      expect(body.tasks[1].assignee).toBeNull();
    });
  });

  describe("assigneeEmail", () => {
    type LookupUser = {
      id: string;
      name: string;
      username: string;
      role: string;
      email: string | null;
      assistantName: string;
      assistantPersona: string;
      assistantKey: string | null;
      mustChangePassword: boolean;
      phoneNumber: string | null;
      sessionVersion: number;
    };

    function piperUser(overrides: Partial<LookupUser> = {}): LookupUser {
      return {
        id: "user-adam",
        name: "Adam Smith",
        username: "adam",
        role: "member",
        email: "adam@example.com",
        assistantName: "Piper",
        assistantPersona: "",
        assistantKey: "piper",
        mustChangePassword: false,
        phoneNumber: null,
        sessionVersion: 1,
        ...overrides,
      };
    }

    function useAssignee(user: LookupUser | null, member = true) {
      mockUserFindUnique.mockImplementation(
        async (query: { where?: { email?: string; id?: string } }) => {
          if (!user) return null;
          const where = query?.where ?? {};
          if (where.email && user.email && where.email === user.email) return user;
          if (where.id === user.id) return user;
          return null;
        },
      );
      mockUserFindMany.mockImplementation(
        async (query: { where?: { id?: { in?: string[] } } }) => {
          if (!user) return [];
          const ids = query?.where?.id?.in ?? [];
          return ids.includes(user.id) ? [user] : [];
        },
      );
      mockProjectMemberFindUnique.mockResolvedValue(
        member ? { id: "membership-1" } : null,
      );
    }

    it("creates a task assigned to a project member", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");
      const adam = piperUser();
      useAssignee(adam);

      const newTask = createTestTask({
        id: "new-task-1",
        title: "Call the district",
        assigneeUserId: adam.id,
      });
      mockAddProjectTask.mockResolvedValue(newTask);
      mockListProjectTasks.mockResolvedValue([{ ...newTask, number: 4 }]);

      const { POST } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await POST(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "POST",
            body: JSON.stringify({
              title: "Call the district",
              assigneeEmail: " Adam@Example.com ",
            }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.task.assignee).toEqual({
        email: "adam@example.com",
        name: "Adam Smith",
      });
      expect(mockAddProjectTask).toHaveBeenCalledWith(
        expect.objectContaining({
          project: "4sl",
          title: "Call the district",
          assigneeUserId: "user-adam",
          source: "grok-api",
        }),
      );
      expect(mockNotifyTaskChange).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "task.created",
          task: expect.objectContaining({
            assignee: { email: "adam@example.com", name: "Adam Smith" },
          }),
        }),
      );
    });

    it("returns 400 when the email is not a project member", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");
      useAssignee(piperUser({ email: "pat@example.com", id: "user-pat" }), false);

      const { POST } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await POST(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "POST",
            body: JSON.stringify({
              title: "Call the district",
              assigneeEmail: "pat@example.com",
            }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("No project member matches");
      expect(body.error).toContain("pat@example.com");
      expect(mockAddProjectTask).not.toHaveBeenCalled();
    });

    it("returns 400 when no Piper user has that email", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const existingTask = createTestTask();
      mockResolveProjectTask.mockResolvedValue(existingTask);

      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({
              id: "task-1",
              assigneeEmail: "missing@example.com",
            }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("No project member matches");
      expect(mockUpdateProjectTask).not.toHaveBeenCalled();
    });

    it("assigns and unassigns on PATCH without changing other fields", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");
      const adam = piperUser();
      useAssignee(adam);

      const existingTask = createTestTask({ title: "Keep this title" });
      mockResolveProjectTask.mockResolvedValue(existingTask);
      mockUpdateProjectTask.mockResolvedValue({
        ...existingTask,
        assigneeUserId: adam.id,
      });

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const assignRes = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({
              id: "task-1",
              assigneeEmail: "adam@example.com",
            }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(assignRes.status).toBe(200);
      const assigned = await assignRes.json();
      expect(assigned.task.title).toBe("Keep this title");
      expect(assigned.task.status).toBe("open");
      expect(assigned.task.assignee).toEqual({
        email: "adam@example.com",
        name: "Adam Smith",
      });
      expect(mockUpdateProjectTask).toHaveBeenCalledWith("task-1", {
        assigneeUserId: "user-adam",
      });
      expect(mockNotifyTaskChange).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "task.updated",
          task: expect.objectContaining({
            assignee: { email: "adam@example.com", name: "Adam Smith" },
          }),
          changes: {
            assignee: { email: "adam@example.com", name: "Adam Smith" },
          },
        }),
      );

      mockUpdateProjectTask.mockResolvedValue({
        ...existingTask,
        assigneeUserId: null,
      });
      const clearRes = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "task-1", assigneeEmail: null }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(clearRes.status).toBe(200);
      const cleared = await clearRes.json();
      expect(cleared.task.assignee).toBeNull();
      expect(mockUpdateProjectTask).toHaveBeenLastCalledWith("task-1", {
        assigneeUserId: null,
      });
      expect(mockNotifyTaskChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ assignee: null }),
          changes: { assignee: null },
        }),
      );
    });

    it("keeps the current assignee when a status update omits assigneeEmail", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");
      const adam = piperUser();
      useAssignee(adam);

      const existingTask = createTestTask({ assigneeUserId: adam.id });
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
            body: JSON.stringify({ id: "task-1", status: "done" }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.task.status).toBe("done");
      expect(body.task.assignee).toEqual({
        email: "adam@example.com",
        name: "Adam Smith",
      });
      expect(mockUpdateProjectTask).toHaveBeenCalledWith("task-1", {
        status: "done",
      });
      const changes = mockNotifyTaskChange.mock.calls[0][0].changes;
      expect(changes).toEqual({ status: "done" });
      expect(changes.assignee).toBeUndefined();
    });

    it("lists assignee email and name", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");
      const adam = piperUser();
      useAssignee(adam);
      mockListProjectTasks.mockResolvedValue([
        createTestTask({ number: 1, title: "Assigned", assigneeUserId: adam.id }),
        createTestTask({
          number: 2,
          id: "task-2",
          title: "Open",
          assigneeUserId: null,
        }),
      ]);

      const { GET } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await GET(
        createAuthenticatedRequest("http://localhost/api/grok/projects/4sl/tasks"),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tasks[0].assignee).toEqual({
        email: "adam@example.com",
        name: "Adam Smith",
      });
      expect(body.tasks[1].assignee).toBeNull();
    });

    it("accepts an owner because owners belong to every project", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");
      const derek = piperUser({
        id: "user-derek",
        name: "Derek",
        username: "derek",
        role: "owner",
        email: "derek@example.com",
      });
      useAssignee(derek, false);

      const existingTask = createTestTask();
      mockResolveProjectTask.mockResolvedValue(existingTask);
      mockUpdateProjectTask.mockResolvedValue({
        ...existingTask,
        assigneeUserId: derek.id,
      });

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({
              number: 1,
              assigneeEmail: "derek@example.com",
            }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.task.assignee).toEqual({
        email: "derek@example.com",
        name: "Derek",
      });
      expect(mockUpdateProjectTask).toHaveBeenCalledWith("task-1", {
        assigneeUserId: "user-derek",
      });
    });

    it("rejects an assigneeEmail that is not a string or null", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");
      mockResolveProjectKey.mockReturnValue("4sl");
      mockResolveProjectTask.mockResolvedValue(createTestTask());

      const { PATCH } = await import(
        "@/app/api/grok/projects/[key]/tasks/route"
      );
      const res = await PATCH(
        createAuthenticatedRequest(
          "http://localhost/api/grok/projects/4sl/tasks",
          {
            method: "PATCH",
            body: JSON.stringify({ id: "task-1", assigneeEmail: 12 }),
          },
        ),
        { params: Promise.resolve({ key: "4sl" }) },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("assigneeEmail must be a string or null");
      expect(mockUpdateProjectTask).not.toHaveBeenCalled();
    });
  });
});
